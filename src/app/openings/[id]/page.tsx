'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db, collection, getDocs, doc, getDoc } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { OpeningDetail } from '@/components/openings/opening-detail';
import { useAuth } from '@/hooks/use-auth';
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
            currentEmail={profile?.email}
            onClose={() => router.push('/openings')}
            onRefresh={load}
          />
        )}
      </div>
    </MainLayout>
  );
}
