import { NextResponse } from 'next/server';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const YahooFinanceClass = require('yahoo-finance2').default;
const yahooFinance = new YahooFinanceClass({ suppressNotices: ['yahooSurvey', 'ripHistorical'] }) as {
  quoteSummary: (ticker: string, opts: object) => Promise<{
    price?: { regularMarketPrice?: number };
  }>;
};

export async function GET() {
  try {
    const summary = await yahooFinance.quoteSummary('USDJPY=X', { modules: ['price'] });
    const rate = summary.price?.regularMarketPrice ?? null;
    return NextResponse.json({ rate });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ rate: null }, { status: 500 });
  }
}