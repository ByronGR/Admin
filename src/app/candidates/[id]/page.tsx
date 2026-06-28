'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { db, doc, getDoc } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { CandidateDetail } from '@/components/candidates/candidate-detail';
import type { Candidate } from '@/lib/types';
import { BackBar } from '@/components/nw/shell-ui';

export default function CandidateDetailPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, 'candidates', id));
        if (snap.exists()) {
          setCandidate({ id: snap.id, ...snap.data() } as Candidate);
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
        <BackBar label="All candidates" href="/candidates" />

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : notFound || !candidate ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-12 text-center">
            <p className="text-sm font-600 text-[var(--black)]">Candidate not found</p>
            <p className="mt-1 text-xs text-[var(--light)]">
              It may have been removed, or the link is incorrect.
            </p>
          </div>
        ) : (
          <CandidateDetail candidate={candidate} />
        )}
      </div>
    </MainLayout>
  );
}
