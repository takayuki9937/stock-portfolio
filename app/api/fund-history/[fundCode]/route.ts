import { NextRequest, NextResponse } from 'next/server';

// 期間 → minkabu APIのperiodパラメータ
const PERIOD_MAP: Record<string, string> = {
  '1M': 'daily',
  '3M': 'daily',
  '6M': 'daily',
  '1Y': 'daily',
  '3Y': 'monthly',
  '5Y': 'monthly',
};

// 期間 → 取得する日数（daily用フィルタ）
const RANGE_DAYS: Record<string, number> = {
  '1M': 31,
  '3M': 93,
  '6M': 186,
  '1Y': 366,
  '3Y': Infinity,
  '5Y': Infinity,
};

export async function GET(
  req: NextRequest,
  { params }: { params: { fundCode: string } }
) {
  const { fundCode } = params;
  const range = new URL(req.url).searchParams.get('range') ?? '1Y';
  const period = PERIOD_MAP[range] ?? 'daily';
  const maxDays = RANGE_DAYS[range] ?? 366;

  try {
    const res = await fetch(
      `https://itf.minkabu.jp/json/funds/${fundCode}/get_line_${period}_json`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://itf.minkabu.jp/',
        },
        next: { revalidate: 3600 },
      }
    );

    if (!res.ok) {
      return NextResponse.json({ error: 'fetch failed' }, { status: 502 });
    }

    const json = await res.json() as { data: [number, number, null, number, number][] };

    if (!json.data || !Array.isArray(json.data)) {
      return NextResponse.json({ error: 'invalid data' }, { status: 502 });
    }

    // データは新しい順で返ってくるので古い順にソート
    const sorted = [...json.data].sort((a, b) => a[0] - b[0]);

    // 期間フィルタ（dailyの場合）
    let filtered = sorted;
    if (maxDays !== Infinity) {
      const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
      filtered = sorted.filter(([ts]) => ts >= cutoff);
    }

    const history = filtered.map(([ts, nav]) => ({
      date: new Date(ts).toISOString().slice(0, 10),
      nav,
    }));

    return NextResponse.json({ history });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}