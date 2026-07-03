'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { db, doc, onSnapshot } from '@/lib/firebase';
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
    setLoading(true);
    // Live subscription so a recruiter's change shows here in real time.
    const unsub = onSnapshot(
      doc(db, 'candidates', id),
      (snap) => {
        if (snap.exists()) {
          setCandidate({ id: snap.id, ...snap.data() } as Candidate);
          setNotFound(false);
        } else {
          setNotFound(true);
        }
        setLoading(false);
      },
      () => {
        setNotFound(true);
        setLoading(false);
      },
    );
    return () => unsub();
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
