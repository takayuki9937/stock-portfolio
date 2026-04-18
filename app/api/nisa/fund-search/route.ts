import { NextRequest, NextResponse } from 'next/server';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const YahooFinanceClass = require('yahoo-finance2').default;
const yahooFinance = new YahooFinanceClass({ suppressNotices: ['yahooSurvey', 'ripHistorical'] }) as {
  search: (query: string, opts?: object) => Promise<{
    quotes: Array<{
      symbol?: string;
      shortname?: string;
      longname?: string;
      quoteType?: string;
      exchDisp?: string;
    }>;
  }>;
};

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get('q');
  if (!q || q.length < 2) return NextResponse.json([]);

  try {
    const result = await yahooFinance.search(q, { quotesCount: 20, newsCount: 0 });
    const funds = result.quotes
      .filter((r) => r.symbol && (r.quoteType === 'MUTUALFUND' || r.quoteType === 'ETF' || r.quoteType === 'EQUITY'))
      .map((r) => ({
        symbol: r.symbol!,
        name: r.shortname ?? r.longname ?? r.symbol!,
        type: r.quoteType,
        exchange: r.exchDisp,
      }));
    return NextResponse.json(funds);
  } catch (e) {
    console.error(e);
    return NextResponse.json([]);
  }
}