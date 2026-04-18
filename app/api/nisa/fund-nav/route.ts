import { NextRequest, NextResponse } from 'next/server';

/** みんかぶ投信ページの meta[description] から基準価額を取得 */
async function fetchFromMinkabu(fundCode: string): Promise<number | null> {
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

export async function GET(req: NextRequest) {
  const code = new URL(req.url).searchParams.get('code');
  if (!code) return NextResponse.json({ nav: null, error: 'code required' }, { status: 400 });

  const nav = await fetchFromMinkabu(code);
  return NextResponse.json({ nav, code });
}