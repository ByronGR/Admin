'use client';

import { useState, useEffect } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  db,
  collection,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp,
  query,
  where,
  addDoc,
  onSnapshot,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/hooks/use-auth';
import { fmtDate, initials, truncate, snakeToTitle } from '@/lib/utils';
import type { Pipeline, PipelineCandidate, Candidate } from '@/lib/types';
import {
  Search,
  Plus,
  Filter,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MessageCircle,
  Trash2,
  Edit3,
  ClipboardList,
  X,
} from 'lucide-react';

// ─── Pipeline stages ──────────────────────────────────────────────────────────

export const PIPELINE_STAGES = [
  { key: 'profile-review', label: 'Profile Review' },
  { key: 'background-check', label: 'Background Checks' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'interview', label: 'Interview' },
  { key: 'presented', label: 'Presented' },
  { key: 'client-review', label: 'Client Review', clientAction: true },
  { key: 'hired', label: 'Hired', clientAction: true },
] as const;

type StageKey = (typeof PIPELINE_STAGES)[number]['key'];

function normalizeStage(stage: string): StageKey {
  const s = String(stage || '')
    .trim()
    .toLowerCase();
  if (['applied', 'screening', 'shortlisted'].includes(s)) return 'profile-review';
  if (['background-checks', 'background'].includes(s)) return 'background-check';
  if (s === 'client-interview') return 'interview';
  if (['company-review', 'final-review', 'offer'].includes(s)) return 'client-review';
  if (PIPELINE_STAGES.some((st) => st.key === s)) return s as StageKey;
  return 'profile-review';
}

function scoreClass(score: number): string {
  if (!score || score === 0) return 'score-na';
  if (score >= 80) return 'score-hi';
  if (score >= 60) return 'score-mid';
  return 'score-lo';
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activePipelineCode, setActivePipelineCode] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Add candidate modal
  const [addModal, setAddModal] = useState<{
    open: boolean;
    pipelineCode: string;
    stage: string;
  }>({ open: false, pipelineCode: '', stage: '' });
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidateResults, setCandidateResults] = useState<Candidate[]>([]);
  const [candidateSearchLoading, setCandidateSearchLoading] = useState(false);

  // Brief modal (candidate detail)
  const [briefModal, setBriefModal] = useState<{
    open: boolean;
    candidate: PipelineCandidate | null;
    pipelineCode: string;
  }>({ open: false, candidate: null, pipelineCode: '' });

  useEffect(() => {
    // Real-time listener
    const unsub = onSnapshot(collection(db, 'pipelines'), (snap) => {
      const data = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as Pipeline[];
      // Ensure candidates array
      data.forEach((p) => {
        if (!p.candidates) p.candidates = [];
      });
      setPipelines(data);
      setLoading(false);
    });
    return unsub;
  }, []);

  // Filter pipelines
  const filtered = pipelines.filter((p) => {
    const matchSearch =
      !search ||
      [p.title, p.orgName, p.code, p.recruiter]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase());
    const matchStatus =
      statusFilter === 'all' || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  // Active pipeline
  const activePipeline = activePipelineCode
    ? filtered.find((p) => p.code === activePipelineCode) ?? null
    : null;

  function toggleRow(code: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  // Drag state
  const [dragging, setDragging] = useState<PipelineCandidate | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  async function handleDragEnd(event: DragEndEvent, pipelineCode: string) {
    const { active, over } = event;
    setDragging(null);
    if (!over || active.id === over.id) return;

    const toStage = String(over.id).replace('col-', '') as StageKey;
    const candidateCode = String(active.id).replace('cand-', '');

    const pipeline = pipelines.find((p) => p.code === pipelineCode);
    if (!pipeline) return;

    const candIndex = pipeline.candidates?.findIndex((c) => c.candidateId === candidateCode) ?? -1;
    if (candIndex === -1) return;

    const fromStage = pipeline.candidates![candIndex].stage;
    if (fromStage === toStage) return;

    // Optimistic update
    const updated = pipelines.map((p) => {
      if (p.code !== pipelineCode) return p;
      const cands = [...(p.candidates ?? [])];
      cands[candIndex] = { ...cands[candIndex], stage: toStage };
      return { ...p, candidates: cands };
    });
    setPipelines(updated);

    try {
      const pipelineDoc = pipelines.find((p) => p.code === pipelineCode);
      if (!pipelineDoc) return;
      const newCandidates = (pipelineDoc.candidates ?? []).map((c) =>
        c.candidateId === candidateCode ? { ...c, stage: toStage } : c
      );
      await updateDoc(doc(db, 'pipelines', pipelineDoc.id), {
        candidates: newCandidates,
        updatedAt: serverTimestamp(),
      });
      showToast(`Moved to ${PIPELINE_STAGES.find((s) => s.key === toStage)?.label}`, 'success');
    } catch {
      showToast('Failed to move candidate', 'error');
      // Revert
      setPipelines(pipelines);
    }
  }

  async function removeCandidateFromPipeline(candidateCode: string, pipelineCode: string) {
    const pipeline = pipelines.find((p) => p.code === pipelineCode);
    if (!pipeline) return;
    const newCandidates = (pipeline.candidates ?? []).filter(
      (c) => c.candidateId !== candidateCode
    );
    try {
      await updateDoc(doc(db, 'pipelines', pipeline.id), {
        candidates: newCandidates,
        updatedAt: serverTimestamp(),
      });
      showToast('Candidate removed from pipeline', 'success');
    } catch {
      showToast('Failed to remove candidate', 'error');
    }
  }

  async function updatePipelineStatus(pipelineId: string, status: string) {
    try {
      await updateDoc(doc(db, 'pipelines', pipelineId), { status, updatedAt: serverTimestamp() });
      showToast('Pipeline status updated', 'success');
    } catch {
      showToast('Failed to update status', 'error');
    }
  }

  // Search candidates for adding to pipeline
  useEffect(() => {
    if (!addModal.open || !candidateSearch.trim()) {
      setCandidateResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setCandidateSearchLoading(true);
      try {
        const snap = await getDocs(collection(db, 'candidates'));
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Candidate));
        const q = candidateSearch.toLowerCase();
        setCandidateResults(
          all
            .filter(
              (c) =>
                c.name?.toLowerCase().includes(q) ||
                c.email?.toLowerCase().includes(q)
            )
            .slice(0, 8)
        );
      } catch {
        setCandidateResults([]);
      } finally {
        setCandidateSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [candidateSearch, addModal.open]);

  async function addCandidateToPipeline(candidate: Candidate) {
    const pipeline = pipelines.find((p) => p.code === addModal.pipelineCode);
    if (!pipeline) return;

    const alreadyIn = pipeline.candidates?.some(
      (c) => c.candidateId === candidate.id
    );
    if (alreadyIn) {
      showToast('Candidate already in this pipeline', 'info');
      return;
    }

    const newEntry: PipelineCandidate = {
      candidateId: candidate.id,
      name: candidate.name,
      email: candidate.email,
      stage: normalizeStage(addModal.stage),
    };

    try {
      await updateDoc(doc(db, 'pipelines', pipeline.id), {
        candidates: [...(pipeline.candidates ?? []), newEntry],
        updatedAt: serverTimestamp(),
      });
      showToast(`${candidate.name} added to pipeline`, 'success');
      setAddModal({ open: false, pipelineCode: '', stage: '' });
      setCandidateSearch('');
    } catch {
      showToast('Failed to add candidate', 'error');
    }
  }

  return (
    <MainLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">
              Pipeline
            </h1>
            <p className="mt-0.5 text-xs text-[var(--light)]">
              {filtered.length} pipeline{filtered.length !== 1 ? 's' : ''}
              {activePipeline ? ` · Viewing ${activePipeline.code}` : ''}
            </p>
          </div>
          {activePipeline && (
            <button
              onClick={() => setActivePipelineCode(null)}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
            >
              <X className="h-3.5 w-3.5" />
              Back to list
            </button>
          )}
        </div>

        {/* Toolbar */}
        {!activePipeline && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--light)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search pipeline, org, recruiter..."
                className="w-full rounded-lg border border-[var(--border)] bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-[var(--green)]"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="on-hold">On hold</option>
              <option value="finished">Finished</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        )}

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : activePipeline ? (
          /* Full workspace */
          <PipelineWorkspace
            pipeline={activePipeline}
            onDragEnd={(e) => handleDragEnd(e, activePipeline.code)}
            onDragStart={(e) => {
              const candidateCode = String(e.active.id).replace('cand-', '');
              const cand = activePipeline.candidates?.find(
                (c) => c.candidateId === candidateCode
              );
              setDragging(cand ?? null);
            }}
            dragging={dragging}
            sensors={sensors}
            onRemove={removeCandidateFromPipeline}
            onUpdateStatus={updatePipelineStatus}
            onAddCandidate={(pipelineCode, stage) =>
              setAddModal({ open: true, pipelineCode, stage })
            }
            onOpenBrief={(c, code) =>
              setBriefModal({ open: true, candidate: c, pipelineCode: code })
            }
          />
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-white py-16 text-center">
            <p className="text-sm text-[var(--light)]">No pipelines found.</p>
          </div>
        ) : (
          /* List view */
          <div className="space-y-3">
            {filtered.map((p) => (
              <PipelineRow
                key={p.code}
                pipeline={p}
                expanded={expandedRows.has(p.code)}
                onToggle={() => toggleRow(p.code)}
                onOpen={() => setActivePipelineCode(p.code)}
                onUpdateStatus={updatePipelineStatus}
                onDragEnd={(e) => handleDragEnd(e, p.code)}
                onDragStart={(e) => {
                  const candidateCode = String(e.active.id).replace('cand-', '');
                  const cand = p.candidates?.find(
                    (c) => c.candidateId === candidateCode
                  );
                  setDragging(cand ?? null);
                }}
                dragging={dragging}
                sensors={sensors}
                onRemove={removeCandidateFromPipeline}
                onAddCandidate={(pipelineCode, stage) =>
                  setAddModal({ open: true, pipelineCode, stage })
                }
                onOpenBrief={(c, code) =>
                  setBriefModal({ open: true, candidate: c, pipelineCode: code })
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Add candidate modal */}
      <Modal
        open={addModal.open}
        onClose={() => {
          setAddModal({ open: false, pipelineCode: '', stage: '' });
          setCandidateSearch('');
        }}
        title="Add candidate to pipeline"
        size="md"
      >
        <div className="space-y-3">
          <p className="text-xs text-[var(--light)]">
            Adding to{' '}
            <strong className="text-[var(--black)]">{addModal.pipelineCode}</strong>{' '}
            · {snakeToTitle(addModal.stage)}
          </p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--light)]" />
            <input
              value={candidateSearch}
              onChange={(e) => setCandidateSearch(e.target.value)}
              placeholder="Search by name or email..."
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] py-2.5 pl-8 pr-3 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
              autoFocus
            />
          </div>
          {candidateSearchLoading && (
            <div className="flex justify-center py-4">
              <Spinner size="sm" />
            </div>
          )}
          {candidateResults.length > 0 && (
            <div className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)]">
              {candidateResults.map((c) => (
                <button
                  key={c.id}
                  onClick={() => addCandidateToPipeline(c)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--bg)]"
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-700 text-white"
                    style={{ background: 'var(--green)' }}
                  >
                    {initials(c.name)}
                  </div>
                  <div>
                    <p className="text-xs font-600 text-[var(--black)]">{c.name}</p>
                    <p className="text-[10px] text-[var(--light)]">{c.email}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {!candidateSearchLoading && candidateSearch && candidateResults.length === 0 && (
            <p className="py-4 text-center text-xs text-[var(--light)]">
              No candidates found.
            </p>
          )}
        </div>
      </Modal>

      {/* Candidate brief modal */}
      <Modal
        open={briefModal.open}
        onClose={() => setBriefModal({ open: false, candidate: null, pipelineCode: '' })}
        title={briefModal.candidate?.name ?? 'Candidate'}
        size="md"
      >
        {briefModal.candidate && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Stage
                </p>
                <p className="mt-0.5 font-500 capitalize text-[var(--black)]">
                  {snakeToTitle(briefModal.candidate.stage)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Score
                </p>
                <p className="mt-0.5 font-700 text-[var(--black)]">
                  {briefModal.candidate.score ?? '—'}
                </p>
              </div>
              {briefModal.candidate.email && (
                <div className="col-span-2">
                  <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                    Email
                  </p>
                  <p className="mt-0.5 text-[var(--black)]">{briefModal.candidate.email}</p>
                </div>
              )}
              {briefModal.candidate.notes && (
                <div className="col-span-2">
                  <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                    Notes
                  </p>
                  <p className="mt-0.5 text-[var(--mid)]">{briefModal.candidate.notes}</p>
                </div>
              )}
            </div>
            <div className="flex gap-2 border-t border-[var(--border)] pt-3">
              <button
                onClick={() => {
                  setBriefModal({ open: false, candidate: null, pipelineCode: '' });
                  // TODO: navigate to messages with this candidate
                }}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                WhatsApp
              </button>
              <button
                onClick={() => {
                  if (briefModal.candidate) {
                    removeCandidateFromPipeline(
                      briefModal.candidate.candidateId,
                      briefModal.pipelineCode
                    );
                  }
                  setBriefModal({ open: false, candidate: null, pipelineCode: '' });
                }}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-500 text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </button>
            </div>
          </div>
        )}
      </Modal>
    </MainLayout>
  );
}

// ─── Pipeline row (collapsed list view) ──────────────────────────────────────

function PipelineRow({
  pipeline,
  expanded,
  onToggle,
  onOpen,
  onUpdateStatus,
  onDragEnd,
  onDragStart,
  dragging,
  sensors,
  onRemove,
  onAddCandidate,
  onOpenBrief,
}: {
  pipeline: Pipeline;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onUpdateStatus: (id: string, status: string) => Promise<void>;
  onDragEnd: (e: DragEndEvent) => void;
  onDragStart: (e: DragStartEvent) => void;
  dragging: PipelineCandidate | null;
  sensors: ReturnType<typeof useSensors>;
  onRemove: (candidateCode: string, pipelineCode: string) => Promise<void>;
  onAddCandidate: (pipelineCode: string, stage: string) => void;
  onOpenBrief: (c: PipelineCandidate, pipelineCode: string) => void;
}) {
  const statusColor =
    pipeline.status === 'active'
      ? 'b-green'
      : pipeline.status === 'cancelled'
        ? 'b-red'
        : 'b-amber';

  return (
    <div
      className={`overflow-hidden rounded-2xl border transition-all ${
        pipeline.status === 'cancelled'
          ? 'border-red-100 bg-red-50/30'
          : 'border-[var(--border)] bg-white'
      }`}
    >
      <div
        className="flex cursor-pointer items-center gap-3 px-5 py-4"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-600 text-[var(--black)]">
            {pipeline.title}
          </p>
          <p className="text-xs text-[var(--light)]">
            {pipeline.code}
            {pipeline.orgName ? ` · ${pipeline.orgName}` : ''}
          </p>
        </div>
        <div className="hidden items-center gap-4 sm:flex">
          {pipeline.recruiter && (
            <span className="text-xs text-[var(--mid)]">{pipeline.recruiter}</span>
          )}
          <Badge label={pipeline.status} variant="status" />
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onOpen}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-600 text-[var(--green)] hover:border-[var(--green)]"
          >
            Open workspace
          </button>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-[var(--light)]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[var(--light)]" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[var(--border)] px-5 pb-5 pt-4">
          <KanbanBoard
            pipeline={pipeline}
            onDragEnd={onDragEnd}
            onDragStart={onDragStart}
            dragging={dragging}
            sensors={sensors}
            onRemove={onRemove}
            onAddCandidate={onAddCandidate}
            onOpenBrief={onOpenBrief}
            compact
          />
        </div>
      )}
    </div>
  );
}

// ─── Full workspace ───────────────────────────────────────────────────────────

function PipelineWorkspace({
  pipeline,
  onDragEnd,
  onDragStart,
  dragging,
  sensors,
  onRemove,
  onUpdateStatus,
  onAddCandidate,
  onOpenBrief,
}: {
  pipeline: Pipeline;
  onDragEnd: (e: DragEndEvent) => void;
  onDragStart: (e: DragStartEvent) => void;
  dragging: PipelineCandidate | null;
  sensors: ReturnType<typeof useSensors>;
  onRemove: (candidateCode: string, pipelineCode: string) => Promise<void>;
  onUpdateStatus: (id: string, status: string) => Promise<void>;
  onAddCandidate: (pipelineCode: string, stage: string) => void;
  onOpenBrief: (c: PipelineCandidate, pipelineCode: string) => void;
}) {
  const { showToast } = useToast();
  const [showEdit, setShowEdit] = useState(false);
  const [editRecruiter, setEditRecruiter] = useState(pipeline.recruiter ?? '');
  const [editManager, setEditManager] = useState(pipeline.accountManager ?? '');
  const [editStatus, setEditStatus] = useState(pipeline.status);

  async function saveEdits() {
    try {
      await updateDoc(doc(db, 'pipelines', pipeline.id), {
        recruiter: editRecruiter,
        accountManager: editManager,
        status: editStatus,
        updatedAt: serverTimestamp(),
      });
      showToast('Pipeline saved', 'success');
      setShowEdit(false);
    } catch {
      showToast('Failed to save', 'error');
    }
  }

  return (
    <div className="space-y-4">
      {/* Info strip */}
      <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div>
            <p className="font-600 uppercase tracking-wider text-[var(--light)]" style={{ fontSize: 10 }}>
              Opening
            </p>
            <p className="mt-0.5 font-600 text-[var(--black)]">{pipeline.code}</p>
          </div>
          <div>
            <p className="font-600 uppercase tracking-wider text-[var(--light)]" style={{ fontSize: 10 }}>
              Organization
            </p>
            <p className="mt-0.5 font-600 text-[var(--black)]">{pipeline.orgName ?? '—'}</p>
          </div>
          <div>
            <p className="font-600 uppercase tracking-wider text-[var(--light)]" style={{ fontSize: 10 }}>
              Candidates
            </p>
            <p className="mt-0.5 font-600 text-[var(--black)]">{pipeline.candidates?.length ?? 0}</p>
          </div>
          <div>
            <p className="font-600 uppercase tracking-wider text-[var(--light)]" style={{ fontSize: 10 }}>
              Status
            </p>
            <p className="mt-0.5">
              <Badge label={pipeline.status} variant="status" />
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => setShowEdit((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
            >
              <Edit3 className="h-3.5 w-3.5" />
              Edit pipeline
            </button>
            <button
              onClick={() => window.open(`/kickoff?code=${pipeline.code}`, '_blank')}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
            >
              <ClipboardList className="h-3.5 w-3.5" />
              Kick-off Brief
            </button>
          </div>
        </div>

        {showEdit && (
          <div className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                Recruiter
              </label>
              <input
                value={editRecruiter}
                onChange={(e) => setEditRecruiter(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                Hiring manager
              </label>
              <input
                value={editManager}
                onChange={(e) => setEditManager(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                Status
              </label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as Pipeline['status'])}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
              >
                <option value="active">Active</option>
                <option value="paused">On hold</option>
                <option value="cancelled">Cancelled</option>
                <option value="filled">Finished</option>
              </select>
            </div>
            <div className="sm:col-span-3">
              <button
                onClick={saveEdits}
                className="rounded-lg px-4 py-2 text-xs font-600 text-white"
                style={{ background: 'var(--green)' }}
              >
                Save changes
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Kanban board */}
      <KanbanBoard
        pipeline={pipeline}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        dragging={dragging}
        sensors={sensors}
        onRemove={onRemove}
        onAddCandidate={onAddCandidate}
        onOpenBrief={onOpenBrief}
      />
    </div>
  );
}

// ─── Kanban board ─────────────────────────────────────────────────────────────

function KanbanBoard({
  pipeline,
  onDragEnd,
  onDragStart,
  dragging,
  sensors,
  onRemove,
  onAddCandidate,
  onOpenBrief,
  compact,
}: {
  pipeline: Pipeline;
  onDragEnd: (e: DragEndEvent) => void;
  onDragStart: (e: DragStartEvent) => void;
  dragging: PipelineCandidate | null;
  sensors: ReturnType<typeof useSensors>;
  onRemove: (candidateCode: string, pipelineCode: string) => Promise<void>;
  onAddCandidate: (pipelineCode: string, stage: string) => void;
  onOpenBrief: (c: PipelineCandidate, pipelineCode: string) => void;
  compact?: boolean;
}) {
  const candidates = pipeline.candidates ?? [];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-3" style={{ minHeight: compact ? 180 : 320 }}>
        {PIPELINE_STAGES.map((stage) => {
          const stageCandidates = candidates.filter(
            (c) => normalizeStage(c.stage) === stage.key
          );
          const columnId = `col-${stage.key}`;

          return (
            <KanbanColumn
              key={stage.key}
              id={columnId}
              stage={stage}
              candidates={stageCandidates}
              pipelineCode={pipeline.code}
              onRemove={onRemove}
              onAddCandidate={onAddCandidate}
              onOpenBrief={onOpenBrief}
              compact={compact}
            />
          );
        })}
      </div>
      <DragOverlay>
        {dragging ? (
          <div className="rounded-xl border border-[var(--green)] bg-white p-3 shadow-xl opacity-90">
            <p className="text-xs font-600 text-[var(--black)]">{dragging.name}</p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ─── Kanban column ────────────────────────────────────────────────────────────

function KanbanColumn({
  id,
  stage,
  candidates,
  pipelineCode,
  onRemove,
  onAddCandidate,
  onOpenBrief,
  compact,
}: {
  id: string;
  stage: (typeof PIPELINE_STAGES)[number];
  candidates: PipelineCandidate[];
  pipelineCode: string;
  onRemove: (candidateCode: string, pipelineCode: string) => Promise<void>;
  onAddCandidate: (pipelineCode: string, stage: string) => void;
  onOpenBrief: (c: PipelineCandidate, pipelineCode: string) => void;
  compact?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: 'column', stage: stage.key },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex shrink-0 flex-col rounded-xl border transition-colors ${
        isOver
          ? 'border-[var(--green)] bg-[var(--green-soft)]'
          : 'border-[var(--border)] bg-[var(--bg)]'
      }`}
      style={{ width: compact ? 160 : 200, minHeight: compact ? 160 : 300 }}
    >
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-[11px] font-700 text-[var(--black)]">{stage.label}</span>
        <span className="rounded-full bg-white px-1.5 text-[10px] font-700 text-[var(--mid)]">
          {candidates.length}
        </span>
      </div>
      {'clientAction' in stage && stage.clientAction && (
        <p className="px-3 pb-1 text-[9px] font-600 uppercase tracking-wider text-[var(--green)]">
          Client action
        </p>
      )}

      <SortableContext
        items={candidates.map((c) => `cand-${c.candidateId}`)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
          {candidates.map((c) => (
            <CandidateCard
              key={c.candidateId}
              candidate={c}
              pipelineCode={pipelineCode}
              onRemove={onRemove}
              onOpenBrief={onOpenBrief}
              compact={compact}
            />
          ))}
          <button
            onClick={() => onAddCandidate(pipelineCode, stage.key)}
            className="mt-auto rounded-lg border border-dashed border-[var(--border)] py-2 text-center text-[10px] font-600 text-[var(--light)] transition-colors hover:border-[var(--green)] hover:text-[var(--green)]"
          >
            + Add
          </button>
        </div>
      </SortableContext>
    </div>
  );
}

// ─── Candidate card ───────────────────────────────────────────────────────────

function CandidateCard({
  candidate,
  pipelineCode,
  onRemove,
  onOpenBrief,
  compact,
}: {
  candidate: PipelineCandidate;
  pipelineCode: string;
  onRemove: (candidateCode: string, pipelineCode: string) => Promise<void>;
  onOpenBrief: (c: PipelineCandidate, pipelineCode: string) => void;
  compact?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `cand-${candidate.candidateId}`, data: { type: 'candidate' } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const score = candidate.score ?? 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onOpenBrief(candidate, pipelineCode)}
      className="cursor-pointer rounded-lg border border-[var(--border)] bg-white p-2.5 shadow-sm hover:border-[var(--green)] hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-600 text-[var(--black)] leading-tight truncate">
          {candidate.name}
        </p>
        {score > 0 && (
          <span
            className={`shrink-0 rounded-full px-1.5 text-[9px] font-800 ${
              score >= 80
                ? 'bg-green-100 text-green-700'
                : score >= 60
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-red-100 text-red-600'
            }`}
          >
            {score}
          </span>
        )}
      </div>
      {!compact && candidate.email && (
        <p className="mt-0.5 truncate text-[10px] text-[var(--light)]">
          {candidate.email}
        </p>
      )}
      {!compact && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(candidate.candidateId, pipelineCode);
          }}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded py-1 text-[9px] font-600 text-red-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-2.5 w-2.5" />
          Remove
        </button>
      )}
    </div>
  );
}
