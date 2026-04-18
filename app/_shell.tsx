'use client';

import { usePathname } from 'next/navigation';
import { ChartContent }  from './chart/_content';
import { ReportContent } from './report/_content';

export function PersistentShell() {
  const pathname = usePathname();
  const isChart  = pathname === '/chart';
  const isReport = pathname === '/report';

  if (!isChart && !isReport) return null;

  return (
    <>
      <div style={{ display: isChart  ? 'block' : 'none' }}>
        <ChartContent />
      </div>
      <div style={{ display: isReport ? 'block' : 'none' }}>
        <ReportContent />
      </div>
    </>
  );
}