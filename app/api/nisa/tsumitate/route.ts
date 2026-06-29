import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { NisaTsumitate } from '@/lib/db';

/* ----------------------------------------------------------------
 * みんかぶ: 現在の基準価額を取得
 * ---------------------------------------------------------------- */
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

/* ----------------------------------------------------------------
 * みんかぶ: 日次＋月次をマージした全履歴を返す（昇順）
 * 日次（直近1年・精密）と月次（~5年・長期）を組み合わせることで
 * NISA開始の2024年以前も正確に計算できる
 * ---------------------------------------------------------------- */
async function fetchFundHistory(fundCode: string): Promise<{ date: string; nav: number }[]> {
  const fetchPeriod = async (period: 'daily' | 'monthly') => {
    try {
      const res = await fetch(
        `https://itf.minkabu.jp/json/funds/${fundCode}/get_line_${period}_json`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://itf.minkabu.jp/' },
          next: { revalidate: 3600 },
        }
      );
      if (!res.ok) return [];
      const json = await res.json() as { data: [number, number, ...unknown[]][] };
      if (!json.data || !Array.isArray(json.data)) return [];
      return json.data.map(([ts, nav]) => ({
        date: new Date(ts).toISOString().slice(0, 10),
        nav,
      }));
    } catch {
      return [];
    }
  };

  const [daily, monthly] = await Promise.all([
    fetchPeriod('daily'),
    fetchPeriod('monthly'),
  ]);

  // 日次データが優先。同日は日次を使う
  const map = new Map<string, number>();
  for (const entry of monthly) map.set(entry.date, entry.nav);
  for (const entry of daily)   map.set(entry.date, entry.nav); // 上書き

  return Array.from(map.entries())
    .map(([date, nav]) => ({ date, nav }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* ----------------------------------------------------------------
 * 指定日以前で最も近い基準価額を返す（なければ最古データを使用）
 * ---------------------------------------------------------------- */
function findNavOnOrBefore(
  history: { date: string; nav: number }[],
  targetDate: string
): number | null {
  if (history.length === 0) return null;

  let best: { date: string; nav: number } | null = null;
  for (const entry of history) {
    if (entry.date <= targetDate) {
      best = entry;
    } else {
      break; // 昇順ソート済みなので以降は全て超過
    }
  }
  // targetDateより古いデータしかない場合は最古データで代替
  return best?.nav ?? history[0].nav;
}

/* ----------------------------------------------------------------
 * 積立日リストを生成（start_date の日付を基準に毎月）
 * ---------------------------------------------------------------- */
function getAccumulationDates(startDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate);
  const accumDay = start.getDate();
  const now = new Date();

  let year = start.getFullYear();
  let month = start.getMonth();

  while (true) {
    // 月末を超える日付（例: 31日→30日）は月末に丸める
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const day = Math.min(accumDay, daysInMonth);
    const current = new Date(year, month, day);
    if (current > now) break;

    dates.push(current.toISOString().slice(0, 10));
    month++;
    if (month > 11) { month = 0; year++; }
  }

  return dates;
}

/* ----------------------------------------------------------------
 * 積立月数（後方互換用）
 * ---------------------------------------------------------------- */
function monthsSince(startDate: string): number {
  const now   = new Date();
  const start = new Date(startDate);
  return Math.max(0,
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth()    - start.getMonth()) + 1
  );
}

/* ----------------------------------------------------------------
 * 今年の積立使用額（年間投資枠の消費計算）
 * ---------------------------------------------------------------- */
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

/* ----------------------------------------------------------------
 * GET: ユーザーのつみたて一覧を返す
 * ---------------------------------------------------------------- */
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
    // nav取得と履歴取得を並列実行（units型は履歴不要）
    const [nav, history] = await Promise.all([
      fetchNav(r.fund_code),
      r.accumulation_type === 'amount'
        ? fetchFundHistory(r.fund_code)
        : Promise.resolve([] as { date: string; nav: number }[]),
    ]);

    const months = monthsSince(r.start_date);
    let total_units: number;
    let cost_jpy: number;

    if (r.accumulation_type === 'units') {
      // 口数指定: 変動を考慮しないシンプル計算
      total_units = r.monthly_units * months;
      cost_jpy    = total_units * r.purchase_price / 10000;
    } else {
      // 金額指定: ドルコスト平均法（各積立日の実際の基準価額で口数計算）
      const dates = getAccumulationDates(r.start_date);
      total_units = 0;

      for (const date of dates) {
        // 履歴データがない月は登録時の基準価額で代替
        const navOnDate = findNavOnOrBefore(history, date) ?? r.purchase_price;
        if (navOnDate > 0) {
          total_units += (r.monthly_amount / navOnDate) * 10000;
        }
      }

      cost_jpy = r.monthly_amount * dates.length;
    }

    const current_value_jpy = nav != null ? total_units * nav / 10000 : null;
    const pnl_jpy  = current_value_jpy != null ? current_value_jpy - cost_jpy : null;
    const pnl_pct  = pnl_jpy != null && cost_jpy > 0 ? (pnl_jpy / cost_jpy) * 100 : null;

    return { ...r, nav, months, total_units, cost_jpy, current_value_jpy, pnl_jpy, pnl_pct };
  }));

  const yearly_used = calcYearlyUsed(rows as NisaTsumitate[]);
  return NextResponse.json({ items, yearly_used, yearly_limit: 1200000 });
}

/* ----------------------------------------------------------------
 * POST: つみたて登録
 * ---------------------------------------------------------------- */
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
      monthly_amount:  Number(monthly_amount ?? 0),
      monthly_units:   Number(monthly_units ?? 0),
      purchase_price:  Number(purchase_price ?? 0),
      start_date,
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}

/* ----------------------------------------------------------------
 * DELETE: つみたて削除
 * ---------------------------------------------------------------- */
export async function DELETE(req: NextRequest) {
  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await supabase.from('nisa_tsumitate').delete().eq('id', Number(id));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
