'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  db,
  collection,
  getDocs,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { sortByTimestamp } from '@/lib/utils';
import type { Opening } from '@/lib/types';
import { ApprovalBadge } from './opening-detail';
import { Search, Plus, ChevronRight } from 'lucide-react';

export default function OpeningsPage() {
  const { showToast } = useToast();
  const router = useRouter();

  const [openings, setOpenings] = useState<Opening[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    getDocs(collection(db, 'openings'))
      .then((snap) => {
        setOpenings(sortByTimestamp(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Opening)), 'createdAt'));
        setLoading(false);
      })
      .catch(() => {
        showToast('Failed to load openings', 'error');
        setLoading(false);
      });
  }, []);

  const filtered = openings.filter((o) => {
    const q = search.toLowerCase();
    const matchSearch = !q || [o.title, o.orgName, o.recruiter, o.department].join(' ').toLowerCase().includes(q);
    const matchStatus = !statusFilter || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <MainLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">Openings</h1>
            <p className="mt-0.5 text-xs text-[var(--light)]">
              {openings.length} opening{openings.length !== 1 ? 's' : ''} across all organizations
            </p>
          </div>
          <button
            onClick={() => router.push('/openings/new')}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-600 text-white"
            style={{ background: 'var(--green)' }}
          >
            <Plus className="h-3.5 w-3.5" />
            New opening
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--light)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search openings..."
              className="w-full rounded-lg border border-[var(--border)] bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-[var(--green)]"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="paused">Paused</option>
            <option value="filled">Filled</option>
            <option value="cancelled">Cancelled</option>
            <option value="draft">Draft</option>
          </select>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-0 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
              <div>Opening</div>
              <div>ID</div>
              <div>Organization</div>
              <div>Recruiter</div>
              <div>Status</div>
              <div />
            </div>
            {filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-[var(--light)]">
                No openings found.
              </div>
            ) : (
              filtered.map((o) => (
                <div
                  key={o.id}
                  className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] items-center gap-0 border-b border-[var(--border)] px-4 py-3 last:border-0 hover:bg-[var(--bg)] cursor-pointer"
                  onClick={() => router.push(`/openings/${o.code ?? o.id}`)}
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-600 text-[var(--black)]">{o.title}</p>
                    <p className="text-[10px] text-[var(--light)]">
                      {o.department ?? '—'} · {o.location ?? 'Remote'}
                    </p>
                  </div>
                  <div className="text-[10px] font-600 text-[var(--mid)] font-mono">{o.code ?? '—'}</div>
                  <div className="text-xs text-[var(--mid)]">{o.orgName ?? '—'}</div>
                  <div className="text-xs text-[var(--mid)]">{o.recruiter ?? '—'}</div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge label={o.status} variant="status" />
                    <ApprovalBadge status={o.approvalStatus} />
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-[var(--light)]" />
                </div>
              ))
            )}
          </div>
        )}
      </div>

    </MainLayout>
  );
}
