'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

/* ─── Types ──────────────────────────────────────────────────────── */
interface User    { id: number; name: string }
interface Holding {
  id: number; user_id: number; ticker: string; market: 'US' | 'JP'; shares: number; cost_price: number;
  company_name?: string; current_price?: number | null; pnl_pct?: number | null; market_value?: number | null;
}
interface TsumiItem {
  id: number; fund_code: string; fund_name: string;
  broker: string; accumulation_type: 'amount' | 'units';
  monthly_amount: number; monthly_units: number; purchase_price: number; start_date: string;
  nav: number | null; months: number; total_units: number;
  cost_jpy: number; current_value_jpy: number | null; pnl_jpy: number | null; pnl_pct: number | null;
}
interface GrowthItem {
  id: number; type: 'fund' | 'stock'; market: 'JP' | 'US'; code: string; fund_name: string;
  units_or_shares: number; purchase_price: number; purchase_date: string;
  current_price: number | null; current_value_jpy: number | null; cost_jpy: number; pnl_jpy: number | null; pnl_pct: number | null;
}

/* ─── Helpers ────────────────────────────────────────────────────── */
function pnlColor(v: number | null) { return v == null ? 'text-gray-400' : v >= 0 ? 'text-green-400' : 'text-red-400'; }
function pnlSign(v: number) { return v >= 0 ? '+' : ''; }
function jpy(v: number) { return `¥${Math.round(v).toLocaleString('ja-JP')}`; }

function Spinner({ sm }: { sm?: boolean }) {
  return (
    <svg className={`animate-spin text-blue-400 ${sm ? 'h-4 w-4' : 'h-5 w-5'}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function PnlBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-gray-500">-</span>;
  return (
    <span className={`font-semibold ${pnlColor(pct)}`}>
      {pnlSign(pct)}{pct.toFixed(2)}%
    </span>
  );
}

function ProgressBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = Math.min(100, (used / limit) * 100);
  const remaining = Math.max(0, limit - used);
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>{label} 年間投資枠</span>
        <span>残り {jpy(remaining)} / {jpy(limit)}</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-blue-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-gray-500 mt-0.5">使用済み {jpy(used)} ({pct.toFixed(1)}%)</p>
    </div>
  );
}

/* ─── Minkabu Fund Search Combobox ───────────────────────────────── */
interface MinkabuFund { name: string; fundCode: string; nav: number | null }

function FundSearch({ onSelect }: { onSelect: (code: string, name: string) => void }) {
  const [query, setQuery]               = useState('');
  const [results, setResults]           = useState<MinkabuFund[]>([]);
  const [loading, setLoading]           = useState(false);
  const [selectedName, setSelectedName] = useState('');
  const [showManual, setShowManual]     = useState(false);
  const [manualCode, setManualCode]     = useState('');
  const [manualName, setManualName]     = useState('');

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/nisa/search?keyword=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.results ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [query]);

  function select(code: string, name: string) {
    onSelect(code, name);
    setSelectedName(name);
    setQuery(name);
    setResults([]);
  }

  return (
    <div className="relative col-span-2">
      <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5">
        <input
          type="text"
          value={query}
          placeholder="ファンド名で検索 (例: eMAXIS Slim、FANG+、オルカン)"
          onChange={(e) => { setQuery(e.target.value); setSelectedName(''); }}
          className="bg-transparent text-sm focus:outline-none flex-1 min-w-0"
        />
        {loading && <Spinner sm />}
        {selectedName && !loading && <span className="text-green-400 text-xs shrink-0">✓</span>}
      </div>

      {results.length > 0 && !selectedName && (
        <ul className="absolute z-50 top-full left-0 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-auto max-h-64 shadow-xl">
          {results.map((f) => (
            <li key={f.fundCode}>
              <button type="button"
                onClick={() => select(f.fundCode, f.name)}
                className="w-full text-left px-3 py-2 hover:bg-gray-700 transition-colors border-b border-gray-700/50 last:border-0">
                <p className="text-sm font-semibold text-blue-300 leading-snug">{f.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {f.fundCode}
                  {f.nav != null && (
                    <span className="ml-2 text-gray-400">基準価額 ¥{f.nav.toLocaleString()}</span>
                  )}
                </p>
              </button>
            </li>
          ))}
          <li>
            <button type="button"
              onClick={() => { setResults([]); setShowManual(true); }}
              className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:bg-gray-700 transition-colors">
              + 見つからない場合は手動入力
            </button>
          </li>
        </ul>
      )}

      {query.length >= 2 && results.length === 0 && !selectedName && !loading && (
        <div className="absolute z-50 top-full left-0 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl">
          <p className="px-3 py-2 text-xs text-gray-500">「{query}」に一致するファンドが見つかりません</p>
          <button type="button"
            onClick={() => { setResults([]); setShowManual(true); }}
            className="w-full text-left px-3 py-2 text-xs text-blue-400 hover:bg-gray-700 border-t border-gray-700 transition-colors">
            + 手動でファンド名とコードを入力する
          </button>
        </div>
      )}

      {showManual && (
        <div className="mt-2 p-3 bg-gray-800 border border-gray-700 rounded-lg space-y-2">
          <p className="text-xs text-gray-400 font-semibold">手動入力</p>
          <input type="text" placeholder="ファンド名" value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500" />
          <input type="text" placeholder="ファンドコード (例: 03311187)" value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500" />
          <div className="flex gap-2">
            <button type="button"
              onClick={() => { if (manualCode && manualName) { select(manualCode, manualName); setShowManual(false); } }}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-semibold">
              決定
            </button>
            <button type="button" onClick={() => setShowManual(false)}
              className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1 rounded text-xs">
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Segment Header ─────────────────────────────────────────────── */
function SegmentHeader({
  title, badge, totalJpy, costJpy, icon,
}: {
  title: string; badge?: string; totalJpy: number | null; costJpy: number; icon: string;
}) {
  const pnlJpy = totalJpy != null ? totalJpy - costJpy : null;
  const pnlPct = pnlJpy != null && costJpy > 0 ? (pnlJpy / costJpy) * 100 : null;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <div>
          <h2 className="text-base font-bold text-gray-100">{title}</h2>
          {badge && <span className="text-xs bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded-full border border-blue-800">{badge}</span>}
        </div>
      </div>
      <div className="text-right">
        <p className="text-xs text-gray-500">評価額</p>
        <p className="text-xl font-bold">{totalJpy != null ? jpy(totalJpy) : '-'}</p>
        {pnlJpy != null && (
          <p className={`text-sm font-semibold ${pnlColor(pnlPct)}`}>
            {pnlSign(pnlJpy)}{jpy(pnlJpy)} ({pnlSign(pnlPct ?? 0)}{pnlPct?.toFixed(2)}%)
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Segment 1: 個別株 ──────────────────────────────────────────── */
function StocksSegment({ userId, usdJpy }: { userId: number; usdJpy: number | null }) {
  const [holdings, setHoldings]   = useState<Holding[]>([]);
  const [loading, setLoading]     = useState(true);
  const [form, setForm]           = useState({ ticker: '', market: 'US' as 'US' | 'JP', shares: '', cost_price: '' });
  const [error, setError]         = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchHoldings = useCallback(async () => {
    setLoading(true);
    const res  = await fetch(`/api/portfolio?userId=${userId}`);
    const data: Holding[] = await res.json();
    const withPrices = await Promise.all(data.map(async (h) => {
      try {
        const r = await fetch(`/api/stock?ticker=${h.ticker}&market=${h.market}&period=day`);
        const s = await r.json();
        if (!r.ok || s.currentPrice == null) throw new Error();
        return { ...h, company_name: s.companyName ?? h.ticker, current_price: s.currentPrice, market_value: s.currentPrice * h.shares, pnl_pct: ((s.currentPrice - h.cost_price) / h.cost_price) * 100 };
      } catch {
        return { ...h, company_name: h.ticker, current_price: null, market_value: null, pnl_pct: null };
      }
    }));
    setHoldings(withPrices);
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchHoldings(); }, [fetchHoldings]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSubmitting(true);
    const res = await fetch('/api/portfolio', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, ticker: form.ticker, market: form.market, shares: parseFloat(form.shares), cost_price: parseFloat(form.cost_price) }),
    });
    setSubmitting(false);
    if (!res.ok) { const d = await res.json(); setError(d.error || 'エラー'); return; }
    setForm({ ticker: '', market: 'US', shares: '', cost_price: '' });
    fetchHoldings();
  }

  async function handleDelete(id: number) {
    await fetch('/api/portfolio', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    fetchHoldings();
  }

  // 円換算
  const rate = usdJpy ?? 150;
  const toJpy = (h: Holding) => h.market_value == null ? null : h.market === 'US' ? h.market_value * rate : h.market_value;
  const toCostJpy = (h: Holding) => h.market === 'US' ? h.cost_price * h.shares * rate : h.cost_price * h.shares;

  const totalJpy = holdings.every((h) => toJpy(h) == null) ? null : holdings.reduce((s, h) => s + (toJpy(h) ?? 0), 0);
  const costJpy  = holdings.reduce((s, h) => s + toCostJpy(h), 0);

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <SegmentHeader title="個別株" badge="セグメント①" totalJpy={totalJpy} costJpy={costJpy} icon="📈" />

      {/* 追加フォーム */}
      <form onSubmit={handleAdd} className="flex flex-wrap gap-2 mb-4">
        <select value={form.market} onChange={(e) => setForm({ ...form, market: e.target.value as 'US' | 'JP' })}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500">
          <option value="US">🇺🇸 米国株</option>
          <option value="JP">🇯🇵 日本株</option>
        </select>
        <input type="text" placeholder={form.market === 'JP' ? 'コード (例: 7203)' : 'コード (例: AAPL)'} value={form.ticker}
          onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 w-36" required />
        <input type="number" placeholder="株数" value={form.shares} onChange={(e) => setForm({ ...form, shares: e.target.value })}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 w-28" min="0.001" step="any" required />
        <input type="number" placeholder={`取得価格 (${form.market === 'JP' ? '¥' : '$'})`} value={form.cost_price}
          onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 w-36" min="0.01" step="any" required />
        <button type="submit" disabled={submitting}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors">
          {submitting ? '追加中...' : '+ 追加'}
        </button>
      </form>
      {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center h-20"><Spinner /></div>
      ) : holdings.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-6">銘柄が登録されていません</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase">
                <th className="pb-2 text-left">銘柄</th>
                <th className="pb-2 text-right">株数</th>
                <th className="pb-2 text-right">取得価格</th>
                <th className="pb-2 text-right">現在価格</th>
                <th className="pb-2 text-right">評価額</th>
                <th className="pb-2 text-right">円換算</th>
                <th className="pb-2 text-right">損益</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {holdings.map((h) => {
                const cur = h.market === 'JP' ? '¥' : '$';
                const val_jpy = toJpy(h);
                return (
                  <tr key={h.id} className="hover:bg-gray-800/40 transition-colors">
                    <td className="py-2.5 pr-2">
                      <span className="font-bold text-blue-400">{h.ticker}</span>
                      <span className="ml-1 text-xs">{h.market === 'JP' ? '🇯🇵' : '🇺🇸'}</span>
                      {h.company_name && <p className="text-xs text-gray-500 truncate max-w-32">{h.company_name}</p>}
                    </td>
                    <td className="py-2.5 text-right text-gray-300">{h.shares}</td>
                    <td className="py-2.5 text-right text-gray-300">{cur}{h.cost_price.toFixed(h.market === 'JP' ? 0 : 2)}</td>
                    <td className="py-2.5 text-right text-gray-300">
                      {h.current_price != null ? `${cur}${h.current_price.toFixed(h.market === 'JP' ? 0 : 2)}` : '-'}
                    </td>
                    <td className="py-2.5 text-right text-gray-300">
                      {h.market_value != null ? `${cur}${h.market_value.toLocaleString('en-US', { minimumFractionDigits: h.market === 'JP' ? 0 : 2, maximumFractionDigits: h.market === 'JP' ? 0 : 2 })}` : '-'}
                    </td>
                    <td className="py-2.5 text-right text-gray-300">
                      {val_jpy != null ? jpy(val_jpy) : '-'}
                    </td>
                    <td className="py-2.5 text-right">
                      <PnlBadge pct={h.pnl_pct ?? null} />
                    </td>
                    <td className="py-2.5 text-right pl-2">
                      <button onClick={() => handleDelete(h.id)} className="text-red-400 hover:text-red-300 text-xs transition-colors">削除</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Segment 2: つみたて投資枠 ─────────────────────────────────── */
function TsumitateSgment({ userId }: { userId: number }) {
  const [items, setItems]           = useState<TsumiItem[]>([]);
  const [yearlyUsed, setYearlyUsed] = useState(0);
  const [loading, setLoading]       = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [brokerFilter, setBrokerFilter] = useState('すべて');
  const [accType, setAccType]       = useState<'amount' | 'units'>('amount');
  const [form, setForm] = useState({
    fund_code: '', fund_name: '', broker: 'SBI',
    monthly_amount: '', monthly_units: '', purchase_price: '', start_date: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch(`/api/nisa/tsumitate?userId=${userId}`);
    const data = await res.json();
    setItems(data.items ?? []);
    setYearlyUsed(data.yearly_used ?? 0);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fund_code) { setError('ファンドを検索・選択してください'); return; }
    setError(''); setSubmitting(true);
    const res = await fetch('/api/nisa/tsumitate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId, fund_code: form.fund_code, fund_name: form.fund_name,
        broker: form.broker, accumulation_type: accType,
        monthly_amount: accType === 'amount' ? Number(form.monthly_amount) : 0,
        monthly_units:  accType === 'units'  ? Number(form.monthly_units)  : 0,
        purchase_price: Number(form.purchase_price),
        start_date: form.start_date,
      }),
    });
    setSubmitting(false);
    if (!res.ok) { const d = await res.json(); setError(d.error ?? 'エラー'); return; }
    setForm({ fund_code: '', fund_name: '', broker: 'SBI', monthly_amount: '', monthly_units: '', purchase_price: '', start_date: '' });
    load();
  }

  async function handleDelete(id: number) {
    await fetch('/api/nisa/tsumitate', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    load();
  }

  const totalJpy = items.length === 0 ? null
    : items.every((i) => i.current_value_jpy == null) ? null
    : items.reduce((s, i) => s + (i.current_value_jpy ?? 0), 0);
  const costJpy = items.reduce((s, i) => s + i.cost_jpy, 0);

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <SegmentHeader title="つみたて投資枠" badge="セグメント② NISA" totalJpy={totalJpy} costJpy={costJpy} icon="💴" />
      <ProgressBar used={yearlyUsed} limit={1200000} label="つみたて (上限120万円)" />

      {/* 追加フォーム */}
      <form onSubmit={handleAdd} className="mt-4 space-y-2">
        {/* 証券会社フィルター兼選択 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500">証券会社:</span>
          {(['すべて', 'SBI', '楽天'] as const).map((b) => (
            <button key={b} type="button"
              onClick={() => { setBrokerFilter(b); if (b !== 'すべて') setForm((f) => ({ ...f, broker: b })); }}
              className={`px-3 py-1 rounded text-xs font-semibold transition-colors border ${
                brokerFilter === b
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
              }`}>
              {b}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* ファンド検索（col-span-2） */}
          <FundSearch
            onSelect={(code, name) => setForm((f) => ({ ...f, fund_code: code, fund_name: name }))} />

          {/* 積立方法 */}
          <div className="flex items-center gap-3 sm:col-span-2">
            <span className="text-xs text-gray-500 shrink-0">積立方法:</span>
            {(['amount', 'units'] as const).map((t) => (
              <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="accType" value={t} checked={accType === t}
                  onChange={() => setAccType(t)} className="accent-blue-500" />
                <span className="text-xs text-gray-300">{t === 'amount' ? '金額指定' : '口数指定'}</span>
              </label>
            ))}
          </div>

          {accType === 'amount' ? (
            <input type="number" placeholder="毎月の積立金額 (¥)" value={form.monthly_amount}
              onChange={(e) => setForm({ ...form, monthly_amount: e.target.value })}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
              min="1" required />
          ) : (
            <input type="number" placeholder="毎月の積立口数" value={form.monthly_units}
              onChange={(e) => setForm({ ...form, monthly_units: e.target.value })}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
              min="1" step="1" required />
          )}

          <input type="number" placeholder="購入時の基準価額 (¥/10,000口)" value={form.purchase_price}
            onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
            min="1" step="any" required />

          <input type="date" value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
            required />
        </div>

        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button type="submit" disabled={submitting}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors">
          {submitting ? '追加中...' : '+ 追加'}
        </button>
      </form>

      {loading ? (
        <div className="flex justify-center h-16 items-center mt-4"><Spinner /></div>
      ) : items.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-6 mt-4">ファンドが登録されていません</p>
      ) : (
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase">
                <th className="pb-2 text-left">ファンド</th>
                <th className="pb-2 text-right">積立方法</th>
                <th className="pb-2 text-right">積立月数</th>
                <th className="pb-2 text-right">基準価額</th>
                <th className="pb-2 text-right">評価額</th>
                <th className="pb-2 text-right">投資総額</th>
                <th className="pb-2 text-right">損益</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {items.map((it) => (
                <tr key={it.id} className="hover:bg-gray-800/40 transition-colors">
                  <td className="py-2.5 pr-2">
                    <p className="font-semibold text-blue-300 leading-snug max-w-52 truncate">{it.fund_name}</p>
                    <p className="text-xs text-gray-500">{it.fund_code} · {it.broker}</p>
                  </td>
                  <td className="py-2.5 text-right text-gray-400 text-xs">
                    {it.accumulation_type === 'amount'
                      ? `¥${it.monthly_amount.toLocaleString()}/月`
                      : `${it.monthly_units.toLocaleString()}口/月`}
                  </td>
                  <td className="py-2.5 text-right text-gray-300">{it.months}ヶ月</td>
                  <td className="py-2.5 text-right text-gray-300">
                    {it.nav != null ? `¥${it.nav.toLocaleString()}` : <span className="text-gray-600">取得中</span>}
                  </td>
                  <td className="py-2.5 text-right font-semibold">
                    {it.current_value_jpy != null ? jpy(it.current_value_jpy) : '-'}
                  </td>
                  <td className="py-2.5 text-right text-gray-400">{jpy(it.cost_jpy)}</td>
                  <td className="py-2.5 text-right">
                    {it.pnl_jpy != null ? (
                      <div>
                        <p className={`font-semibold text-xs ${pnlColor(it.pnl_jpy)}`}>
                          {pnlSign(it.pnl_jpy)}{jpy(it.pnl_jpy)}
                        </p>
                        <p className={`text-xs ${pnlColor(it.pnl_pct)}`}>
                          {it.pnl_pct != null ? `${pnlSign(it.pnl_pct)}${it.pnl_pct.toFixed(2)}%` : ''}
                        </p>
                      </div>
                    ) : '-'}
                  </td>
                  <td className="py-2.5 text-right pl-2">
                    <button onClick={() => handleDelete(it.id)}
                      className="text-red-400 hover:text-red-300 text-xs transition-colors">削除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Segment 3: 成長投資枠 ─────────────────────────────────────── */
function GrowthSegment({ userId, usdJpy }: { userId: number; usdJpy: number | null }) {
  const rate = usdJpy ?? 150;
  const [items, setItems]           = useState<GrowthItem[]>([]);
  const [yearlyUsed, setYearlyUsed] = useState(0);
  const [loading, setLoading]       = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [assetType, setAssetType]   = useState<'fund' | 'stock'>('fund');
  const [form, setForm] = useState({
    code: '', fund_name: '', market: 'JP' as 'JP' | 'US',
    units_or_shares: '', purchase_price: '', purchase_date: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch(`/api/nisa/growth?userId=${userId}&usdJpy=${rate}`);
    const data = await res.json();
    setItems(data.items ?? []);
    setYearlyUsed(data.yearly_used ?? 0);
    setLoading(false);
  }, [userId, rate]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code) { setError('銘柄を選択してください'); return; }
    setError(''); setSubmitting(true);
    const res = await fetch('/api/nisa/growth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId, type: assetType, market: form.market, code: form.code, fund_name: form.fund_name,
        units_or_shares: Number(form.units_or_shares), purchase_price: Number(form.purchase_price), purchase_date: form.purchase_date,
      }),
    });
    setSubmitting(false);
    if (!res.ok) { const d = await res.json(); setError(d.error ?? 'エラー'); return; }
    setForm({ code: '', fund_name: '', market: 'JP', units_or_shares: '', purchase_price: '', purchase_date: '' });
    load();
  }

  async function handleDelete(id: number) {
    await fetch('/api/nisa/growth', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    load();
  }

  const totalJpy = items.length === 0 ? 0 : items.reduce((s, i) => s + (i.current_value_jpy ?? 0), 0);
  const costJpy  = items.reduce((s, i) => s + i.cost_jpy, 0);
  const displayTotal = items.some((i) => i.current_value_jpy == null) && items.every((i) => i.current_value_jpy == null) ? null : totalJpy;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <SegmentHeader title="成長投資枠" badge="セグメント③ NISA" totalJpy={displayTotal} costJpy={costJpy} icon="🌱" />
      <ProgressBar used={yearlyUsed} limit={2400000} label="成長投資枠 (上限240万円)" />

      {/* 追加フォーム */}
      <form onSubmit={handleAdd} className="mt-4 space-y-2">
        {/* 種別切替 */}
        <div className="flex gap-1 mb-2">
          {(['fund', 'stock'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setAssetType(t)}
              className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${assetType === t ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
              {t === 'fund' ? '投資信託' : '個別株・ETF'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {assetType === 'fund' ? (
            <FundSearch
              onSelect={(code, name) => setForm((f) => ({ ...f, code, fund_name: name }))} />
          ) : (
            <>
              <select value={form.market} onChange={(e) => setForm({ ...form, market: e.target.value as 'JP' | 'US' })}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500">
                <option value="JP">🇯🇵 日本株・ETF</option>
                <option value="US">🇺🇸 米国株・ETF</option>
              </select>
              <input type="text" placeholder={form.market === 'JP' ? 'コード (例: 1306)' : 'コード (例: VTI)'}
                value={form.code}
                onChange={(e) => { const c = e.target.value.toUpperCase(); setForm({ ...form, code: c, fund_name: c }); }}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500" required />
            </>
          )}

          <input type="number"
            placeholder={assetType === 'fund' ? '口数' : '株数'}
            value={form.units_or_shares}
            onChange={(e) => setForm({ ...form, units_or_shares: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500" min="0.001" step="any" required />
          <input type="number"
            placeholder={assetType === 'fund' ? '購入時基準価額 (¥/10,000口)' : `購入価格 (${form.market === 'JP' ? '¥' : '$'})`}
            value={form.purchase_price}
            onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500" min="0.01" step="any" required />
          <input type="date" value={form.purchase_date}
            onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500" required />
        </div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button type="submit" disabled={submitting}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors">
          {submitting ? '追加中...' : '+ 追加'}
        </button>
      </form>

      {loading ? (
        <div className="flex justify-center h-16 items-center mt-4"><Spinner /></div>
      ) : items.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-6 mt-4">登録がありません</p>
      ) : (
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase">
                <th className="pb-2 text-left">銘柄</th>
                <th className="pb-2 text-right">数量</th>
                <th className="pb-2 text-right">取得価格</th>
                <th className="pb-2 text-right">現在価格</th>
                <th className="pb-2 text-right">評価額(円)</th>
                <th className="pb-2 text-right">損益(円)</th>
                <th className="pb-2 text-right">損益率</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {items.map((it) => {
                const cur = it.market === 'US' ? '$' : '¥';
                const priceLabel = it.type === 'fund' ? `¥${it.purchase_price.toLocaleString()}/万口` : `${cur}${it.purchase_price.toLocaleString()}`;
                const curPriceLabel = it.current_price != null
                  ? (it.type === 'fund' ? `¥${it.current_price.toLocaleString()}/万口` : `${cur}${it.current_price.toFixed(it.market === 'JP' ? 0 : 2)}`)
                  : '-';
                return (
                  <tr key={it.id} className="hover:bg-gray-800/40 transition-colors">
                    <td className="py-2.5 pr-2">
                      <p className="font-semibold text-blue-300 truncate max-w-48">{it.fund_name}</p>
                      <p className="text-xs text-gray-500">{it.code} · {it.type === 'fund' ? '投信' : it.market === 'JP' ? '🇯🇵' : '🇺🇸'} · {it.purchase_date}</p>
                    </td>
                    <td className="py-2.5 text-right text-gray-300">{it.units_or_shares.toLocaleString()}</td>
                    <td className="py-2.5 text-right text-gray-300 text-xs">{priceLabel}</td>
                    <td className="py-2.5 text-right text-gray-300 text-xs">{curPriceLabel}</td>
                    <td className="py-2.5 text-right font-semibold">
                      {it.current_value_jpy != null ? jpy(it.current_value_jpy) : '-'}
                    </td>
                    <td className={`py-2.5 text-right font-semibold text-sm ${pnlColor(it.pnl_jpy)}`}>
                      {it.pnl_jpy != null ? `${pnlSign(it.pnl_jpy)}${jpy(it.pnl_jpy)}` : '-'}
                    </td>
                    <td className="py-2.5 text-right">
                      <PnlBadge pct={it.pnl_pct} />
                    </td>
                    <td className="py-2.5 text-right pl-2">
                      <button onClick={() => handleDelete(it.id)} className="text-red-400 hover:text-red-300 text-xs transition-colors">削除</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────── */
export default function PortfolioPage() {
  const [users, setUsers]             = useState<User[]>([]);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [usdJpy, setUsdJpy]           = useState<number | null>(null);
  const [fxLoading, setFxLoading]     = useState(true);

  // 集計用（各セグメントから持ち上げるのは複雑なので、サマリーは概算で為替レートのみ依存）
  useEffect(() => {
    fetch('/api/users').then((r) => r.json()).then((data: User[]) => {
      setUsers(data);
      if (data.length > 0) setActiveUserId(data[0].id);
    });
    fetch('/api/forex').then((r) => r.json()).then((d) => {
      setUsdJpy(d.rate ?? null);
      setFxLoading(false);
    }).catch(() => setFxLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Nav */}
      <nav className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-blue-400">株ポートフォリオ</h1>
          <div className="flex gap-6 items-center">
            <Link href="/" className="text-blue-400 font-semibold border-b-2 border-blue-400 pb-1">ポートフォリオ</Link>
            <Link href="/chart" className="text-gray-400 hover:text-gray-200 transition-colors">チャート</Link>
            <Link href="/report" className="text-gray-400 hover:text-gray-200 transition-colors">AIレポート</Link>
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

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* 為替レート */}
        <div className="flex items-center gap-2 mb-5 text-sm">
          {fxLoading ? (
            <span className="text-gray-500 flex items-center gap-1"><Spinner sm /> 為替取得中...</span>
          ) : usdJpy != null ? (
            <span className="bg-gray-800 border border-gray-700 rounded-full px-3 py-1 text-gray-300">
              💱 1 USD = <span className="font-bold text-white">¥{usdJpy.toFixed(2)}</span>
              <span className="text-gray-500 ml-1">（リアルタイム）</span>
            </span>
          ) : (
            <span className="text-amber-400 text-xs">⚠ 為替レートを取得できませんでした（1 USD = ¥150 で試算）</span>
          )}
        </div>

        {activeUserId !== null && (
          <div className="space-y-6">
            <StocksSegment    key={`stocks-${activeUserId}`}    userId={activeUserId} usdJpy={usdJpy} />
            <TsumitateSgment  key={`tsumi-${activeUserId}`}     userId={activeUserId} />
            <GrowthSegment    key={`growth-${activeUserId}`}    userId={activeUserId} usdJpy={usdJpy} />
          </div>
        )}
      </main>
    </div>
  );
}