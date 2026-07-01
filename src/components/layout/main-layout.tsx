'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Nav } from './nav';
import { Sidebar } from './sidebar';
import { FullPageSpinner } from '@/components/ui/spinner';
import { ToastProvider } from '@/components/ui/toast';
import { useAuth } from '@/hooks/use-auth';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { NW } from '@/components/nw/primitives';

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const { user, loading, isNearwork } = useAuth();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    } else if (!loading && user && !isNearwork) {
      router.replace('/login?error=not_nearwork');
    }
  }, [user, loading, isNearwork, router]);

  // Close the mobile drawer whenever we switch back to desktop.
  useEffect(() => { if (!isMobile) setDrawerOpen(false); }, [isMobile]);

  if (loading) return <FullPageSpinner />;
  if (!user || !isNearwork) return null;

  return (
    <ToastProvider>
      <div style={{ display: 'flex', height: '100dvh', width: '100%', background: NW.backdrop, overflow: 'hidden' }}>
        {isMobile ? (
          <>
            {/* Backdrop */}
            {drawerOpen && (
              <div
                onClick={() => setDrawerOpen(false)}
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 80 }}
              />
            )}
            {/* Slide-in drawer */}
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                bottom: 0,
                zIndex: 81,
                transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
                transition: 'transform 220ms cubic-bezier(0.16,1,0.3,1)',
                boxShadow: drawerOpen ? '0 0 40px rgba(0,0,0,0.28)' : 'none',
              }}
            >
              <Sidebar onNavigate={() => setDrawerOpen(false)} />
            </div>
          </>
        ) : (
          <Sidebar />
        )}

        {/* Content column — rounded top-left inset on the backdrop (desktop only) */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            background: NW.white,
            borderTopLeftRadius: isMobile ? 0 : 22,
            overflow: 'hidden',
            borderTop: isMobile ? 'none' : `1px solid ${NW.gray100}`,
            borderLeft: isMobile ? 'none' : `1px solid ${NW.gray100}`,
          }}
        >
          <Nav showMenu={isMobile} onMenuClick={() => setDrawerOpen(true)} />
          <main style={{ flex: 1, overflowY: 'auto', background: NW.white }}>
            <div className="nw-content" style={{ maxWidth: 1340, margin: '0 auto', padding: '30px 36px 48px' }}>{children}</div>
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
