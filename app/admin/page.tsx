'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface User {
  id: number;
  name: string;
  created_at: string;
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [users, setUsers] = useState<User[]>([]);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    setAuthLoading(false);
    if (res.ok) {
      setAuthed(true);
      fetchUsers();
    } else {
      const data = await res.json();
      setAuthError(data.error || 'エラーが発生しました');
    }
  }

  async function fetchUsers() {
    const res = await fetch('/api/users');
    setUsers(await res.json());
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError('');
    setAddLoading(true);
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    setAddLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setAddError(data.error || 'エラーが発生しました');
      return;
    }
    setNewName('');
    fetchUsers();
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`「${name}」を削除しますか？\n保有銘柄データも全て削除されます。`)) return;
    await fetch('/api/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    fetchUsers();
  }

  // パスワード入力画面
  if (!authed) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 w-full max-w-sm">
          <h1 className="text-xl font-bold text-blue-400 mb-2">管理画面</h1>
          <p className="text-gray-400 text-sm mb-6">パスワードを入力してください</p>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <input
              type="password"
              placeholder="パスワード"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
              required
              autoFocus
            />
            <button
              type="submit"
              disabled={authLoading}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-lg font-semibold transition-colors"
            >
              {authLoading ? '確認中...' : 'ログイン'}
            </button>
            {authError && <p className="text-red-400 text-sm">{authError}</p>}
          </form>
          <Link href="/" className="block text-center text-gray-500 text-sm mt-4 hover:text-gray-300 transition-colors">
            ← トップに戻る
          </Link>
        </div>
      </div>
    );
  }

  // 管理画面
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-blue-400">管理画面</h1>
          <div className="flex gap-6 items-center">
            <Link href="/" className="text-gray-400 hover:text-gray-200 transition-colors">一覧</Link>
            <Link href="/chart" className="text-gray-400 hover:text-gray-200 transition-colors">チャート</Link>
            <Link href="/report" className="text-gray-400 hover:text-gray-200 transition-colors">AIレポート</Link>
            <span className="text-blue-400 font-semibold border-b-2 border-blue-400 pb-1">管理</span>
          </div>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-8">
        {/* ユーザー追加 */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">ユーザーを追加</h2>
          <form onSubmit={handleAdd} className="flex gap-3">
            <input
              type="text"
              placeholder="ユーザー名"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500 flex-1"
              required
            />
            <button
              type="submit"
              disabled={addLoading}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
            >
              {addLoading ? '追加中...' : '追加'}
            </button>
          </form>
          {addError && <p className="text-red-400 text-sm mt-2">{addError}</p>}
        </div>

        {/* ユーザー一覧 */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-lg font-semibold">ユーザー一覧</h2>
          </div>
          {users.length === 0 ? (
            <div className="p-12 text-center text-gray-500">ユーザーがいません</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-6 py-3">ID</th>
                  <th className="px-6 py-3">名前</th>
                  <th className="px-6 py-3">作成日</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-800/50 transition-colors">
                    <td className="px-6 py-4 text-gray-500 text-sm">#{u.id}</td>
                    <td className="px-6 py-4 font-semibold">{u.name}</td>
                    <td className="px-6 py-4 text-gray-400 text-sm">
                      {new Date(u.created_at).toLocaleDateString('ja-JP')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleDelete(u.id, u.name)}
                        className="text-red-400 hover:text-red-300 text-sm transition-colors"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}