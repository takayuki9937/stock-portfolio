import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { NisaTsumitate } from '@/lib/db';

/* ----------------------------------------------------------------
 * yahoo-finance2 セットアップ（stock/route.ts と同じパターン）
 * ---------------------------------------------------------------- */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const YahooFinanceClass = require('yahoo-finance2').default;
const yahooFinance = new YahooFinanceClass({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
}) as {
  chart: (ticker: string, opts: object) => Promise<{
    quotes: Array<{ date: Date; close: number | null }>;
  }>;
};

/* ----------------------------------------------------------------
 * ファンドコード → 連動インデックス対応テーブル
 * currency: 'USD' の場合は USDJPY も取得して JPY 換算する
 * ---------------------------------------------------------------- */
const FUND_INDEX_MAP: Record<string, { ticker: string; currency: 'USD' | 'JPY' }> = {
  '0331418A': { ticker: 'ACWI',   currency: 'USD' }, // eMAXIS Slim 全世界株式（オール・カントリー）
  '03311187': { ticker: '^GSPC',  currency: 'USD' }, // eMAXIS Slim 米国株式（S&P500）
  '03311182': { ticker: 'URTH',   currency: 'USD' }, // eMAXIS Slim 先進国株式インデックス
  '03311193': { ticker: '1306.T', currency: 'JPY' }, // eMAXIS Slim 日本株式（TOPIX）
  '03311179': { ticker: 'EEM',    currency: 'USD' }, // eMAXIS Slim 新興国株式インデックス
  '2931113C': { ticker: 'URTH',   currency: 'USD' }, // ニッセイ 外国株式インデックスファンド
  '89311199': { ticker: 'ACWI',   currency: 'USD' }, // SBI・全世界株式インデックス（雪だるま）
  '9I31118A': { ticker: 'ACWI',   currency: 'USD' }, // 楽天・全世界株式インデックス・ファンド
  '9I311179': { ticker: '^GSPC',  currency: 'USD' }, // 楽天・米国株式インデックス・ファンド
  '47311180': { ticker: 'URTH',   currency: 'USD' }, // たわらノーロード 先進国株式
  '64311119': { ticker: '^GSPC',  currency: 'USD' }, // PayPay投信 S&P500インデックス
};

/* ----------------------------------------------------------------
 * Yahoo Finance から日次履歴を取得（昇順ソート済み）
 * ---------------------------------------------------------------- */
async function fetchYFHistory(
  ticker: string,
  startDate: Date,
): Promise<{ date: string; close: number }[]> {
  try {
    const result = await yahooFinance.chart(ticker, {
      period1:  startDate,
      period2:  new Date(),
      interval: '1d',
    });
    return (result.quotes ?? [])
      .filter((q): q is { date: Date; close: number } => q.close != null)
      .map((q) => ({ date: q.date.toISOString().slice(0, 10), close: q.close }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

/* ----------------------------------------------------------------
 * 指定日以前で最も近い値を返す（データがない場合は最古の値）
 * ---------------------------------------------------------------- */
function findOnOrBefore(
  history: { date: string; close: number }[],
  target: string,
): number | null {
  if (history.length === 0) return null;
  let best: number | null = null;
  for (const e of history) {
    if (e.date <= target) best = e.close;
    else break;
  }
  return best ?? history[0].close;
}

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
 * みんかぶ: 日次＋月次マージ履歴（フォールバック用）
 * ---------------------------------------------------------------- */
async function fetchFundHistory(fundCode: string): Promise<{ date: string; nav: number }[]> {
  const fetchPeriod = async (period: 'daily' | 'monthly') => {
    try {
      const res = await fetch(
        `https://itf.minkabu.jp/json/funds/${fundCode}/get_line_${period}_json`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://itf.minkabu.jp/' },
          next: { revalidate: 3600 },
        },
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
  const map = new Map<string, number>();
  for (const e of monthly) map.set(e.date, e.nav);
  for (const e of daily)   map.set(e.date, e.nav);
  return Array.from(map.entries())
    .map(([date, nav]) => ({ date, nav }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* ----------------------------------------------------------------
 * みんかぶ履歴から DCA 計算（フォールバック）
 * ---------------------------------------------------------------- */
function calcUnitsFromMinkabu(
  dates: string[],
  history: { date: string; nav: number }[],
  monthlyAmount: number,
  purchasePrice: number,
): number {
  let total = 0;
  for (const date of dates) {
    let best: number | null = null;
    for (const e of history) {
      if (e.date <= date) best = e.nav;
      else break;
    }
    const navOnDate = best ?? (history.length > 0 ? history[0].nav : purchasePrice);
    if (navOnDate > 0) total += (monthlyAmount / navOnDate) * 10000;
  }
  return total;
}

/* ----------------------------------------------------------------
 * 積立日リストを生成（start_date の日付を基準に毎月）
 * ---------------------------------------------------------------- */
function getAccumulationDates(startDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate);
  const accumDay = start.getDate();
  const now = new Date();
  let year = start.getFullYear(), month = start.getMonth();

  while (true) {
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

function monthsSince(startDate: string): number {
  const now = new Date(), start = new Date(startDate);
  return Math.max(
    0,
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth()) + 1,
  );
}

function calcYearlyUsed(rows: NisaTsumitate[]): number {
  const now = new Date(), yearStart = new Date(now.getFullYear(), 0, 1);
  return rows.reduce((sum, r) => {
    const start = new Date(r.start_date);
    const effectiveStart = start > yearStart ? start : yearStart;
    const months = Math.max(
      0,
      (now.getFullYear() - effectiveStart.getFullYear()) * 12 +
      (now.getMonth() - effectiveStart.getMonth()) + 1,
    );
    return sum + r.monthly_amount * months;
  }, 0);
}

/* ----------------------------------------------------------------
 * GET: ユーザーのつみたて一覧
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
    const nav    = await fetchNav(r.fund_code);
    const months = monthsSince(r.start_date);

    let total_units: number;
    let cost_jpy: number;

    if (r.accumulation_type === 'units') {
      // ── 口数指定: シンプル計算 ──
      total_units = r.monthly_units * months;
      cost_jpy    = total_units * r.purchase_price / 10000;

    } else {
      const dates    = getAccumulationDates(r.start_date);
      cost_jpy       = r.monthly_amount * dates.length;
      const indexInfo = FUND_INDEX_MAP[r.fund_code];

      if (indexInfo && nav) {
        // ── インデックスアンカー方式（高精度）──
        // 現在の正確なNAVを起点に、インデックスの変動率で過去のNAVを逆算
        const startDate = new Date(r.start_date);
        const [indexHistory, fxHistory] = await Promise.all([
          fetchYFHistory(indexInfo.ticker, startDate),
          indexInfo.currency === 'USD'
            ? fetchYFHistory('USDJPY=X', startDate)
            : Promise.resolve([] as { date: string; close: number }[]),
        ]);

        if (indexHistory.length > 0) {
          const indexNow = indexHistory[indexHistory.length - 1].close;
          const fxNow    = indexInfo.currency === 'USD'
            ? (fxHistory[fxHistory.length - 1]?.close ?? 1)
            : 1;

          total_units = 0;
          for (const date of dates) {
            const indexOnDate = findOnOrBefore(indexHistory, date);
            if (!indexOnDate) continue;

            const fxOnDate = indexInfo.currency === 'USD'
              ? (findOnOrBefore(fxHistory, date) ?? fxNow)
              : 1;

            // 過去の推定NAV = 現在のNAV × (当時の指数/現在の指数) × (当時の為替/現在の為替)
            const navOnDate = nav * (indexOnDate / indexNow) * (fxOnDate / fxNow);
            if (navOnDate > 0) total_units += (r.monthly_amount / navOnDate) * 10000;
          }
        } else {
          // Yahoo Finance 取得失敗 → みんかぶ履歴で代替
          const history = await fetchFundHistory(r.fund_code);
          total_units = calcUnitsFromMinkabu(dates, history, r.monthly_amount, r.purchase_price);
        }
      } else {
        // ── みんかぶ履歴方式（インデックス未対応ファンドのフォールバック）──
        const history = await fetchFundHistory(r.fund_code);
        total_units = calcUnitsFromMinkabu(dates, history, r.monthly_amount, r.purchase_price);
      }
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
      user_id:          Number(userId),
      fund_code,
      fund_name,
      broker:           broker ?? 'SBI',
      accumulation_type: accumulation_type ?? 'amount',
      monthly_amount:   Number(monthly_amount ?? 0),
      monthly_units:    Number(monthly_units ?? 0),
      purchase_price:   Number(purchase_price ?? 0),
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
