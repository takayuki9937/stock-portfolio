import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/lib/supabase';
import { toYfTicker } from '@/lib/db';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const YahooFinanceClass = require('yahoo-finance2').default;
const yahooFinance = new YahooFinanceClass({ suppressNotices: ['yahooSurvey', 'ripHistorical'] }) as {
  quoteSummary: (t: string, o: object) => Promise<{
    price?: { regularMarketPrice?: number; shortName?: string; longName?: string };
  }>;
  chart: (t: string, o: object) => Promise<{
    quotes: Array<{ date: Date; open: number; high: number; low: number; close: number; volume?: number }>;
  }>;
};

/* ── Technical indicator helpers ── */
function smaLast(arr: number[], n: number): number | null {
  if (arr.length < n) return null;
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n;
}

function emaLast(arr: number[], n: number): number | null {
  if (arr.length < n) return null;
  const k = 2 / (n + 1);
  let e = arr.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
}

function rsiLast(arr: number[], n = 14): number | null {
  if (arr.length <= n) return null;
  let ag = 0, al = 0;
  for (let i = 1; i <= n; i++) {
    const c = arr[i] - arr[i - 1];
    if (c > 0) ag += c; else al -= c;
  }
  ag /= n; al /= n;
  for (let i = n + 1; i < arr.length; i++) {
    const c = arr[i] - arr[i - 1];
    ag = (ag * (n - 1) + (c > 0 ? c : 0)) / n;
    al = (al * (n - 1) + (c < 0 ? -c : 0)) / n;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function macdLast(arr: number[]): { macd: number | null; signal: number | null; hist: number | null } {
  const sp = 12, lp = 26, sig = 9;
  if (arr.length < lp + sig) return { macd: null, signal: null, hist: null };
  const k12 = 2 / (sp + 1), k26 = 2 / (lp + 1), ks = 2 / (sig + 1);
  let e12 = arr.slice(0, sp).reduce((a, b) => a + b, 0) / sp;
  let e26 = arr.slice(0, lp).reduce((a, b) => a + b, 0) / lp;
  for (let i = sp; i < arr.length; i++) e12 = arr[i] * k12 + e12 * (1 - k12);
  for (let i = lp; i < arr.length; i++) e26 = arr[i] * k26 + e26 * (1 - k26);
  // build MACD series from index lp-1 onward
  const macdSeries: number[] = [];
  let e12b = arr.slice(0, sp).reduce((a, b) => a + b, 0) / sp;
  let e26b = arr.slice(0, lp).reduce((a, b) => a + b, 0) / lp;
  for (let i = sp; i < lp; i++) e12b = arr[i] * k12 + e12b * (1 - k12);
  for (let i = lp; i < arr.length; i++) {
    e12b = arr[i] * k12 + e12b * (1 - k12);
    e26b = arr[i] * k26 + e26b * (1 - k26);
    macdSeries.push(e12b - e26b);
  }
  const macdVal = macdSeries[macdSeries.length - 1];
  if (macdSeries.length < sig) return { macd: macdVal, signal: null, hist: null };
  let sigE = macdSeries.slice(0, sig).reduce((a, b) => a + b, 0) / sig;
  for (let i = sig; i < macdSeries.length; i++) sigE = macdSeries[i] * ks + sigE * (1 - ks);
  return { macd: macdVal, signal: sigE, hist: macdVal - sigE };
}

function bbLast(arr: number[], n = 20): { upper: number | null; middle: number | null; lower: number | null } {
  if (arr.length < n) return { upper: null, middle: null, lower: null };
  const slice = arr.slice(-n);
  const mid = slice.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(slice.reduce((s, v) => s + (v - mid) ** 2, 0) / n);
  return { upper: mid + 2 * std, middle: mid, lower: mid - 2 * std };
}

/* ── NewsAPI ── */
interface NewsArticle { title: string; description: string | null; url: string; publishedAt: string }

async function fetchNews(query: string): Promise<NewsArticle[]> {
  const key = process.env.NEWS_API_KEY;
  if (!key) return [];
  try {
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&pageSize=10&sortBy=publishedAt&apiKey=${key}`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.articles ?? []).slice(0, 10) as NewsArticle[];
  } catch {
    return [];
  }
}

/* ── Route ── */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { userId, ticker, market } = body as { userId: number; ticker: string; market: 'US' | 'JP' };

  if (!ticker || !market) return NextResponse.json({ error: 'ticker と market が必要です' }, { status: 400 });

  const { data: holdingRow } = await supabase
    .from('holdings')
    .select('*')
    .eq('user_id', userId)
    .eq('ticker', ticker)
    .single();
  const holding = holdingRow as { cost_price: number } | null;

  const yfTicker = toYfTicker(ticker, market);
  const currency = market === 'JP' ? '¥' : '$';

  // 現在価格 + 会社名
  const summary = await yahooFinance.quoteSummary(yfTicker, { modules: ['price'] });
  const currentPrice: number = summary.price?.regularMarketPrice ?? 0;
  const companyName: string  = summary.price?.shortName ?? summary.price?.longName ?? ticker;

  // 1年分の日足データ（MA200計算用）
  const now = new Date();
  const start = new Date(now); start.setFullYear(now.getFullYear() - 1);
  const chartResult = await yahooFinance.chart(yfTicker, { period1: start, period2: now, interval: '1d' });
  const quotes = (chartResult.quotes ?? []).filter((q) => q.close != null);
  const closes  = quotes.map((q) => q.close);
  const volumes = quotes.map((q) => q.volume ?? 0);

  // テクニカル指標
  const ma25  = smaLast(closes, 25);
  const ma75  = smaLast(closes, 75);
  const ma200 = smaLast(closes, 200);
  const rsi   = rsiLast(closes);
  const macd  = macdLast(closes);
  const bb    = bbLast(closes);
  const avgVol = volumes.length ? Math.round(volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length)) : null;
  const latestVol = volumes.length ? volumes[volumes.length - 1] : null;

  // P&L
  const pnlPct = holding ? ((currentPrice - holding.cost_price) / holding.cost_price * 100).toFixed(2) : null;

  // ニュース取得
  const newsQuery = `${ticker} stock`;
  const news = await fetchNews(newsQuery);

  const fmt = (v: number | null) => v != null ? `${currency}${v.toFixed(market === 'JP' ? 0 : 2)}` : 'N/A';
  const fmtN = (v: number | null, d = 2) => v != null ? v.toFixed(d) : 'N/A';

  const techText = `
- 現在価格: ${fmt(currentPrice)}
- MA25: ${fmt(ma25)}　MA75: ${fmt(ma75)}　MA200: ${fmt(ma200)}
- RSI(14): ${fmtN(rsi, 1)}
- MACD: ${fmtN(macd.macd, 3)} / シグナル: ${fmtN(macd.signal, 3)} / ヒストグラム: ${fmtN(macd.hist, 3)}
- ボリンジャーバンド: 上限 ${fmt(bb.upper)} / 中心 ${fmt(bb.middle)} / 下限 ${fmt(bb.lower)}
- 直近出来高: ${latestVol?.toLocaleString() ?? 'N/A'} (20日平均: ${avgVol?.toLocaleString() ?? 'N/A'})
${holding ? `- 取得価格: ${fmt(holding.cost_price)} / 損益: ${pnlPct}%` : ''}`.trim();

  const newsText = news.length > 0
    ? news.map((n, i) => `${i + 1}. ${n.title}${n.description ? `\n   ${n.description}` : ''}`).join('\n')
    : 'ニュースが取得できませんでした';

  const prompt = `以下の銘柄の投資分析レポートを日本語で作成してください。必ず以下のJSON形式のみで返答してください（余計なテキスト不要）：
{
  "trend": "...",
  "heatmap": "...",
  "news_impact": "...",
  "summary": "..."
}

【銘柄】${ticker}（${companyName}）/ ${market === 'JP' ? '日本株' : '米国株'}

【テクニカル指標】
${techText}

【直近ニュース（NewsAPI）】
${newsText}

各フィールドの内容：
- trend: MA・MACDのトレンド分析（200字程度）
- heatmap: RSI・ボリンジャーバンドから見た過熱感・割安感（200字程度）
- news_impact: ニュースが株価に与える影響の分析（200字程度）
- summary: 総合コメント。買い・中立・売りのスタンスを明示（300字程度）`;

  const client = new Anthropic();
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0].type === 'text' ? message.content[0].text : '{}';
  let analysis: { trend: string; heatmap: string; news_impact: string; summary: string };
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { trend: raw, heatmap: '', news_impact: '', summary: '' };
  } catch {
    analysis = { trend: raw, heatmap: '', news_impact: '', summary: '' };
  }

  return NextResponse.json({
    ticker, companyName, currentPrice, market, pnlPct,
    technicals: { ma25, ma75, ma200, rsi, macd, bb, avgVol, latestVol },
    news: news.map((n) => ({ title: n.title, description: n.description, url: n.url, publishedAt: n.publishedAt })),
    analysis,
  });
}