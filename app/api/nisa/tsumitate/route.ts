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
 * 積立日ごとの推定 NAV を返す共通ヘルパー
 * インデックス対応ファンド → アンカー方式
 * 非対応ファンド         → みんかぶ履歴
 * ---------------------------------------------------------------- */
async function getHistoricalNavs(
  r: NisaTsumitate,
  navCurrent: number,
  dates: string[],
): Promise<number[]> {
  const indexInfo = FUND_INDEX_MAP[r.fund_code];

  if (indexInfo) {
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

      return dates.map((date) => {
        const indexOnDate = findOnOrBefore(indexHistory, date);
        if (!indexOnDate) return navCurrent; // 最終手段: 現在値で代替
        const fxOnDate = indexInfo.currency === 'USD'
          ? (findOnOrBefore(fxHistory, date) ?? fxNow)
          : 1;
        return navCurrent * (indexOnDate / indexNow) * (fxOnDate / fxNow);
      });
    }
  }

  // みんかぶ履歴フォールバック
  const history = await fetchFundHistory(r.fund_code);
  return dates.map((date) => {
    let best: number | null = null;
    for (const e of history) {
      if (e.date <= date) best = e.nav;
      else break;
    }
    return best ?? (history.length > 0 ? history[0].nav : navCurrent);
  });
}

/* ----------------------------------------------------------------
 * 積立日リストを生成（start_date の日付を基準に毎月）
 * ---------------------------------------------------------------- */
function getAccumulationDates(startDate: string, accumulationDay?: number | null): string[] {
  const dates: string[] = [];
  const start   = new Date(startDate);
  const accumDay = accumulationDay ?? start.getDate(); // 指定なしは start_date の日を使用
  const now     = new Date();
  let year = start.getFullYear(), month = start.getMonth();

  while (true) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const day     = Math.min(accumDay, daysInMonth);
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

    // 基準日方式のパラメータ（既存データは 0/null でフォールバック）
    const baselineUnits    = r.baseline_units     ?? 0;
    const baselineAvgPrice = r.baseline_avg_price ?? 0;
    const accumDay         = r.accumulation_day   ?? undefined;

    // 基準日以降の積立日リスト
    const dates = getAccumulationDates(r.start_date, accumDay);

    let postUnits: number;
    let postCost:  number;

    if (r.accumulation_type === 'units') {
      // ── 口数指定 ──
      postUnits = r.monthly_units * dates.length;
      if (nav) {
        const navs = await getHistoricalNavs(r, nav, dates);
        postCost = navs.reduce((sum, n) => sum + r.monthly_units * n / 10000, 0);
      } else {
        postCost = 0;
      }
    } else {
      // ── 金額指定: ドルコスト平均法 ──
      postCost = r.monthly_amount * dates.length;
      if (nav) {
        const navs = await getHistoricalNavs(r, nav, dates);
        postUnits = navs.reduce((sum, n) => n > 0 ? sum + (r.monthly_amount / n) * 10000 : sum, 0);
      } else {
        postUnits = 0;
      }
    }

    // 合計口数・投資総額
    const total_units = baselineUnits + postUnits;
    const cost_jpy    = (baselineUnits * baselineAvgPrice / 10000) + postCost;

    const current_value_jpy = nav != null ? total_units * nav / 10000 : null;
    const pnl_jpy = current_value_jpy != null ? current_value_jpy - cost_jpy : null;
    const pnl_pct = pnl_jpy != null && cost_jpy > 0 ? (pnl_jpy / cost_jpy) * 100 : null;

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
    start_date, accumulation_day, baseline_units, baseline_avg_price,
  } = body;

  if (!userId || !fund_code || !fund_name || !start_date) {
    return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('nisa_tsumitate')
    .insert({
      user_id:            Number(userId),
      fund_code,
      fund_name,
      broker:             broker ?? 'SBI',
      accumulation_type:  accumulation_type ?? 'amount',
      monthly_amount:     Number(monthly_amount ?? 0),
      monthly_units:      Number(monthly_units  ?? 0),
      purchase_price:     0,
      start_date,
      accumulation_day:   accumulation_day ? Number(accumulation_day) : null,
      baseline_units:     Number(baseline_units     ?? 0),
      baseline_avg_price: Number(baseline_avg_price ?? 0),
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
