'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Nav } from './nav';
import { Sidebar } from './sidebar';
import { FullPageSpinner } from '@/components/ui/spinner';
import { ToastProvider } from '@/components/ui/toast';
import { useAuth } from '@/hooks/use-auth';

interface MainLayoutProps {
  children: React.ReactNode;
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
      <Nav />
      <Sidebar />
      <main
        className="min-h-screen"
        style={{
          paddingTop: 'var(--nav-h)',
          paddingLeft: 'var(--sidebar-w)',
        }}
      >
        <div className="h-full p-6">{children}</div>
      </main>
    </ToastProvider>
  );
}
