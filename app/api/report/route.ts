import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/lib/supabase';
import { toYfTicker } from '@/lib/db';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const YahooFinanceClass = require('yahoo-finance2').default;
const yahooFinance = new YahooFinanceClass({ suppressNotices: ['yahooSurvey'] }) as {
  quoteSummary: (ticker: string, opts: object) => Promise<{ price?: { regularMarketPrice?: number } }>;
};

export async function POST(req: Request) {
  const { userId } = await req.json().catch(() => ({ userId: null }));
  let query = supabase.from('holdings').select('*');
  if (userId) query = query.eq('user_id', Number(userId));
  const { data: rawHoldings } = await query;
  if (!rawHoldings) return NextResponse.json({ error: 'DBエラー' }, { status: 500 });
  const holdings = rawHoldings as Array<{ ticker: string; market: 'US' | 'JP'; shares: number; cost_price: number }>;

  if (holdings.length === 0) {
    return NextResponse.json({ error: '銘柄が登録されていません' }, { status: 400 });
  }

  // 各銘柄の現在価格を取得
  const stockData = await Promise.all(
    holdings.map(async (h) => {
      try {
        const summary = await yahooFinance.quoteSummary(toYfTicker(h.ticker, h.market), { modules: ['price'] });
        const currentPrice: number = summary.price?.regularMarketPrice ?? 0;
        const pnlPct = ((currentPrice - h.cost_price) / h.cost_price) * 100;
        return {
          ticker: h.ticker,
          market: h.market,
          shares: h.shares,
          cost_price: h.cost_price,
          current_price: currentPrice,
          pnl_pct: pnlPct.toFixed(2),
          market_value: (currentPrice * h.shares).toFixed(2),
        };
      } catch {
        return {
          ticker: h.ticker,
          market: h.market,
          shares: h.shares,
          cost_price: h.cost_price,
          current_price: null,
          pnl_pct: null,
          market_value: null,
        };
      }
    })
  );

  // US/JP 別に集計
  const usStocks = stockData.filter((s) => s.market === 'US');
  const jpStocks = stockData.filter((s) => s.market === 'JP');
  const usTotalValue = usStocks.reduce((sum, s) => sum + (parseFloat(s.market_value ?? '0') || 0), 0);
  const jpTotalValue = jpStocks.reduce((sum, s) => sum + (parseFloat(s.market_value ?? '0') || 0), 0);

  const prompt = `以下は株式ポートフォリオのデータです。ポートフォリオ全体分析を日本語で作成してください。必ず以下のJSON形式のみで返答してください（余計なテキスト不要）：
{
  "spotlight": "...",
  "risk_warning": "...",
  "diversification": "..."
}

【米国株】
${usStocks.length > 0
    ? usStocks.map((s) =>
        `- ${s.ticker}: ${s.shares}株 / 取得$${s.cost_price} / 現在${s.current_price != null ? '$' + s.current_price.toFixed(2) : 'N/A'} / 損益${s.pnl_pct ?? 'N/A'}% / 評価額$${s.market_value ?? 'N/A'}`
      ).join('\n')
    : 'なし'
}
米国株合計評価額: $${usTotalValue.toFixed(2)}

【日本株】
${jpStocks.length > 0
    ? jpStocks.map((s) =>
        `- ${s.ticker}: ${s.shares}株 / 取得¥${s.cost_price} / 現在${s.current_price != null ? '¥' + s.current_price.toFixed(0) : 'N/A'} / 損益${s.pnl_pct ?? 'N/A'}% / 評価額¥${s.market_value ?? 'N/A'}`
      ).join('\n')
    : 'なし'
}
日本株合計評価額: ¥${jpTotalValue.toFixed(0)}

各フィールドの内容：
- spotlight: 特に注目すべき銘柄とその理由（損益が大きい/小さい銘柄など）（300字程度）
- risk_warning: ポートフォリオ全体のリスク警告（集中リスク・下落銘柄など）（300字程度）
- diversification: 分散投資の観点からの提案・改善アドバイス（300字程度）`;

  const client = new Anthropic();
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0].type === 'text' ? message.content[0].text : '{}';
  let analysis: { spotlight: string; risk_warning: string; diversification: string };
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { spotlight: raw, risk_warning: '', diversification: '' };
  } catch {
    analysis = { spotlight: raw, risk_warning: '', diversification: '' };
  }

  return NextResponse.json({ analysis, stockData, usTotalValue, jpTotalValue });
}