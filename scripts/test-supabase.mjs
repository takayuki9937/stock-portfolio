import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('環境変数が不足しています:');
  if (!supabaseUrl) console.error('  - NEXT_PUBLIC_SUPABASE_URL が未設定');
  if (!supabaseKey) console.error('  - SUPABASE_SECRET_KEY が未設定');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionFromUrl: false,
  },
});

console.log('Supabase URL:', supabaseUrl);
console.log('Key prefix:', supabaseKey.slice(0, 12) + '...');
console.log('usersテーブルを取得中...');

const { data, error } = await supabase.from('users').select('*');

if (error) {
  console.error('エラー:', error.message);
  console.error('詳細:', error);
  process.exit(1);
}

console.log('成功! ユーザー数:', data.length);
console.log('データ:', JSON.stringify(data, null, 2));
