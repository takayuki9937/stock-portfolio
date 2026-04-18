import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { NisaTsumitate } from '@/lib/db';

/* 積立月数計算 */
function monthsSince(startDate: string): number {
  const now   = new Date();
  const start = new Date(startDate);
  return Math.max(0,
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth()    - start.getMonth()) + 1
  );
}

/* 今年の積立使用額 */
function calcYearlyUsed(rows: NisaTsumitate[]): number {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  return rows.reduce((sum, r) => {
    const start = new Date(r.start_date);
    const effectiveStart = start > yearStart ? start : yearStart;
    const months = Math.max(0,
      (now.getFullYear() - effectiveStart.getFullYear()) * 12 +
      (now.getMonth()    - effectiveStart.getMonth()) + 1
    );
    return sum + r.monthly_amount * months;
  }, 0);
}

/* みんかぶ投信ページの meta[description] から基準価額を取得 */
async function fetchNav(fundCode: string): Promise<number | null> {
  try {
    const res = await fetch(`https://itf.minkabu.jp/fund/${fundCode}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)
           ?? html.match(/<meta\s+content="([^"]+)"\s+name="description"/i);
    if (!m) return null;
    const nav = m[1].match(/基準価額([\d,]+\.?\d*)円/);
    if (!nav) return null;
    return parseFloat(nav[1].replace(/,/g, ''));
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const userId = new URL(req.url).searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const { data: rows, error } = await supabase
    .from('nisa_tsumitate')
    .select('*')
    .eq('user_id', Number(userId))
    .order('id', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = await Promise.all((rows as NisaTsumitate[]).map(async (r) => {
    const nav    = await fetchNav(r.fund_code);
    const months = monthsSince(r.start_date);

    let total_units: number;
    let cost_jpy: number;

    if (r.accumulation_type === 'units') {
      total_units = r.monthly_units * months;
      cost_jpy    = total_units * r.purchase_price / 10000;
    } else {
      cost_jpy    = r.monthly_amount * months;
      total_units = r.purchase_price > 0 ? (cost_jpy / r.purchase_price) * 10000 : 0;
    }

    const current_value_jpy = nav != null ? total_units * nav / 10000 : null;
    const pnl_jpy  = current_value_jpy != null ? current_value_jpy - cost_jpy : null;
    const pnl_pct  = pnl_jpy != null && cost_jpy > 0 ? (pnl_jpy / cost_jpy) * 100 : null;

    return { ...r, nav, months, total_units, cost_jpy, current_value_jpy, pnl_jpy, pnl_pct };
  }));

  const yearly_used = calcYearlyUsed(rows as NisaTsumitate[]);
  return NextResponse.json({ items, yearly_used, yearly_limit: 1200000 });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    userId, fund_code, fund_name, broker,
    accumulation_type, monthly_amount, monthly_units,
    purchase_price, start_date,
  } = body;

  if (!userId || !fund_code || !fund_name || !start_date) {
    return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('nisa_tsumitate')
    .insert({
      user_id: Number(userId),
      fund_code,
      fund_name,
      broker: broker ?? 'SBI',
      accumulation_type: accumulation_type ?? 'amount',
      monthly_amount: Number(monthly_amount ?? 0),
      monthly_units:  Number(monthly_units ?? 0),
      purchase_price: Number(purchase_price ?? 0),
      start_date,
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await supabase.from('nisa_tsumitate').delete().eq('id', Number(id));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}