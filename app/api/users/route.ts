import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('id', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const { name } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: 'ユーザー名を入力してください' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('users')
    .insert({ name: name.trim() })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'そのユーザー名は既に存在します' }, { status: 409 });
    }
    return NextResponse.json({ error: '登録に失敗しました' }, { status: 500 });
  }
  return NextResponse.json({ id: data.id }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await supabase.from('holdings').delete().eq('user_id', id);
  await supabase.from('users').delete().eq('id', id);
  return NextResponse.json({ success: true });
}