'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Nav } from './nav';
import { Sidebar } from './sidebar';
import { FullPageSpinner } from '@/components/ui/spinner';
import { ToastProvider } from '@/components/ui/toast';
import { useAuth } from '@/hooks/use-auth';
import { NW } from '@/components/nw/primitives';

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const { user, loading, isNearwork } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    } else if (!loading && user && !isNearwork) {
      router.replace('/login?error=not_nearwork');
    }
  }, [user, loading, isNearwork, router]);

  if (loading) return <FullPageSpinner />;
  if (!user || !isNearwork) return null;

  return (
    <ToastProvider>
      <div style={{ display: 'flex', height: '100vh', width: '100%', background: NW.backdrop, overflow: 'hidden' }}>
        <Sidebar />
        {/* Content column — rounded top-left inset on the backdrop */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            background: NW.white,
            borderTopLeftRadius: 22,
            overflow: 'hidden',
            borderTop: `1px solid ${NW.gray100}`,
            borderLeft: `1px solid ${NW.gray100}`,
          }}
        >
          <Nav />
          <main style={{ flex: 1, overflowY: 'auto', background: NW.white }}>
            <div style={{ maxWidth: 1340, margin: '0 auto', padding: '30px 36px 48px' }}>{children}</div>
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
