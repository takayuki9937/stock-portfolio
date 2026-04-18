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

    // 各ファンド行は <tr x-bind:class="checkedList.includes('CODE')..."> で始まる
    const rows = html.split(/<tr\s+x-bind:class=/);

    for (const row of rows.slice(1)) {
      // ファンドコード: href="/fund/{code}"
      const codeMatch = row.match(/href="\/fund\/([A-Za-z0-9]+)"/);
      if (!codeMatch) continue;
      const fundCode = codeMatch[1];

      // ファンド名: text-MK-link な <a> タグのテキスト
      const nameMatch = row.match(/text-MK-link[^>]*>\s*([\s\S]+?)\s*<\/a>/);
      if (!nameMatch) continue;
      const name = nameMatch[1].replace(/<[^>]+>/g, '').trim();
      if (!name) continue;

      // 基準価額: "基準価額 MM/DD" ラベルの直後の <p> テキスト
      const navMatch = row.match(/基準価額[^<]*<\/p>\s*<p>([\d,]+)円/);
      const nav = navMatch ? parseFloat(navMatch[1].replace(/,/g, '')) : null;

      results.push({ fundCode, name, nav });
    }

    return NextResponse.json({ results: results.slice(0, 20) });
  } catch {
    return NextResponse.json({ results: [] });
  }
}