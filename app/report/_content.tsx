'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/* ─── Types ──────────────────────────────────────────────────────── */
interface User    { id: number; name: string }
interface Holding { id: number; ticker: string; market: 'US' | 'JP' }

interface StockData {
  ticker: string; market: 'US' | 'JP'; shares: number;
  cost_price: number; current_price: number | null;
  pnl_pct: string | null; market_value: string | null;
}

interface StockAnalysis {
  ticker: string; companyName: string; currentPrice: number; market: 'US' | 'JP'; pnlPct: string | null;
  technicals: {
    ma25: number | null; ma75: number | null; ma200: number | null; rsi: number | null;
    macd: { macd: number | null; signal: number | null; hist: number | null };
    bb: { upper: number | null; middle: number | null; lower: number | null };
    avgVol: number | null; latestVol: number | null;
  };
  news: { title: string; description: string | null; url: string; publishedAt: string }[];
  analysis: { trend: string; heatmap: string; news_impact: string; summary: string };
}

interface PortfolioAnalysis {
  analysis: { spotlight: string; risk_warning: string; diversification: string };
  stockData: StockData[];
  usTotalValue: number;
  jpTotalValue: number;
}

/* ─── Helpers ────────────────────────────────────────────────────── */
function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5 text-blue-400" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function SectionCard({ title, content, color }: { title: string; content: string; color: string }) {
  return (
    <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700">
      <h4 className={`text-sm font-bold mb-2 ${color}`}>{title}</h4>
      <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-line">{content}</p>
    </div>
  );
}

function Disclaimer() {
  return (
    <p className="text-xs text-gray-500 border-t border-gray-700 pt-3 mt-3">
      ⚠️ 本レポートはAIによる情報提供であり、投資助言ではありません。<strong className="text-gray-400">投資判断は必ずご自身の責任において行ってください。</strong>
    </p>
  );
}

function fmtNum(v: number | null, dec = 2) { return v != null ? v.toFixed(dec) : 'N/A'; }
function fmtVol(v: number | null) {
  if (v == null) return 'N/A';
  return v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v.toLocaleString();
}

/* ─── Section 1: Individual Stock ───────────────────────────────── */
function StockSection({ userId, holdings }: { userId: number; holdings: Holding[] }) {
  const [ticker, setTicker]         = useState('');
  const [market, setMarket]         = useState<'US' | 'JP'>('US');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [result, setResult]         = useState<StockAnalysis | null>(null);

  // tickerが変わったらmarketも同期
  const handleSelect = (t: string) => {
    const h = holdings.find((h) => h.ticker === t);
    if (h) { setTicker(h.ticker); setMarket(h.market); }
  };

  useEffect(() => {
    if (holdings.length > 0 && !ticker) {
      setTicker(holdings[0].ticker);
      setMarket(holdings[0].market);
    }
  }, [holdings, ticker]);

  async function generate() {
    if (!ticker) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/report/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ticker, market }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || '分析に失敗しました'); return; }
      setResult(data);
    } catch {
      setError('ネットワークエラーが発生しました');
    } finally {
      setLoading(false);
    }
  }

  const cur = result?.market === 'JP' ? '¥' : '$';

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
      <h2 className="text-lg font-bold text-blue-400 mb-1">① 個別銘柄分析</h2>
      <p className="text-gray-400 text-sm mb-5">
        テクニカル指標・直近ニュースをAIが分析します。
      </p>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <select
          value={ticker}
          onChange={(e) => handleSelect(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500 min-w-36"
        >
          {holdings.length === 0 && <option value="">銘柄なし</option>}
          {holdings.map((h) => (
            <option key={h.id} value={h.ticker}>
              {h.market === 'JP' ? '🇯🇵 ' : '🇺🇸 '}{h.ticker}
            </option>
          ))}
        </select>
        <button
          onClick={generate}
          disabled={loading || !ticker}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
        >
          {loading ? <><Spinner />分析中...</> : 'AI分析'}
        </button>
        {result && !loading && (
          <button onClick={generate}
            className="text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded px-3 py-1.5 transition-colors">
            再生成
          </button>
        )}
      </div>
      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-4 pb-4 border-b border-gray-800">
            <div>
              <p className="text-sm text-gray-400">{result.companyName}</p>
              <p className="text-2xl font-bold">{cur}{result.currentPrice.toFixed(result.market === 'JP' ? 0 : 2)}</p>
            </div>
            {result.pnlPct != null && (
              <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                parseFloat(result.pnlPct) >= 0 ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
              }`}>
                {parseFloat(result.pnlPct) >= 0 ? '+' : ''}{result.pnlPct}%
              </span>
            )}
          </div>

          {/* Technicals summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {[
              { label: 'MA25',  val: result.technicals.ma25  != null ? `${cur}${fmtNum(result.technicals.ma25,  result.market === 'JP' ? 0 : 2)}` : 'N/A' },
              { label: 'MA75',  val: result.technicals.ma75  != null ? `${cur}${fmtNum(result.technicals.ma75,  result.market === 'JP' ? 0 : 2)}` : 'N/A' },
              { label: 'MA200', val: result.technicals.ma200 != null ? `${cur}${fmtNum(result.technicals.ma200, result.market === 'JP' ? 0 : 2)}` : 'N/A' },
              { label: 'RSI(14)', val: fmtNum(result.technicals.rsi, 1),
                color: result.technicals.rsi != null
                  ? result.technicals.rsi >= 70 ? 'text-red-400'
                  : result.technicals.rsi <= 30 ? 'text-green-400' : 'text-white'
                  : 'text-white'
              },
              { label: 'MACD',    val: fmtNum(result.technicals.macd.macd,   3) },
              { label: 'Signal',  val: fmtNum(result.technicals.macd.signal,  3) },
              { label: 'BB上限',  val: result.technicals.bb.upper  != null ? `${cur}${fmtNum(result.technicals.bb.upper,  result.market === 'JP' ? 0 : 2)}` : 'N/A' },
              { label: 'BB下限',  val: result.technicals.bb.lower  != null ? `${cur}${fmtNum(result.technicals.bb.lower,  result.market === 'JP' ? 0 : 2)}` : 'N/A' },
              { label: '直近出来高', val: fmtVol(result.technicals.latestVol) },
              { label: '20日平均出来高', val: fmtVol(result.technicals.avgVol) },
            ].map((item) => (
              <div key={item.label} className="bg-gray-800/50 rounded p-2">
                <p className="text-gray-500 mb-0.5">{item.label}</p>
                <p className={`font-semibold ${(item as {color?: string}).color ?? 'text-white'}`}>{item.val}</p>
              </div>
            ))}
          </div>

          {/* Analysis sections */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SectionCard title="① トレンド分析（MA・MACD）"    content={result.analysis.trend}       color="text-blue-400" />
            <SectionCard title="② 過熱感（RSI・ボリンジャー）" content={result.analysis.heatmap}     color="text-purple-400" />
            <SectionCard title="③ ニュースの影響"               content={result.analysis.news_impact} color="text-amber-400" />
            <SectionCard title="④ 総合コメント"                  content={result.analysis.summary}     color="text-green-400" />
          </div>

          {/* News list */}
          {result.news.length > 0 && (
            <div className="bg-gray-800/40 rounded-lg p-4 border border-gray-700">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">直近ニュース</h4>
              <ul className="space-y-2">
                {result.news.map((n, i) => (
                  <li key={i} className="text-xs">
                    <a href={n.url} target="_blank" rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 font-semibold leading-snug">
                      {n.title}
                    </a>
                    {n.description && <p className="text-gray-500 mt-0.5 line-clamp-2">{n.description}</p>}
                    <p className="text-gray-600 mt-0.5">{new Date(n.publishedAt).toLocaleDateString('ja-JP')}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Disclaimer />
        </div>
      )}
    </div>
  );
}

/* ─── Section 2: Portfolio ───────────────────────────────────────── */
function PortfolioSection({ userId }: { userId: number }) {
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [result, setResult]     = useState<PortfolioAnalysis | null>(null);

  async function generate() {
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'レポート生成に失敗しました'); return; }
      setResult(data);
    } catch {
      setError('ネットワークエラーが発生しました');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
      <h2 className="text-lg font-bold text-blue-400 mb-1">② ポートフォリオ全体分析</h2>
      <p className="text-gray-400 text-sm mb-5">
        登録中の全銘柄データをAIが総合分析します。
      </p>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <button
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
        >
          {loading ? <><Spinner />生成中...</> : '全体レポート生成'}
        </button>
        {result && !loading && (
          <button onClick={generate}
            className="text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded px-3 py-1.5 transition-colors">
            再生成
          </button>
        )}
      </div>
      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Stock table */}
          <div className="overflow-x-auto rounded-lg border border-gray-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase bg-gray-800/50">
                  <th className="px-4 py-2">銘柄</th>
                  <th className="px-4 py-2 text-right">株数</th>
                  <th className="px-4 py-2 text-right">取得価格</th>
                  <th className="px-4 py-2 text-right">現在価格</th>
                  <th className="px-4 py-2 text-right">評価額</th>
                  <th className="px-4 py-2 text-right">損益</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {result.stockData.map((s) => (
                  <tr key={s.ticker} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-2.5 font-bold text-blue-400">
                      {s.market === 'JP' ? '🇯🇵 ' : '🇺🇸 '}{s.ticker}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-300">{s.shares}</td>
                    <td className="px-4 py-2.5 text-right text-gray-300">
                      {s.market === 'JP' ? '¥' : '$'}{s.cost_price}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-300">
                      {s.current_price != null ? `${s.market === 'JP' ? '¥' : '$'}${s.current_price.toFixed(s.market === 'JP' ? 0 : 2)}` : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-300">
                      {s.market_value != null ? `${s.market === 'JP' ? '¥' : '$'}${s.market_value}` : '-'}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${
                      s.pnl_pct && parseFloat(s.pnl_pct) >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {s.pnl_pct ? `${parseFloat(s.pnl_pct) >= 0 ? '+' : ''}${s.pnl_pct}%` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-gray-700 bg-gray-800/30">
                {result.usTotalValue > 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-xs text-gray-400">🇺🇸 米国株 合計</td>
                    <td colSpan={2} className="px-4 py-2 text-right font-bold text-white">
                      ${result.usTotalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                )}
                {result.jpTotalValue > 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-xs text-gray-400">🇯🇵 日本株 合計</td>
                    <td colSpan={2} className="px-4 py-2 text-right font-bold text-white">
                      ¥{result.jpTotalValue.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>

          {/* Analysis sections */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SectionCard title="① 注目銘柄"       content={result.analysis.spotlight}      color="text-amber-400" />
            <SectionCard title="② リスク警告"      content={result.analysis.risk_warning}   color="text-red-400" />
            <SectionCard title="③ 分散投資の提案"  content={result.analysis.diversification} color="text-green-400" />
          </div>

          <Disclaimer />
        </div>
      )}
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────── */
export function ReportContent() {
  const [users, setUsers]             = useState<User[]>([]);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [holdings, setHoldings]       = useState<Holding[]>([]);

  useEffect(() => {
    fetch('/api/users').then((r) => r.json()).then((data: User[]) => {
      setUsers(data);
      if (data.length > 0) setActiveUserId(data[0].id);
    });
  }, []);

  useEffect(() => {
    if (activeUserId === null) return;
    fetch(`/api/portfolio?userId=${activeUserId}`)
      .then((r) => r.json())
      .then((data: Holding[]) => setHoldings(data));
  }, [activeUserId]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Nav */}
      <nav className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-blue-400">株ポートフォリオ</h1>
          <div className="flex gap-6 items-center">
            <Link href="/" className="text-gray-400 hover:text-gray-200 transition-colors">一覧</Link>
            <Link href="/chart" className="text-gray-400 hover:text-gray-200 transition-colors">チャート</Link>
            <Link href="/report" className="text-blue-400 font-semibold border-b-2 border-blue-400 pb-1">AIレポート</Link>
            <Link href="/admin" className="text-gray-500 hover:text-gray-300 text-sm transition-colors">管理</Link>
          </div>
        </div>
      </nav>

      {/* User tabs */}
      <div className="bg-gray-900 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-1 overflow-x-auto">
            {users.map((u) => (
              <button key={u.id} onClick={() => setActiveUserId(u.id)}
                className={`px-5 py-3 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 ${
                  activeUserId === u.id ? 'text-blue-400 border-blue-400' : 'text-gray-400 border-transparent hover:text-gray-200'
                }`}>
                {u.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {activeUserId !== null && (
          <>
            <StockSection userId={activeUserId} holdings={holdings} />
            <PortfolioSection key={activeUserId} userId={activeUserId} />
          </>
        )}
      </main>
    </div>
  );
}
