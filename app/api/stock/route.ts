import { NextRequest, NextResponse } from 'next/server';
import { toYfTicker } from '@/lib/db';

// yahoo-finance2 v3 はコンストラクタ呼び出しが必要
// eslint-disable-next-line @typescript-eslint/no-require-imports
const YahooFinanceClass = require('yahoo-finance2').default;
const yahooFinance = new YahooFinanceClass({ suppressNotices: ['yahooSurvey', 'ripHistorical'] }) as {
  quoteSummary: (ticker: string, opts: object) => Promise<{
    price?: { regularMarketPrice?: number; shortName?: string; longName?: string };
  }>;
  chart: (ticker: string, opts: object) => Promise<{
    quotes: Array<{ date: Date; open: number; high: number; low: number; close: number; volume?: number }>;
  }>;
};

// Yahoo Finance のインターバル別・最大取得日数
const INTERVAL_MAX_DAYS: Record<string, number> = {
  '1m':  7,
  '5m':  60,
  '15m': 60,
  '60m': 730,
  '1d':  Infinity,
  '1wk': Infinity,
  '1mo': Infinity,
};

const PERIOD_DAYS: Record<string, number> = {
  day:   1,
  week:  7,
  month: 30,
  year:  365,
};

// 有効なインターバル一覧
const VALID_INTERVALS = Object.keys(INTERVAL_MAX_DAYS);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker   = searchParams.get('ticker');
  const market   = (searchParams.get('market') ?? 'US') as 'US' | 'JP';
  const period   = searchParams.get('period') || 'day';
  const interval = searchParams.get('interval') || '1d';

  if (!ticker) {
    return NextResponse.json({ error: 'ticker is required' }, { status: 400 });
  }

  // インターバルの検証
  if (!VALID_INTERVALS.includes(interval)) {
    return NextResponse.json({ error: '無効なインターバルです' }, { status: 400 });
  }

  // period × interval の組み合わせ検証
  const periodDays  = PERIOD_DAYS[period] ?? 1;
  const maxDays     = INTERVAL_MAX_DAYS[interval];
  if (periodDays > maxDays) {
    return NextResponse.json({
      error: 'invalid_combo',
      message: `${interval} 足は最大 ${maxDays} 日分しか取得できません。期間を短くしてください。`,
    }, { status: 400 });
  }

  const yfTicker = toYfTicker(ticker, market);

  try {
    // 現在価格
    const summary = await yahooFinance.quoteSummary(yfTicker, { modules: ['price'] });
    const currentPrice: number = summary.price?.regularMarketPrice ?? 0;
    const companyName: string  = summary.price?.shortName ?? summary.price?.longName ?? ticker;

    // 期間の計算
    const now = new Date();
    const startDate = new Date(now);
    if      (period === 'day')   startDate.setDate(now.getDate() - 1);
    else if (period === 'week')  startDate.setDate(now.getDate() - 7);
    else if (period === 'month') startDate.setMonth(now.getMonth() - 1);
    else if (period === 'year')  startDate.setFullYear(now.getFullYear() - 1);

    // chart() API でOHLCデータを取得
    const result = await yahooFinance.chart(yfTicker, {
      period1:  startDate,
      period2:  now,
      interval: interval,
    });

    const quotes = result.quotes ?? [];

    return NextResponse.json({
      ticker,
      currentPrice,
      companyName,
      history: quotes
        .filter((q) => q.close != null)
        .map((q) => ({
          date:   q.date.toISOString(),
          open:   q.open,
          high:   q.high,
          low:    q.low,
          close:  q.close,
          volume: q.volume,
        })),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: '株価の取得に失敗しました' }, { status: 500 });
  }
}