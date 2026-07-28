import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { NisaGrowth } from '@/lib/db';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const YahooFinanceClass = require('yahoo-finance2').default;
const yahooFinance = new YahooFinanceClass({ suppressNotices: ['yahooSurvey', 'ripHistorical'] }) as {
  quoteSummary: (ticker: string, opts: object) => Promise<{
    price?: { regularMarketPrice?: number; shortName?: string };
  }>;
};

/** みんかぶ投信ページの meta[description] から基準価額を取得 */
async function fetchFundNav(fundCode: string): Promise<number | null> {
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

async function fetchStockPrice(code: string): Promise<number | null> {
  try {
    const s = await yahooFinance.quoteSummary(code, { modules: ['price'] });
    return s.price?.regularMarketPrice ?? null;
  } catch {
    return null;
  }
}

/* 今年の成長枠使用額（円建て） */
function calcYearlyUsed(rows: NisaGrowth[], usdJpy: number): number {
  const year = new Date().getFullYear();
  return rows.reduce((sum, r) => {
    const py = new Date(r.purchase_date).getFullYear();
    if (py !== year) return sum;
    const amountJpy = r.market === 'US' ? r.purchase_amount * usdJpy : r.purchase_amount;
    return sum + amountJpy;
  }, 0);
}

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const userId = params.get('userId');
  const usdJpy = parseFloat(params.get('usdJpy') ?? '150');
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const { data: rows, error } = await supabase
    .from('nisa_growth')
    .select('*')
    .eq('user_id', Number(userId))
    .order('purchase_date', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = await Promise.all((rows as NisaGrowth[]).map(async (r) => {
    const price = await (r.type === 'fund' ? fetchFundNav(r.code) : fetchStockPrice(r.code));

    // 購入金額（ローカル通貨）× 上昇率 = 現在評価額
    // 上昇率 = 現在価格 / 購入時価格
    const cost_jpy = r.market === 'US' ? r.purchase_amount * usdJpy : r.purchase_amount;
    let current_value_jpy: number | null = null;

    if (price != null && r.purchase_nav > 0) {
      const ratio = price / r.purchase_nav;
      current_value_jpy = r.market === 'US'
        ? r.purchase_amount * ratio * usdJpy
        : r.purchase_amount * ratio;
    }

    const pnl_jpy = current_value_jpy != null ? current_value_jpy - cost_jpy : null;
    const pnl_pct = pnl_jpy != null && cost_jpy > 0 ? (pnl_jpy / cost_jpy) * 100 : null;
    return { ...r, current_price: price, current_value_jpy, cost_jpy, pnl_jpy, pnl_pct };
  }));

  const yearly_used = calcYearlyUsed(rows as NisaGrowth[], usdJpy);
  return NextResponse.json({ items, yearly_used, yearly_limit: 2400000 });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { userId, type, market, code, fund_name, purchase_amount, purchase_nav, purchase_date } = body;
  if (!userId || !type || !market || !code || !fund_name || purchase_amount == null || purchase_nav == null || !purchase_date) {
    return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('nisa_growth')
    .insert({
      user_id: Number(userId),
      type,
      market,
      code,
      fund_name,
      purchase_amount: Number(purchase_amount),
      purchase_nav:    Number(purchase_nav),
      purchase_date,
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await supabase.from('nisa_growth').delete().eq('id', Number(id));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
