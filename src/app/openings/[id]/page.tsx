'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db, collection, getDocs, doc, getDoc } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { OpeningDetail } from '@/components/openings/opening-detail';
import { useAuth } from '@/hooks/use-auth';
import { ChevronLeft } from 'lucide-react';
import type { Opening, Organization } from '@/lib/types';

export default function OpeningDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { profile } = useAuth();

  const [opening, setOpening] = useState<Opening | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  async function load() {
    const [snap, orgSnap] = await Promise.all([
      getDoc(doc(db, 'openings', id)),
      getDocs(collection(db, 'organizations')),
    ]);
    if (!snap.exists()) {
      setNotFound(true);
    } else {
      setOpening({ id: snap.id, ...snap.data() } as Opening);
      setOrgs(orgSnap.docs.map((d) => ({ ...d.data(), id: d.id } as Organization)));
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  return (
    <MainLayout>
      <div className="space-y-5">
        {/* Back + header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <button
              onClick={() => router.push('/openings')}
              className="mb-2 flex items-center gap-1 text-xs text-[var(--light)] hover:text-[var(--green)]"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              All openings
            </button>
            <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">
              {loading ? 'Loading…' : (opening?.title ?? 'Opening not found')}
            </h1>
            {opening && (
              <p className="mt-0.5 text-xs text-[var(--light)]">
                {opening.orgName ?? '—'} · <span className="font-mono">{opening.code ?? opening.id}</span>
              </p>
            )}
          </div>
        </div>

        {loading && (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        )}

        {!loading && notFound && (
          <div className="rounded-2xl border border-[var(--border)] bg-white p-10 text-center text-sm text-[var(--light)]">
            Opening not found.
          </div>
        )}

        {!loading && opening && (
          <OpeningDetail
            opening={opening}
            orgs={orgs}
            currentRole={profile?.role}
            onClose={() => router.push('/openings')}
            onRefresh={load}
          />
        )}
      </div>
    </MainLayout>
  );
}
