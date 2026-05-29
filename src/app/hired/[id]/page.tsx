'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { db, doc, getDoc } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { ContractorDetail } from '@/components/hired/contractor-detail';
import type { Placement } from '@/lib/types';
import { ArrowLeft } from 'lucide-react';

export default function HiredDetailPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [placement, setPlacement] = useState<Placement | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, 'placements', id));
        if (snap.exists()) {
          setPlacement({ id: snap.id, ...snap.data() } as Placement);
        } else {
          setNotFound(true);
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  return (
    <MainLayout>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <a
            href="/hired"
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All placements
          </a>
          {placement && (
            <>
              <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">
                {placement.candidateName ?? 'Contractor'}
              </h1>
              <p className="text-xs text-[var(--light)]">{placement.orgName}</p>
            </>
          )}
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : notFound || !placement ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-12 text-center">
            <p className="text-sm font-600 text-[var(--black)]">Placement not found</p>
            <p className="mt-1 text-xs text-[var(--light)]">It may have been removed, or the link is incorrect.</p>
          </div>
        ) : (
          <ContractorDetail placement={placement} />
        )}
      </div>
    </MainLayout>
  );
}
