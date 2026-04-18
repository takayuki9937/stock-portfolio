'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { NavBar } from '../_navbar';

/* ─── Types ──────────────────────────────────────────────────────── */
interface User    { id: number; name: string }
interface Holding { id: number; user_id: number; ticker: string; market: 'US' | 'JP' }
interface FundItem { fund_code: string; fund_name: string }
interface HistoryPoint {
  date: string; open: number; high: number; low: number; close: number; volume?: number;
}
interface FundHistoryPoint { date: string; nav: number }
type Period    = 'day' | 'week' | 'month' | 'year';
type FundRange = '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y';
type ChartType = 'line' | 'candle';
type Interval  = '1m' | '5m' | '15m' | '60m' | '1d' | '1wk' | '1mo';
type SelectedItem =
  | { kind: 'stock'; ticker: string; market: 'US' | 'JP' }
  | { kind: 'fund'; fundCode: string; fundName: string };

/* ─── Constants ──────────────────────────────────────────────────── */
const INTERVAL_MAX_DAYS: Record<Interval, number> = {
  '1m': 7, '5m': 60, '15m': 60, '60m': 730,
  '1d': Infinity, '1wk': Infinity, '1mo': Infinity,
};
const PERIOD_DAYS: Record<Period, number> = { day: 1, week: 7, month: 30, year: 365 };
const INTERVAL_LABELS: { value: Interval; label: string }[] = [
  { value: '1m',  label: '1分'  },
  { value: '5m',  label: '5分'  },
  { value: '15m', label: '15分' },
  { value: '60m', label: '60分' },
  { value: '1d',  label: '日足' },
  { value: '1wk', label: '週足' },
  { value: '1mo', label: '月足' },
];

/* ─── SVG Layout ─────────────────────────────────────────────────── */
const SVG_W = 900;
const PAD_L = 72, PAD_R = 16;
const CW = SVG_W - PAD_L - PAD_R;

/* ─── Indicator Calculations ─────────────────────────────────────── */
function calcSMA(arr: number[], n: number): (number | null)[] {
  return arr.map((_, i) =>
    i < n - 1 ? null : arr.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n
  );
}

function calcEMA(arr: number[], n: number): (number | null)[] {
  if (arr.length < n) return arr.map(() => null);
  const k = 2 / (n + 1);
  const out: (number | null)[] = arr.map(() => null);
  let e = arr.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = e;
  for (let i = n; i < arr.length; i++) { e = arr[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

type BBPoint = { u: number | null; m: number | null; l: number | null };
function calcBB(arr: number[], n = 20): BBPoint[] {
  return calcSMA(arr, n).map((mid, i) => {
    if (mid === null) return { u: null, m: null, l: null };
    const std = Math.sqrt(arr.slice(i - n + 1, i + 1).reduce((s, v) => s + (v - mid) ** 2, 0) / n);
    return { u: mid + 2 * std, m: mid, l: mid - 2 * std };
  });
}

function calcRSI(arr: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = arr.map(() => null);
  if (arr.length <= n) return out;
  let ag = 0, al = 0;
  for (let i = 1; i <= n; i++) {
    const c = arr[i] - arr[i - 1];
    if (c > 0) ag += c; else al -= c;
  }
  ag /= n; al /= n;
  out[n] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = n + 1; i < arr.length; i++) {
    const c = arr[i] - arr[i - 1];
    ag = (ag * (n - 1) + (c > 0 ? c : 0)) / n;
    al = (al * (n - 1) + (c < 0 ? -c : 0)) / n;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

type MACDPoint = { m: number | null; s: number | null; h: number | null };
function calcMACD(arr: number[], sp = 12, lp = 26, sigP = 9): MACDPoint[] {
  const se = calcEMA(arr, sp), le = calcEMA(arr, lp);
  const ml: (number | null)[] = arr.map((_, i) =>
    se[i] !== null && le[i] !== null ? se[i]! - le[i]! : null
  );
  const sl: (number | null)[] = arr.map(() => null);
  const valid: { i: number; v: number }[] = [];
  ml.forEach((v, i) => { if (v !== null) valid.push({ i, v }); });
  if (valid.length >= sigP) {
    const k = 2 / (sigP + 1);
    let e = valid.slice(0, sigP).reduce((a, b) => a + b.v, 0) / sigP;
    sl[valid[sigP - 1].i] = e;
    for (let i = sigP; i < valid.length; i++) {
      e = valid[i].v * k + e * (1 - k);
      sl[valid[i].i] = e;
    }
  }
  return ml.map((m, i) => ({ m, s: sl[i], h: m !== null && sl[i] !== null ? m - sl[i]! : null }));
}

/* ─── SVG Helpers ────────────────────────────────────────────────── */
function buildPath(vals: (number | null)[], tx: (i: number) => number, ty: (v: number) => number): string {
  let d = '', seg = false;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] === null) { seg = false; continue; }
    d += seg ? ` L${tx(i)} ${ty(vals[i]!)}` : `M${tx(i)} ${ty(vals[i]!)}`;
    seg = true;
  }
  return d;
}

function xTickIndexes(n: number): number[] {
  return n <= 6
    ? Array.from({ length: n }, (_, i) => i)
    : [0, 1, 2, 3, 4, 5].map((i) => Math.round(i * (n - 1) / 5));
}

/* ─── PriceChart ─────────────────────────────────────────────────── */
interface PriceChartProps {
  data: HistoryPoint[];
  chartType: ChartType;
  formatDate: (iso: string) => string;
  currency: string;
  ma25: (number | null)[] | null;
  ma75: (number | null)[] | null;
  ma200: (number | null)[] | null;
  bbBands: BBPoint[] | null;
  hoverIdx: number | null;
  setHoverIdx: (i: number | null) => void;
}

function PriceChart({
  data, chartType, formatDate, currency,
  ma25, ma75, ma200, bbBands, hoverIdx, setHoverIdx,
}: PriceChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const H = 380, PT = 16, PB = 32, CH = H - PT - PB;

  const lows  = data.map((d) => d.low);
  const highs = data.map((d) => d.high);
  const bbLo  = bbBands ? bbBands.map((b) => b.l).filter((v): v is number => v !== null) : [];
  const bbHi  = bbBands ? bbBands.map((b) => b.u).filter((v): v is number => v !== null) : [];
  const minP  = Math.min(...lows,  ...bbLo) * 0.998;
  const maxP  = Math.max(...highs, ...bbHi) * 1.002;

  const xs  = CW / data.length;
  const tx  = (i: number) => PAD_L + i * xs + xs / 2;
  const ty  = (v: number) => PT + CH - ((v - minP) / (maxP - minP)) * CH;
  const bw  = Math.max(2, Math.min(14, xs * 0.65));
  const yt  = Array.from({ length: 5 }, (_, i) => minP + (maxP - minP) * (i / 4));
  const xtI = xTickIndexes(data.length);

  let bbFill = '';
  if (bbBands) {
    const v = bbBands.map((b, i) => ({ ...b, i })).filter((b) => b.u !== null);
    if (v.length > 1) {
      bbFill = `M${v.map((b) => `${tx(b.i)},${ty(b.u!)}`).join('L')}` +
               `L${[...v].reverse().map((b) => `${tx(b.i)},${ty(b.l!)}`).join('L')}Z`;
    }
  }

  const hd = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div className="relative w-full" style={{ aspectRatio: `${SVG_W}/${H}` }}>
      <svg ref={svgRef} viewBox={`0 0 ${SVG_W} ${H}`} className="w-full h-full cursor-crosshair"
        onMouseMove={(e) => {
          const r = svgRef.current?.getBoundingClientRect();
          if (!r) return;
          const idx = Math.floor(((e.clientX - r.left) / r.width * SVG_W - PAD_L) / xs);
          setHoverIdx(idx >= 0 && idx < data.length ? idx : null);
        }}
        onMouseLeave={() => setHoverIdx(null)}>

        {/* grid */}
        {yt.map((v, i) => (
          <line key={i} x1={PAD_L} y1={ty(v)} x2={PAD_L + CW} y2={ty(v)} stroke="#374151" strokeDasharray="3 3" />
        ))}

        {/* BB fill */}
        {bbFill && <path d={bbFill} fill="#3B82F6" fillOpacity={0.07} />}

        {/* BB lines */}
        {bbBands && <>
          <path d={buildPath(bbBands.map(b => b.u), tx, ty)} fill="none" stroke="#60A5FA" strokeWidth={1} strokeDasharray="4 2" opacity={0.7} />
          <path d={buildPath(bbBands.map(b => b.m), tx, ty)} fill="none" stroke="#60A5FA" strokeWidth={1} opacity={0.45} />
          <path d={buildPath(bbBands.map(b => b.l), tx, ty)} fill="none" stroke="#60A5FA" strokeWidth={1} strokeDasharray="4 2" opacity={0.7} />
        </>}

        {/* MA lines */}
        {ma25  && <path d={buildPath(ma25,  tx, ty)} fill="none" stroke="#F59E0B" strokeWidth={1.5} />}
        {ma75  && <path d={buildPath(ma75,  tx, ty)} fill="none" stroke="#10B981" strokeWidth={1.5} />}
        {ma200 && <path d={buildPath(ma200, tx, ty)} fill="none" stroke="#EF4444" strokeWidth={1.5} />}

        {/* price */}
        {chartType === 'line'
          ? <path d={buildPath(data.map(d => d.close), tx, ty)} fill="none" stroke="#3B82F6" strokeWidth={2} />
          : data.map((d, i) => {
              const cx = tx(i), up = d.close >= d.open, c = up ? '#22c55e' : '#ef4444';
              const yH = ty(d.high), yL = ty(d.low);
              const yT = ty(Math.max(d.open, d.close)), yB = ty(Math.min(d.open, d.close));
              return (
                <g key={i}>
                  <line x1={cx} y1={yH} x2={cx} y2={yL} stroke={c} strokeWidth={1.5} />
                  <rect x={cx - bw / 2} y={yT} width={bw} height={Math.max(yB - yT, 1)}
                    fill={c} fillOpacity={0.85} stroke={c} strokeWidth={1} />
                </g>
              );
            })
        }

        {/* crosshair */}
        {hoverIdx !== null && (
          <line x1={tx(hoverIdx)} y1={PT} x2={tx(hoverIdx)} y2={PT + CH}
            stroke="#9CA3AF" strokeWidth={1} strokeDasharray="4 2" />
        )}

        {/* Y labels */}
        {yt.map((v, i) => (
          <text key={i} x={PAD_L - 4} y={ty(v) + 4} textAnchor="end" fill="#9CA3AF" fontSize={11}>
            {currency}{v >= 1000 ? v.toFixed(0) : v.toFixed(2)}
          </text>
        ))}

        {/* X labels */}
        {xtI.map((idx) => (
          <text key={idx} x={tx(idx)} y={H - PB + 16} textAnchor="middle" fill="#9CA3AF" fontSize={11}>
            {formatDate(data[idx].date)}
          </text>
        ))}

        {/* frame */}
        <rect x={PAD_L} y={PT} width={CW} height={CH} fill="none" stroke="#4B5563" />
      </svg>

      {/* tooltip */}
      {hd && hoverIdx !== null && (
        <div className="absolute top-1 left-0 pointer-events-none bg-gray-800/95 border border-gray-600 rounded-lg px-3 py-2 text-xs shadow-xl space-y-0.5 z-10">
          <p className="text-gray-400 font-semibold border-b border-gray-700 pb-1 mb-1">{formatDate(hd.date)}</p>
          {chartType === 'candle' ? (
            <>
              <p className="text-gray-300">始値 <span className="text-white font-semibold ml-1">{currency}{hd.open.toFixed(2)}</span></p>
              <p className="text-gray-300">高値 <span className="text-green-400 font-semibold ml-1">{currency}{hd.high.toFixed(2)}</span></p>
              <p className="text-gray-300">安値 <span className="text-red-400 font-semibold ml-1">{currency}{hd.low.toFixed(2)}</span></p>
              <p className="text-gray-300">終値 <span className="text-white font-bold ml-1">{currency}{hd.close.toFixed(2)}</span></p>
            </>
          ) : (
            <p className="text-gray-300">終値 <span className="text-blue-400 font-bold ml-1">{currency}{hd.close.toFixed(2)}</span></p>
          )}
          {ma25  && ma25[hoverIdx]  != null && <p><span className="text-amber-400 font-semibold">MA25  </span><span className="text-white">{currency}{ma25[hoverIdx]!.toFixed(2)}</span></p>}
          {ma75  && ma75[hoverIdx]  != null && <p><span className="text-emerald-400 font-semibold">MA75  </span><span className="text-white">{currency}{ma75[hoverIdx]!.toFixed(2)}</span></p>}
          {ma200 && ma200[hoverIdx] != null && <p><span className="text-red-400 font-semibold">MA200 </span><span className="text-white">{currency}{ma200[hoverIdx]!.toFixed(2)}</span></p>}
          {bbBands && bbBands[hoverIdx]?.u != null && (
            <p><span className="text-blue-300 font-semibold">BB  </span><span className="text-white">{currency}{bbBands[hoverIdx].l!.toFixed(2)} – {currency}{bbBands[hoverIdx].u!.toFixed(2)}</span></p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── VolumeChart ────────────────────────────────────────────────── */
function VolumeChart({ data, hoverIdx, setHoverIdx }: {
  data: HistoryPoint[];
  hoverIdx: number | null;
  setHoverIdx: (i: number | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const H = 90, PT = 8, PB = 4, CH = H - PT - PB;
  const vols = data.map((d) => d.volume ?? 0);
  const maxV = Math.max(...vols, 1);
  const xs   = CW / data.length;
  const tx   = (i: number) => PAD_L + i * xs + xs / 2;
  const bw   = Math.max(1, xs * 0.7);

  const fmt = (v: number) =>
    v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v);

  return (
    <div className="relative w-full" style={{ aspectRatio: `${SVG_W}/${H}` }}>
      <svg ref={svgRef} viewBox={`0 0 ${SVG_W} ${H}`} className="w-full h-full cursor-crosshair"
        onMouseMove={(e) => {
          const r = svgRef.current?.getBoundingClientRect();
          if (!r) return;
          const idx = Math.floor(((e.clientX - r.left) / r.width * SVG_W - PAD_L) / xs);
          setHoverIdx(idx >= 0 && idx < data.length ? idx : null);
        }}
        onMouseLeave={() => setHoverIdx(null)}>

        <text x={PAD_L - 4} y={PT + 10} textAnchor="end" fill="#6B7280" fontSize={10}>出来高</text>
        <text x={PAD_L - 4} y={PT + 2}  textAnchor="end" fill="#4B5563" fontSize={9}>{fmt(maxV)}</text>

        {data.map((d, i) => {
          const v = d.volume ?? 0;
          const bh = Math.max(1, (v / maxV) * CH);
          return (
            <rect key={i}
              x={tx(i) - bw / 2} y={PT + CH - bh} width={bw} height={bh}
              fill={d.close >= d.open ? '#3B82F6' : '#EF4444'} fillOpacity={0.6} />
          );
        })}

        {hoverIdx !== null && (
          <line x1={tx(hoverIdx)} y1={PT} x2={tx(hoverIdx)} y2={PT + CH}
            stroke="#9CA3AF" strokeWidth={1} strokeDasharray="4 2" />
        )}
        <rect x={PAD_L} y={PT} width={CW} height={CH} fill="none" stroke="#4B5563" />
      </svg>

      {hoverIdx !== null && vols[hoverIdx] > 0 && (
        <div className="absolute top-1 left-0 pointer-events-none bg-gray-800/95 border border-gray-600 rounded px-2 py-0.5 text-xs">
          <span className="text-blue-400">出来高 </span>
          <span className="text-white">{vols[hoverIdx].toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

/* ─── RSIChart ───────────────────────────────────────────────────── */
function RSIChart({ data, rsiVals, hoverIdx, setHoverIdx }: {
  data: HistoryPoint[];
  rsiVals: (number | null)[];
  hoverIdx: number | null;
  setHoverIdx: (i: number | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const H = 110, PT = 8, PB = 4, CH = H - PT - PB;
  const xs = CW / data.length;
  const tx = (i: number) => PAD_L + i * xs + xs / 2;
  const ty = (v: number) => PT + CH - (v / 100) * CH;
  const cur = hoverIdx !== null ? rsiVals[hoverIdx] : null;

  return (
    <div className="relative w-full" style={{ aspectRatio: `${SVG_W}/${H}` }}>
      <svg ref={svgRef} viewBox={`0 0 ${SVG_W} ${H}`} className="w-full h-full cursor-crosshair"
        onMouseMove={(e) => {
          const r = svgRef.current?.getBoundingClientRect();
          if (!r) return;
          const idx = Math.floor(((e.clientX - r.left) / r.width * SVG_W - PAD_L) / xs);
          setHoverIdx(idx >= 0 && idx < data.length ? idx : null);
        }}
        onMouseLeave={() => setHoverIdx(null)}>

        {/* overbought/oversold fill */}
        <rect x={PAD_L} y={PT} width={CW} height={ty(70) - PT} fill="#EF4444" fillOpacity={0.04} />
        <rect x={PAD_L} y={ty(30)} width={CW} height={PT + CH - ty(30)} fill="#22C55E" fillOpacity={0.04} />

        {/* reference lines */}
        <line x1={PAD_L} y1={ty(70)} x2={PAD_L + CW} y2={ty(70)} stroke="#EF4444" strokeDasharray="3 2" opacity={0.55} />
        <line x1={PAD_L} y1={ty(50)} x2={PAD_L + CW} y2={ty(50)} stroke="#374151" strokeDasharray="2 2" />
        <line x1={PAD_L} y1={ty(30)} x2={PAD_L + CW} y2={ty(30)} stroke="#22C55E" strokeDasharray="3 2" opacity={0.55} />

        <text x={PAD_L - 4} y={ty(70) + 4} textAnchor="end" fill="#EF4444" fontSize={9}>70</text>
        <text x={PAD_L - 4} y={ty(50) + 4} textAnchor="end" fill="#6B7280" fontSize={9}>50</text>
        <text x={PAD_L - 4} y={ty(30) + 4} textAnchor="end" fill="#22C55E" fontSize={9}>30</text>
        <text x={PAD_L - 4} y={PT + 10}     textAnchor="end" fill="#A78BFA" fontSize={10}>RSI</text>

        <path d={buildPath(rsiVals, tx, ty)} fill="none" stroke="#A78BFA" strokeWidth={1.5} />

        {hoverIdx !== null && (
          <line x1={tx(hoverIdx)} y1={PT} x2={tx(hoverIdx)} y2={PT + CH}
            stroke="#9CA3AF" strokeWidth={1} strokeDasharray="4 2" />
        )}
        <rect x={PAD_L} y={PT} width={CW} height={CH} fill="none" stroke="#4B5563" />
      </svg>

      {cur != null && (
        <div className="absolute top-1 left-0 pointer-events-none bg-gray-800/95 border border-gray-600 rounded px-2 py-0.5 text-xs">
          <span className="text-purple-400">RSI(14) </span>
          <span className={`font-bold ${cur >= 70 ? 'text-red-400' : cur <= 30 ? 'text-green-400' : 'text-white'}`}>
            {cur.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  );
}

/* ─── MACDChart ──────────────────────────────────────────────────── */
function MACDChart({ data, macdVals, hoverIdx, setHoverIdx }: {
  data: HistoryPoint[];
  macdVals: MACDPoint[];
  hoverIdx: number | null;
  setHoverIdx: (i: number | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const H = 130, PT = 8, PB = 4, CH = H - PT - PB;

  const allV = macdVals.flatMap((m) => [m.m, m.s, m.h]).filter((v): v is number => v !== null);
  const raw_lo = allV.length ? Math.min(...allV) : -1;
  const raw_hi = allV.length ? Math.max(...allV) : 1;
  const span = raw_hi - raw_lo || 1;
  const lo = raw_lo - span * 0.08;
  const hi = raw_hi + span * 0.08;

  const xs = CW / data.length;
  const tx = (i: number) => PAD_L + i * xs + xs / 2;
  const ty = (v: number) => PT + CH - ((v - lo) / (hi - lo)) * CH;
  const z  = ty(0);
  const bw = Math.max(1, xs * 0.6);
  const cm = hoverIdx !== null ? macdVals[hoverIdx] : null;

  return (
    <div className="relative w-full" style={{ aspectRatio: `${SVG_W}/${H}` }}>
      <svg ref={svgRef} viewBox={`0 0 ${SVG_W} ${H}`} className="w-full h-full cursor-crosshair"
        onMouseMove={(e) => {
          const r = svgRef.current?.getBoundingClientRect();
          if (!r) return;
          const idx = Math.floor(((e.clientX - r.left) / r.width * SVG_W - PAD_L) / xs);
          setHoverIdx(idx >= 0 && idx < data.length ? idx : null);
        }}
        onMouseLeave={() => setHoverIdx(null)}>

        {/* zero line */}
        <line x1={PAD_L} y1={z} x2={PAD_L + CW} y2={z} stroke="#4B5563" strokeWidth={1} />
        <text x={PAD_L - 4} y={PT + 10} textAnchor="end" fill="#6B7280" fontSize={10}>MACD</text>

        {/* histogram */}
        {macdVals.map((m, i) => {
          if (m.h === null) return null;
          const barH = Math.abs(ty(m.h) - z);
          return (
            <rect key={i}
              x={tx(i) - bw / 2} y={m.h >= 0 ? ty(m.h) : z}
              width={bw} height={Math.max(1, barH)}
              fill={m.h >= 0 ? '#22C55E' : '#EF4444'} fillOpacity={0.5} />
          );
        })}

        {/* MACD line (blue) */}
        <path d={buildPath(macdVals.map(m => m.m), tx, ty)} fill="none" stroke="#3B82F6" strokeWidth={1.5} />
        {/* Signal line (orange) */}
        <path d={buildPath(macdVals.map(m => m.s), tx, ty)} fill="none" stroke="#F97316" strokeWidth={1.5} />

        {hoverIdx !== null && (
          <line x1={tx(hoverIdx)} y1={PT} x2={tx(hoverIdx)} y2={PT + CH}
            stroke="#9CA3AF" strokeWidth={1} strokeDasharray="4 2" />
        )}
        <rect x={PAD_L} y={PT} width={CW} height={CH} fill="none" stroke="#4B5563" />
      </svg>

      {cm && (
        <div className="absolute top-1 left-0 pointer-events-none bg-gray-800/95 border border-gray-600 rounded px-2 py-0.5 text-xs flex gap-3">
          {cm.m != null && <span><span className="text-blue-400">MACD </span><span className="text-white">{cm.m.toFixed(3)}</span></span>}
          {cm.s != null && <span><span className="text-orange-400">Signal </span><span className="text-white">{cm.s.toFixed(3)}</span></span>}
          {cm.h != null && <span><span className="text-gray-400">Hist </span><span className={cm.h >= 0 ? 'text-green-400' : 'text-red-400'}>{cm.h.toFixed(3)}</span></span>}
        </div>
      )}
    </div>
  );
}

/* ─── Indicator Legend ───────────────────────────────────────────── */
function Legend({ items }: { items: { color: string; label: string; dash?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <svg width="24" height="10">
            <line x1="0" y1="5" x2="24" y2="5"
              stroke={item.color} strokeWidth={2}
              strokeDasharray={item.dash ? '4 2' : undefined} />
          </svg>
          <span className="text-xs text-gray-400">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── ToggleBtn helper ───────────────────────────────────────────── */
function ToggleBtn({ label, active, activeColor, onClick }: {
  label: string; active: boolean; activeColor: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1 rounded text-xs font-semibold transition-colors border ${
        active
          ? `bg-gray-700 border-gray-600 ${activeColor}`
          : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-400'
      }`}>
      {label}
    </button>
  );
}

/* ─── FundLineChart ──────────────────────────────────────────────── */
function FundLineChart({
  data, hoverIdx, setHoverIdx,
}: {
  data: FundHistoryPoint[];
  hoverIdx: number | null;
  setHoverIdx: (i: number | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const H = 380, PT = 16, PB = 32, CH = H - PT - PB;

  const vals = data.map((d) => d.nav);
  const minP = Math.min(...vals) * 0.998;
  const maxP = Math.max(...vals) * 1.002;
  const xs   = CW / data.length;
  const tx   = (i: number) => PAD_L + i * xs + xs / 2;
  const ty   = (v: number) => PT + CH - ((v - minP) / (maxP - minP)) * CH;
  const yt   = Array.from({ length: 5 }, (_, i) => minP + (maxP - minP) * (i / 4));
  const xtI  = xTickIndexes(data.length);
  const fmt  = (v: number) => v.toLocaleString('ja-JP');

  const linePath = vals.reduce((d, v, i) =>
    d + (i === 0 ? `M${tx(i)} ${ty(v)}` : ` L${tx(i)} ${ty(v)}`), '');

  const hd = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div className="relative w-full" style={{ aspectRatio: `${SVG_W}/${H}` }}>
      <svg ref={svgRef} viewBox={`0 0 ${SVG_W} ${H}`} className="w-full h-full cursor-crosshair"
        onMouseMove={(e) => {
          const r = svgRef.current?.getBoundingClientRect();
          if (!r) return;
          const idx = Math.floor(((e.clientX - r.left) / r.width * SVG_W - PAD_L) / xs);
          setHoverIdx(idx >= 0 && idx < data.length ? idx : null);
        }}
        onMouseLeave={() => setHoverIdx(null)}>

        {yt.map((v, i) => (
          <line key={i} x1={PAD_L} y1={ty(v)} x2={PAD_L + CW} y2={ty(v)} stroke="#374151" strokeDasharray="3 3" />
        ))}

        <path d={linePath} fill="none" stroke="#3B82F6" strokeWidth={2} />

        {hoverIdx !== null && (
          <line x1={tx(hoverIdx)} y1={PT} x2={tx(hoverIdx)} y2={PT + CH}
            stroke="#9CA3AF" strokeWidth={1} strokeDasharray="4 2" />
        )}

        {yt.map((v, i) => (
          <text key={i} x={PAD_L - 4} y={ty(v) + 4} textAnchor="end" fill="#9CA3AF" fontSize={11}>
            {fmt(Math.round(v))}
          </text>
        ))}

        {xtI.map((idx) => (
          <text key={idx} x={tx(idx)} y={H - PB + 16} textAnchor="middle" fill="#9CA3AF" fontSize={11}>
            {new Date(data[idx].date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
          </text>
        ))}

        <rect x={PAD_L} y={PT} width={CW} height={CH} fill="none" stroke="#4B5563" />
      </svg>

      {hd && hoverIdx !== null && (
        <div className="absolute top-1 left-0 pointer-events-none bg-gray-800/95 border border-gray-600 rounded-lg px-3 py-2 text-xs shadow-xl z-10">
          <p className="text-gray-400 font-semibold border-b border-gray-700 pb-1 mb-1">
            {new Date(hd.date).toLocaleDateString('ja-JP')}
          </p>
          <p className="text-gray-300">基準価額 <span className="text-blue-400 font-bold ml-1">¥{fmt(hd.nav)}</span></p>
        </div>
      )}
    </div>
  );
}

/* ─── ChartPage ──────────────────────────────────────────────────── */
export function ChartContent() {
  const [users, setUsers]                   = useState<User[]>([]);
  const [activeUserId, setActiveUserId]     = useState<number | null>(null);
  const [holdings, setHoldings]             = useState<Holding[]>([]);
  const [funds, setFunds]                   = useState<FundItem[]>([]);
  const [selected, setSelected]             = useState<SelectedItem | null>(null);
  const [period, setPeriod]                 = useState<Period>('month');
  const [fundRange, setFundRange]           = useState<FundRange>('1Y');
  const [interval, setInterval]             = useState<Interval>('1d');
  const [chartType, setChartType]           = useState<ChartType>('candle');
  const [history, setHistory]               = useState<HistoryPoint[]>([]);
  const [fundHistory, setFundHistory]       = useState<FundHistoryPoint[]>([]);
  const [currentPrice, setCurrentPrice]     = useState<number | null>(null);
  const [companyName, setCompanyName]       = useState('');
  const [loading, setLoading]               = useState(false);
  const [comboError, setComboError]         = useState('');
  const [hoverIdx, setHoverIdx]             = useState<number | null>(null);

  // indicator toggles
  const [showMA25,    setShowMA25]    = useState(true);
  const [showMA75,    setShowMA75]    = useState(false);
  const [showMA200,   setShowMA200]   = useState(false);
  const [showBB,      setShowBB]      = useState(false);
  const [showRSI,     setShowRSI]     = useState(false);
  const [showMACD,    setShowMACD]    = useState(false);
  const [showVolume,  setShowVolume]  = useState(true);

  const isFund = selected?.kind === 'fund';

  // indicator calculations (memoized) — stock only
  const closes   = useMemo(() => history.map((d) => d.close), [history]);
  const ma25Data  = useMemo(() => showMA25  && closes.length >= 25  ? calcSMA(closes, 25)  : null, [closes, showMA25]);
  const ma75Data  = useMemo(() => showMA75  && closes.length >= 75  ? calcSMA(closes, 75)  : null, [closes, showMA75]);
  const ma200Data = useMemo(() => showMA200 && closes.length >= 200 ? calcSMA(closes, 200) : null, [closes, showMA200]);
  const bbData    = useMemo(() => showBB    && closes.length >= 20  ? calcBB(closes)        : null, [closes, showBB]);
  const rsiData   = useMemo(() => showRSI   && closes.length >= 15  ? calcRSI(closes)       : null, [closes, showRSI]);
  const macdData  = useMemo(() => showMACD  && closes.length >= 26  ? calcMACD(closes)      : null, [closes, showMACD]);

  useEffect(() => {
    fetch('/api/users').then((r) => r.json()).then((data: User[]) => {
      setUsers(data);
      if (data.length > 0) setActiveUserId(data[0].id);
    });
  }, []);

  useEffect(() => {
    if (activeUserId === null) return;
    Promise.all([
      fetch(`/api/portfolio?userId=${activeUserId}`).then((r) => r.json()),
      fetch(`/api/nisa/tsumitate?userId=${activeUserId}`).then((r) => r.json()),
      fetch(`/api/nisa/growth?userId=${activeUserId}`).then((r) => r.json()),
    ]).then(([stocks, tsumitate, growth]) => {
      const holdingData: Holding[] = Array.isArray(stocks) ? stocks : [];
      const tsuFunds: FundItem[] = Array.isArray(tsumitate?.holdings)
        ? tsumitate.holdings.map((h: { fund_code: string; fund_name: string }) => ({ fund_code: h.fund_code, fund_name: h.fund_name }))
        : [];
      const growFunds: FundItem[] = Array.isArray(growth?.holdings)
        ? growth.holdings.map((h: { fund_code: string; fund_name: string }) => ({ fund_code: h.fund_code, fund_name: h.fund_name }))
        : [];
      // dedupe funds by fund_code
      const allFunds = [...tsuFunds, ...growFunds].filter(
        (f, i, arr) => arr.findIndex((x) => x.fund_code === f.fund_code) === i
      );
      setHoldings(holdingData);
      setFunds(allFunds);
      setHistory([]);
      setFundHistory([]);
      setCurrentPrice(null);
      setCompanyName('');
      setComboError('');
      if (holdingData.length > 0) {
        setSelected({ kind: 'stock', ticker: holdingData[0].ticker, market: holdingData[0].market });
      } else if (allFunds.length > 0) {
        setSelected({ kind: 'fund', fundCode: allFunds[0].fund_code, fundName: allFunds[0].fund_name });
      }
    });
  }, [activeUserId]);

  // fetch stock history
  useEffect(() => {
    if (!selected || selected.kind !== 'stock') return;
    const { ticker, market } = selected;
    if (PERIOD_DAYS[period] > INTERVAL_MAX_DAYS[interval]) {
      setComboError(
        `「${INTERVAL_LABELS.find((l) => l.value === interval)?.label}」は最大 ${INTERVAL_MAX_DAYS[interval]} 日分しか取得できません。`
      );
      setHistory([]);
      return;
    }
    setComboError('');
    setLoading(true);
    fetch(`/api/stock?ticker=${ticker}&market=${market}&period=${period}&interval=${interval}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error === 'invalid_combo') {
          setComboError(data.message);
          setHistory([]);
        } else {
          setHistory(data.history ?? []);
          setCurrentPrice(data.currentPrice ?? null);
          setCompanyName(data.companyName ?? '');
          setComboError('');
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [selected, period, interval]);

  // fetch fund history
  useEffect(() => {
    if (!selected || selected.kind !== 'fund') return;
    const { fundCode } = selected;
    setLoading(true);
    fetch(`/api/fund-history/${fundCode}?range=${fundRange}`)
      .then((r) => r.json())
      .then((data) => {
        setFundHistory(data.history ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [selected, fundRange]);

  const currency = (selected?.kind === 'stock' && selected.market === 'US') ? '$' : '¥';

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (['1m', '5m', '15m'].includes(interval))
      return d.toLocaleTimeString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (interval === '60m')
      return d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) + ' ' +
             d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    if (interval === '1wk' || interval === '1mo')
      return d.toLocaleDateString('ja-JP', { year: period === 'year' ? 'numeric' : undefined, month: 'numeric', day: 'numeric' });
    return d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
  };

  const handlePeriod = (p: Period) => {
    setPeriod(p);
    if (PERIOD_DAYS[p] > INTERVAL_MAX_DAYS[interval]) setInterval('1d');
  };

  // build legend items
  const legendItems: { color: string; label: string; dash?: boolean }[] = [
    ...(chartType === 'line' ? [{ color: '#3B82F6', label: '終値' }] : []),
    ...(showMA25  && ma25Data  ? [{ color: '#F59E0B', label: 'MA25'  }] : []),
    ...(showMA75  && ma75Data  ? [{ color: '#10B981', label: 'MA75'  }] : []),
    ...(showMA200 && ma200Data ? [{ color: '#EF4444', label: 'MA200' }] : []),
    ...(showBB    && bbData    ? [
      { color: '#60A5FA', label: 'BB上限', dash: true },
      { color: '#60A5FA', label: 'BB中心' },
      { color: '#60A5FA', label: 'BB下限', dash: true },
    ] : []),
  ];

  // dropdown value encoding: "stock:AAPL:US" or "fund:04311181"
  const selectValue = selected
    ? selected.kind === 'stock'
      ? `stock:${selected.ticker}:${selected.market}`
      : `fund:${selected.fundCode}`
    : '';

  const handleSelectChange = (val: string) => {
    if (val.startsWith('stock:')) {
      const [, ticker, market] = val.split(':');
      setSelected({ kind: 'stock', ticker, market: market as 'US' | 'JP' });
      setFundHistory([]);
    } else if (val.startsWith('fund:')) {
      const fundCode = val.slice(5);
      const f = funds.find((f) => f.fund_code === fundCode);
      setSelected({ kind: 'fund', fundCode, fundName: f?.fund_name ?? fundCode });
      setHistory([]);
      setCurrentPrice(null);
      setCompanyName('');
    }
    setComboError('');
    setHoverIdx(null);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <NavBar active="chart" />

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

      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">

          {/* ── Row 1: ticker / chart type ── */}
          <div className="flex items-start justify-between mb-4 flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <select value={selectValue}
                onChange={(e) => handleSelectChange(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500 max-w-[260px]">
                {holdings.length === 0 && funds.length === 0 && <option value="">銘柄なし</option>}
                {holdings.length > 0 && (
                  <optgroup label="株式">
                    {holdings.map((h) => (
                      <option key={h.id} value={`stock:${h.ticker}:${h.market}`}>
                        {h.market === 'JP' ? '🇯🇵 ' : '🇺🇸 '}{h.ticker}
                      </option>
                    ))}
                  </optgroup>
                )}
                {funds.length > 0 && (
                  <optgroup label="投資信託">
                    {funds.map((f) => (
                      <option key={f.fund_code} value={`fund:${f.fund_code}`}>
                        📈 {f.fund_name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <div>
                {companyName && <p className="text-sm text-gray-400">{companyName}</p>}
                {currentPrice != null && !isFund && (
                  <span className="text-2xl font-bold">
                    {currency}{currentPrice.toFixed(selected?.kind === 'stock' && selected.market === 'JP' ? 0 : 2)}
                  </span>
                )}
              </div>
            </div>

            <div className="flex bg-gray-800 rounded-lg p-0.5">
              {(['line', 'candle'] as ChartType[]).map((type) => (
                <button key={type} onClick={() => setChartType(type)}
                  className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                    chartType === type ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}>
                  {type === 'line' ? '折れ線' : 'ローソク'}
                </button>
              ))}
            </div>
          </div>

          {/* ── Row 2: period / interval ── */}
          {isFund ? (
            /* 投資信託: 期間ボタンのみ */
            <div className="flex items-center gap-1 mb-4">
              {(['1M', '3M', '6M', '1Y', '3Y', '5Y'] as FundRange[]).map((r) => (
                <button key={r} onClick={() => setFundRange(r)}
                  className={`px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-semibold transition-colors ${
                    fundRange === r ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}>
                  {r}
                </button>
              ))}
            </div>
          ) : (
            /* 株式: 従来の期間・足種類 */
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <div className="flex gap-1">
                {(['day', 'week', 'month', 'year'] as Period[]).map((p) => {
                  const tooLong = PERIOD_DAYS[p] > INTERVAL_MAX_DAYS[interval] && chartType === 'candle';
                  return (
                    <button key={p} onClick={() => handlePeriod(p)}
                      className={`px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-semibold transition-colors ${
                        period === p ? 'bg-gray-600 text-white'
                          : tooLong ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}>
                      {p === 'day' ? '日' : p === 'week' ? '週' : p === 'month' ? '月' : '年'}
                    </button>
                  );
                })}
              </div>

              {chartType === 'candle' && (
                <>
                  <div className="w-px h-5 bg-gray-700" />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">足の種類:</span>
                    <div className="flex gap-1 flex-wrap">
                      {INTERVAL_LABELS.map(({ value, label }) => {
                        const disabled = PERIOD_DAYS[period] > INTERVAL_MAX_DAYS[value];
                        return (
                          <button key={value}
                            onClick={() => !disabled && setInterval(value)}
                            disabled={disabled}
                            title={disabled ? `最大${INTERVAL_MAX_DAYS[value]}日分のみ対応` : label}
                            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                              interval === value ? 'bg-blue-600 text-white'
                                : disabled ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Row 3: indicator toggles (株式のみ) ── */}
          {!isFund && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4 pb-4 border-b border-gray-800 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500 mr-1">移動平均線:</span>
                <ToggleBtn label="MA25"  active={showMA25}  activeColor="text-amber-400"   onClick={() => setShowMA25(!showMA25)} />
                <ToggleBtn label="MA75"  active={showMA75}  activeColor="text-emerald-400" onClick={() => setShowMA75(!showMA75)} />
                <ToggleBtn label="MA200" active={showMA200} activeColor="text-red-400"     onClick={() => setShowMA200(!showMA200)} />
              </div>
              <div className="w-px h-5 bg-gray-700 hidden sm:block" />
              <ToggleBtn label="BB (ボリンジャーバンド)" active={showBB}     activeColor="text-blue-300"   onClick={() => setShowBB(!showBB)} />
              <div className="w-px h-5 bg-gray-700 hidden sm:block" />
              <ToggleBtn label="RSI"     active={showRSI}    activeColor="text-purple-400" onClick={() => setShowRSI(!showRSI)} />
              <ToggleBtn label="MACD"    active={showMACD}   activeColor="text-blue-400"   onClick={() => setShowMACD(!showMACD)} />
              <ToggleBtn label="出来高"   active={showVolume} activeColor="text-blue-400"   onClick={() => setShowVolume(!showVolume)} />
            </div>
          )}

          {/* ── legend ── */}
          {!isFund && legendItems.length > 0 && (
            <div className="mb-3">
              <Legend items={legendItems} />
            </div>
          )}

          {/* ── chart area ── */}
          {loading ? (
            <div className="h-80 flex items-center justify-center text-gray-500">読み込み中...</div>
          ) : comboError ? (
            <div className="h-80 flex flex-col items-center justify-center gap-2">
              <p className="text-yellow-400 text-sm font-semibold">⚠ この期間は取得できません</p>
              <p className="text-gray-400 text-xs">{comboError}</p>
            </div>
          ) : isFund ? (
            /* 投資信託チャート */
            fundHistory.length === 0 ? (
              <div className="h-80 flex items-center justify-center text-gray-500">データがありません</div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-gray-500">基準価額 (円/万口)</span>
                  <span className="text-lg font-bold text-blue-400">
                    ¥{fundHistory[fundHistory.length - 1]?.nav.toLocaleString('ja-JP')}
                  </span>
                </div>
                <FundLineChart data={fundHistory} hoverIdx={hoverIdx} setHoverIdx={setHoverIdx} />
              </div>
            )
          ) : history.length === 0 ? (
            <div className="h-80 flex items-center justify-center text-gray-500">データがありません</div>
          ) : (
            /* 株式チャート */
            <div className="flex flex-col gap-1">
              <PriceChart
                data={history}
                chartType={chartType}
                formatDate={formatDate}
                currency={currency}
                ma25={ma25Data}
                ma75={ma75Data}
                ma200={ma200Data}
                bbBands={bbData}
                hoverIdx={hoverIdx}
                setHoverIdx={setHoverIdx}
              />

              {showVolume && (
                <div className="mt-1">
                  <VolumeChart data={history} hoverIdx={hoverIdx} setHoverIdx={setHoverIdx} />
                </div>
              )}
              {showRSI && rsiData && (
                <div className="mt-1">
                  <RSIChart data={history} rsiVals={rsiData} hoverIdx={hoverIdx} setHoverIdx={setHoverIdx} />
                </div>
              )}
              {showRSI && !rsiData && (
                <div className="mt-1 py-3 text-center text-xs text-gray-500 bg-gray-800/30 rounded">
                  RSI計算にはデータが15本以上必要です
                </div>
              )}
              {showMACD && macdData && (
                <div className="mt-1">
                  <MACDChart data={history} macdVals={macdData} hoverIdx={hoverIdx} setHoverIdx={setHoverIdx} />
                </div>
              )}
              {showMACD && !macdData && (
                <div className="mt-1 py-3 text-center text-xs text-gray-500 bg-gray-800/30 rounded">
                  MACD計算にはデータが26本以上必要です
                </div>
              )}

              {showMACD && macdData && (
                <div className="flex gap-4 px-1 mt-1">
                  <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 bg-blue-500" /><span className="text-xs text-gray-400">MACD(12,26)</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 bg-orange-400" /><span className="text-xs text-gray-400">Signal(9)</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-green-500 opacity-60 rounded-sm" /><span className="text-xs text-gray-400">+Hist</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-red-500 opacity-60 rounded-sm" /><span className="text-xs text-gray-400">-Hist</span></div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
