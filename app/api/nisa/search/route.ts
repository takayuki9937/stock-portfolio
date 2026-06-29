import { NextRequest, NextResponse } from 'next/server';

interface FundResult {
  name: string;
  fundCode: string;
  nav: number | null;
}

export async function GET(req: NextRequest) {
  const keyword = new URL(req.url).searchParams.get('keyword') ?? '';
  if (keyword.length < 1) return NextResponse.json({ results: [] });

  try {
    const res = await fetch(
      `https://itf.minkabu.jp/searching/result?keyword=${encodeURIComponent(keyword)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 60 } },
    );
    if (!res.ok) return NextResponse.json({ results: [] });

    const html = await res.text();
    const results: FundResult[] = [];

    // 検索結果行は <tr class="odd:bg-slate-50 even:bg-white cursor-pointer"> で始まる
    const rows = html.split(/class="odd:bg-slate-50 even:bg-white cursor-pointer"/);

    for (const row of rows.slice(1)) {
      // ファンドコード: checkbox の value="CODE"
      const codeMatch = row.match(/value="([A-Za-z0-9]+)"/);
      if (!codeMatch) continue;
      const fundCode = codeMatch[1];

      // ファンド名: x-bind:class を持つ <td> のテキスト
      const nameMatch = row.match(/x-bind:class="[^"]*"[^>]*>\s*([\s\S]+?)\s*<\/td>/);
      if (!nameMatch) continue;
      const name = nameMatch[1].replace(/<[^>]+>/g, '').trim();
      if (!name) continue;

      results.push({ fundCode, name, nav: null });
    }

    return NextResponse.json({ results: results.slice(0, 20) });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
