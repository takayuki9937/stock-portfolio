import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const userId = new URL(req.url).searchParams.get('userId');
  let query = supabase.from('holdings').select('*').order('created_at', { ascending: false });
  if (userId) query = query.eq('user_id', Number(userId));
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const { userId, ticker, market, shares, cost_price } = await req.json();
  if (!userId || !ticker || !shares || !cost_price) {
    return NextResponse.json({ error: '全フィールドを入力してください' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('holdings')
    .insert({
      user_id: Number(userId),
      ticker: ticker.toUpperCase(),
      market: market === 'JP' ? 'JP' : 'US',
      shares,
      cost_price,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'この銘柄は既に登録されています' }, { status: 409 });
    }
    return NextResponse.json({ error: '登録に失敗しました' }, { status: 500 });
  }
  return NextResponse.json({ id: data.id }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  const { error } = await supabase.from('holdings').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}