'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { db, doc, getDoc } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { TeamDetail } from '@/components/teams/team-detail';
import type { ManagedTeam } from '@/components/teams/teams-page';

export default function TeamDetailPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [team, setTeam] = useState<ManagedTeam | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'managedTeams', id));
      if (snap.exists()) setTeam({ id: snap.id, ...snap.data() } as ManagedTeam);
      else setNotFound(true);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  return (
    <MainLayout>
      <div className="space-y-5">
        {loading ? (
          <div className="flex h-40 items-center justify-center"><Spinner /></div>
        ) : notFound || !team ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-12 text-center">
            <p className="text-sm font-600 text-[var(--black)]">Team not found</p>
            <p className="mt-1 text-xs text-[var(--light)]">It may have been removed, or the link is incorrect.</p>
          </div>
        ) : (
          <TeamDetail team={team} onRefresh={load} />
        )}
      </div>
    </MainLayout>
  );
}
