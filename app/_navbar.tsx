'use client';
import { useState } from 'react';
import Link from 'next/link';

type NavKey = 'portfolio' | 'chart' | 'report' | 'admin';

const LINKS: { href: string; label: string; key: NavKey }[] = [
  { href: '/',       label: 'ポートフォリオ', key: 'portfolio' },
  { href: '/chart',  label: 'チャート',        key: 'chart'     },
  { href: '/report', label: 'AIレポート',      key: 'report'    },
  { href: '/admin',  label: '管理',            key: 'admin'     },
];

export function NavBar({ active }: { active: NavKey }) {
  const [open, setOpen] = useState(false);

  return (
    <nav className="bg-gray-900 border-b border-gray-800 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <h1 className="text-lg font-bold text-blue-400">株ポートフォリオ</h1>

        {/* Desktop */}
        <div className="hidden sm:flex gap-5 items-center">
          {LINKS.map((l) => (
            <Link key={l.key} href={l.href}
              className={active === l.key
                ? 'text-blue-400 font-semibold border-b-2 border-blue-400 pb-0.5 text-sm'
                : 'text-gray-400 hover:text-gray-200 transition-colors text-sm'}>
              {l.label}
            </Link>
          ))}
        </div>

        {/* Mobile hamburger */}
        <button
          className="sm:hidden p-2 text-gray-300 hover:text-white"
          onClick={() => setOpen(!open)}
          aria-label="メニュー">
          {open
            ? <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            : <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
          }
        </button>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="sm:hidden border-t border-gray-800 mt-3 pt-3 flex flex-col gap-1">
          {LINKS.map((l) => (
            <Link key={l.key} href={l.href} onClick={() => setOpen(false)}
              className={`px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${
                active === l.key
                  ? 'bg-blue-900/40 text-blue-400'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}>
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}