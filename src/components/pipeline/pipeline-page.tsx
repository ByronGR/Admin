'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
  deleteDoc,
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
import { StaffPicker } from '@/components/ui/staff-picker';
import { useAuth } from '@/hooks/use-auth';
import { initials, snakeToTitle } from '@/lib/utils';
import type { Pipeline, PipelineCandidate, Candidate, CEFRLevel, DropOffReason } from '@/lib/types';
import { DROP_OFF_REASON_LABELS } from '@/lib/types';
import {
  Search,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  Trash2,
  Edit3,
  ClipboardList,
  X,
  Languages,
  LayoutGrid,
} from 'lucide-react';
import PipelineChatPanel from '@/components/pipeline/pipeline-chat';

// ─── Pipeline stages (8-stage) ────────────────────────────────────────────────

export const PIPELINE_STAGES = [
  { key: 'applied', label: 'Applied' },
  { key: 'background-check', label: 'Background Check' },
  { key: 'interview', label: 'Interview' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'partner-review', label: 'Partner Review', clientAction: true },
  { key: 'partner-interview', label: 'Partner Interview', clientAction: true },
  { key: 'hired', label: 'Hired', clientAction: true },
  { key: 'not-selected', label: 'Not Selected', terminal: true },
] as const;

type StageKey = (typeof PIPELINE_STAGES)[number]['key'];

function normalizeStage(stage: string): StageKey {
  const s = String(stage || '').trim().toLowerCase();
  // Map old stage names to new
  if (['profile-review', 'screening', 'shortlisted', 'new'].includes(s)) return 'applied';
  if (['background-checks', 'background'].includes(s)) return 'background-check';
  if (['client-interview', 'interview_1', 'interview_2'].includes(s)) return 'interview';
  if (['presented', 'client-review', 'company-review', 'final-review', 'offer'].includes(s)) return 'partner-review';
  if (['rejected', 'withdrawn'].includes(s)) return 'not-selected';
  if (PIPELINE_STAGES.some((st) => st.key === s)) return s as StageKey;
  return 'applied';
}

const CEFR_LEVELS: CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// Ordered progress stages (excludes the terminal "Not Selected"). Used to track
// the furthest stage a candidate has reached, so a drop to Not Selected still
// records how far they got.
const PROGRESS_STAGES: StageKey[] = [
  'applied',
  'background-check',
  'interview',
  'assessment',
  'partner-review',
  'partner-interview',
  'hired',
];
function stageRank(s: string): number {
  return PROGRESS_STAGES.indexOf(normalizeStage(s));
}

// Card display name: first name + last initial (e.g. "John D.") — keeps cards
// compact and avoids exposing full surnames on the board.
function formatCardName(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return name || 'Unknown';
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last.charAt(0).toUpperCase()}.`;
}

const DROP_OFF_REASONS: DropOffReason[] = [
  'mia',
  'english',
  'assessment',
  'interview',
  'partner',
  'candidate-withdrew',
  'other',
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  useAuth(); // ensure auth context
  const { showToast } = useToast();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  // candidateId → Nearwork Score, loaded from the assessments collection so the
  // board cards can surface each candidate's score at a glance (spec 4d).
  const [scoreMap, setScoreMap] = useState<Record<string, number>>({});
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

  // English score gate — shown when moving from interview → assessment
  const [engModal, setEngModal] = useState<{
    open: boolean;
    candidateId: string;
    pipelineId: string;
    pipelineCode: string;
    pendingStage: StageKey;
  }>({ open: false, candidateId: '', pipelineId: '', pipelineCode: '', pendingStage: 'assessment' });
  const [engLevel, setEngLevel] = useState<CEFRLevel>('B2');
  const [engFeedback, setEngFeedback] = useState('');
  const [engSaving, setEngSaving] = useState(false);

  // Drop-off reason — shown when moving a candidate to Not Selected
  const [dropModal, setDropModal] = useState<{
    open: boolean;
    candidateId: string;
    pipelineCode: string;
  }>({ open: false, candidateId: '', pipelineCode: '' });
  const [dropReason, setDropReason] = useState<DropOffReason>('mia');
  const [dropNote, setDropNote] = useState('');
  const [dropSaving, setDropSaving] = useState(false);

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

  // Load Nearwork Scores once for all candidates that have an assessment, keyed
  // by candidateId. We keep the highest score per candidate.
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'assessments'));
        const map: Record<string, number> = {};
        snap.docs.forEach((d) => {
          const a = d.data() as { candidateId?: string; nearworkScore?: number };
          if (a.candidateId && typeof a.nearworkScore === 'number') {
            if (map[a.candidateId] === undefined || a.nearworkScore > map[a.candidateId]) {
              map[a.candidateId] = a.nearworkScore;
            }
          }
        });
        setScoreMap(map);
      } catch (e) {
        console.error('Pipeline: failed to load assessment scores', e);
      }
    })();
  }, []);

  // Deep-link: /pipeline?focus=<code> opens that pipeline's workspace directly
  // (used by the "open pipeline" links on the candidate profile).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const focus = new URLSearchParams(window.location.search).get('focus');
    if (focus) setActivePipelineCode(focus);
  }, []);

  // Keep the URL in sync with the active pipeline so users can copy/share it.
  function openPipeline(code: string) {
    setActivePipelineCode(code);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('focus', code);
      history.pushState(null, '', url.toString());
    }
  }

  function closePipeline() {
    setActivePipelineCode(null);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('focus');
      history.pushState(null, '', url.toString());
    }
  }

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

  async function moveCandidateToStage(
    pipelineCode: string,
    candidateCode: string,
    toStage: StageKey,
    opts?: {
      englishScore?: { level: CEFRLevel; feedback: string };
      dropOff?: { reason: DropOffReason; note: string };
    }
  ) {
    const pipeline = pipelines.find((p) => p.code === pipelineCode);
    if (!pipeline) return;
    const newCandidates = (pipeline.candidates ?? []).map((c) => {
      if (c.candidateId !== candidateCode) return c;
      // Track the furthest (most advanced) stage reached. A drop to Not Selected
      // keeps the stage they were in before the drop.
      const consideredStage = toStage === 'not-selected' ? c.stage : toStage;
      const prevFurthest = c.furthestStage ?? c.stage;
      const furthestStage =
        stageRank(consideredStage) >= stageRank(prevFurthest)
          ? normalizeStage(consideredStage)
          : normalizeStage(prevFurthest);
      return {
        ...c,
        stage: toStage,
        furthestStage,
        ...(opts?.englishScore
          ? { englishScore: { ...opts.englishScore, assessedAt: new Date().toISOString() } }
          : {}),
        ...(opts?.dropOff
          ? { dropOffReason: opts.dropOff.reason, dropOffNote: opts.dropOff.note }
          : {}),
      };
    });
    await updateDoc(doc(db, 'pipelines', pipeline.id), {
      candidates: newCandidates,
      updatedAt: serverTimestamp(),
    });
    showToast(`Moved to ${PIPELINE_STAGES.find((s) => s.key === toStage)?.label}`, 'success');
  }

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

    // Moving a candidate to Not Selected → capture why they fell off first.
    if (toStage === 'not-selected') {
      const cand = pipeline.candidates![candIndex];
      setDropModal({ open: true, candidateId: candidateCode, pipelineCode });
      setDropReason(cand.dropOffReason ?? 'mia');
      setDropNote(cand.dropOffNote ?? '');
      return;
    }

    // English score gate: required when advancing from interview stage
    if (fromStage === 'interview' && toStage !== 'applied' && toStage !== 'background-check') {
      const cand = pipeline.candidates![candIndex];
      if (!cand.englishScore) {
        setEngModal({
          open: true,
          candidateId: candidateCode,
          pipelineId: pipeline.id,
          pipelineCode,
          pendingStage: toStage,
        });
        setEngLevel('B2');
        setEngFeedback('');
        return;
      }
    }

    // Optimistic update
    const updated = pipelines.map((p) => {
      if (p.code !== pipelineCode) return p;
      const cands = [...(p.candidates ?? [])];
      cands[candIndex] = { ...cands[candIndex], stage: toStage };
      return { ...p, candidates: cands };
    });
    setPipelines(updated);

    try {
      await moveCandidateToStage(pipelineCode, candidateCode, toStage);
    } catch {
      showToast('Failed to move candidate', 'error');
      setPipelines(pipelines);
    }
  }

  async function saveEnglishScore() {
    if (!engFeedback.trim()) {
      showToast('Please enter feedback before continuing', 'error');
      return;
    }
    setEngSaving(true);
    try {
      await moveCandidateToStage(engModal.pipelineCode, engModal.candidateId, engModal.pendingStage, {
        englishScore: { level: engLevel, feedback: engFeedback.trim() },
      });
      setEngModal({ open: false, candidateId: '', pipelineId: '', pipelineCode: '', pendingStage: 'assessment' });
    } catch {
      showToast('Failed to save English score', 'error');
    } finally {
      setEngSaving(false);
    }
  }

  async function saveDropOff() {
    setDropSaving(true);
    try {
      await moveCandidateToStage(dropModal.pipelineCode, dropModal.candidateId, 'not-selected', {
        dropOff: { reason: dropReason, note: dropNote.trim() },
      });
      setDropModal({ open: false, candidateId: '', pipelineCode: '' });
      setDropNote('');
    } catch {
      showToast('Failed to update candidate', 'error');
    } finally {
      setDropSaving(false);
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

  async function deletePipeline(pipelineId: string) {
    try {
      await deleteDoc(doc(db, 'pipelines', pipelineId));
      showToast('Pipeline deleted', 'success');
    } catch {
      showToast('Failed to delete pipeline', 'error');
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
              onClick={() => closePipeline()}
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
            scoreMap={scoreMap}
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
                scoreMap={scoreMap}
                expanded={expandedRows.has(p.code)}
                onToggle={() => toggleRow(p.code)}
                onOpen={() => openPipeline(p.code)}
                onUpdateStatus={updatePipelineStatus}
                onDelete={deletePipeline}
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
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Stage</p>
                <p className="mt-0.5 font-500 capitalize text-[var(--black)]">
                  {PIPELINE_STAGES.find((s) => s.key === normalizeStage(briefModal.candidate!.stage))?.label ?? briefModal.candidate.stage}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Furthest stage</p>
                <p className="mt-0.5 font-500 capitalize text-[var(--black)]">
                  {PIPELINE_STAGES.find(
                    (s) => s.key === normalizeStage(briefModal.candidate!.furthestStage ?? briefModal.candidate!.stage)
                  )?.label ?? '—'}
                </p>
              </div>
              {normalizeStage(briefModal.candidate.stage) === 'not-selected' && briefModal.candidate.dropOffReason && (
                <div className="col-span-2 rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-[10px] font-700 uppercase tracking-wider text-red-600">Not selected</p>
                  <p className="mt-0.5 text-sm font-600 text-[var(--black)]">
                    {DROP_OFF_REASON_LABELS[briefModal.candidate.dropOffReason]}
                  </p>
                  {briefModal.candidate.dropOffNote && (
                    <p className="mt-1 text-xs text-[var(--mid)]">{briefModal.candidate.dropOffNote}</p>
                  )}
                </div>
              )}
              {briefModal.candidate.email && (
                <div className="col-span-2">
                  <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Email</p>
                  <p className="mt-0.5 text-[var(--black)]">{briefModal.candidate.email}</p>
                </div>
              )}
              {briefModal.candidate.englishScore && (
                <div className="col-span-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Languages className="h-3.5 w-3.5 text-[var(--green)]" />
                    <p className="text-[10px] font-700 uppercase tracking-wider text-[var(--green)]">English Score</p>
                  </div>
                  <p className="text-sm font-700 text-[var(--black)]">{briefModal.candidate.englishScore.level}</p>
                  <p className="mt-0.5 text-xs text-[var(--mid)]">{briefModal.candidate.englishScore.feedback}</p>
                </div>
              )}
              {briefModal.candidate.notes && (
                <div className="col-span-2">
                  <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Notes</p>
                  <p className="mt-0.5 text-[var(--mid)]">{briefModal.candidate.notes}</p>
                </div>
              )}
            </div>
            <div className="flex gap-2 border-t border-[var(--border)] pt-3">
              <button
                onClick={() => setBriefModal({ open: false, candidate: null, pipelineCode: '' })}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                WhatsApp
              </button>
              <button
                onClick={() => {
                  if (briefModal.candidate) {
                    removeCandidateFromPipeline(briefModal.candidate.candidateId, briefModal.pipelineCode);
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

      {/* English score gate modal */}
      <Modal
        open={engModal.open}
        onClose={() => setEngModal({ open: false, candidateId: '', pipelineId: '', pipelineCode: '', pendingStage: 'assessment' })}
        title="English score required"
        size="md"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-600 text-amber-800">
              A CEFR English level and feedback must be recorded before advancing this candidate past the Interview stage.
            </p>
          </div>
          <div>
            <label className="mb-2 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">CEFR Level *</label>
            <div className="flex gap-2 flex-wrap">
              {CEFR_LEVELS.map((level) => (
                <button
                  key={level}
                  onClick={() => setEngLevel(level)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-700 transition-colors ${
                    engLevel === level
                      ? 'text-white'
                      : 'border border-[var(--border)] text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]'
                  }`}
                  style={engLevel === level ? { background: 'var(--green)' } : {}}
                >
                  {level}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-[var(--light)]">A1–A2 basic · B1–B2 intermediate · C1–C2 proficient</p>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Feedback *</label>
            <textarea
              value={engFeedback}
              onChange={(e) => setEngFeedback(e.target.value)}
              rows={3}
              placeholder="Describe the candidate's English proficiency: fluency, accent, comprehension, professional communication…"
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEngModal({ open: false, candidateId: '', pipelineId: '', pipelineCode: '', pendingStage: 'assessment' })}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]"
            >
              Cancel
            </button>
            <button
              onClick={saveEnglishScore}
              disabled={engSaving || !engFeedback.trim()}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
              style={{ background: 'var(--green)' }}
            >
              {engSaving && <Spinner size="sm" />}
              Save & advance
            </button>
          </div>
        </div>
      </Modal>

      {/* Drop-off reason modal — captured when moving to Not Selected */}
      <Modal
        open={dropModal.open}
        onClose={() => setDropModal({ open: false, candidateId: '', pipelineCode: '' })}
        title="Why is this candidate not selected?"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-xs text-[var(--light)]">
            Record where the candidate fell off so it shows on their profile and in reports.
          </p>
          <div>
            <label className="mb-2 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
              Reason *
            </label>
            <div className="flex flex-wrap gap-2">
              {DROP_OFF_REASONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setDropReason(r)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-600 transition-colors ${
                    dropReason === r
                      ? 'text-white'
                      : 'border border-[var(--border)] text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]'
                  }`}
                  style={dropReason === r ? { background: 'var(--green)' } : {}}
                >
                  {DROP_OFF_REASON_LABELS[r]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
              Notes (optional)
            </label>
            <textarea
              value={dropNote}
              onChange={(e) => setDropNote(e.target.value)}
              rows={3}
              placeholder="e.g. Called the candidate for 2 days with no response, no-showed the interview…"
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDropModal({ open: false, candidateId: '', pipelineCode: '' })}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]"
            >
              Cancel
            </button>
            <button
              onClick={saveDropOff}
              disabled={dropSaving}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
              style={{ background: 'var(--green)' }}
            >
              {dropSaving && <Spinner size="sm" />}
              Mark not selected
            </button>
          </div>
        </div>
      </Modal>
    </MainLayout>
  );
}

// ─── Pipeline row (collapsed list view) ──────────────────────────────────────

function PipelineRow({
  pipeline,
  scoreMap,
  expanded,
  onToggle,
  onOpen,
  onUpdateStatus,
  onDelete,
  onDragEnd,
  onDragStart,
  dragging,
  sensors,
  onRemove,
  onAddCandidate,
  onOpenBrief,
}: {
  pipeline: Pipeline;
  scoreMap: Record<string, number>;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onUpdateStatus: (id: string, status: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDragEnd: (e: DragEndEvent) => void;
  onDragStart: (e: DragStartEvent) => void;
  dragging: PipelineCandidate | null;
  sensors: ReturnType<typeof useSensors>;
  onRemove: (candidateCode: string, pipelineCode: string) => Promise<void>;
  onAddCandidate: (pipelineCode: string, stage: string) => void;
  onOpenBrief: (c: PipelineCandidate, pipelineCode: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    await onDelete(pipeline.id);
    setDeleting(false);
    setConfirmDelete(false);
  }

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
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-600 font-500">Delete pipeline?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs font-700 text-red-600 hover:underline disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Yes'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs text-[var(--mid)] hover:underline"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-500 text-red-500 hover:border-red-400 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
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
            scoreMap={scoreMap}
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
  scoreMap,
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
  scoreMap: Record<string, number>;
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
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'kanban' | 'chat'>('kanban');
  const [showEdit, setShowEdit] = useState(false);

  // The deal (spec 4g): how many candidates have been hired/placed in this
  // pipeline, alongside the partner (organization) name.
  const hiredCount = (pipeline.candidates ?? []).filter(
    (c) => normalizeStage(c.stage) === 'hired'
  ).length;
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
              Partner
            </p>
            <p className="mt-0.5 font-600 text-[var(--black)]">{pipeline.orgName ?? '—'}</p>
          </div>
          <div>
            <p className="font-600 uppercase tracking-wider text-[var(--light)]" style={{ fontSize: 10 }}>
              Recruiter
            </p>
            <p className="mt-0.5 font-600 text-[var(--black)]">{pipeline.recruiter || '—'}</p>
          </div>
          <div>
            <p className="font-600 uppercase tracking-wider text-[var(--light)]" style={{ fontSize: 10 }}>
              Account Manager
            </p>
            <p className="mt-0.5 font-600 text-[var(--black)]">{pipeline.accountManager || '—'}</p>
          </div>
          <div>
            <p className="font-600 uppercase tracking-wider text-[var(--light)]" style={{ fontSize: 10 }}>
              Candidates
            </p>
            <p className="mt-0.5 font-600 text-[var(--black)]">{pipeline.candidates?.length ?? 0}</p>
          </div>
          <div>
            <p className="font-600 uppercase tracking-wider text-[var(--light)]" style={{ fontSize: 10 }}>
              Placements
            </p>
            <p className="mt-0.5 font-600 text-[var(--black)]">
              {hiredCount > 0 ? `${hiredCount} hired` : '—'}
            </p>
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
              onClick={() => router.push(`/openings/${pipeline.code}`)}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              View opening
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
              <StaffPicker
                compact
                value={editRecruiter}
                onChange={setEditRecruiter}
                placeholder="Search team for recruiter"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                Account manager
              </label>
              <StaffPicker
                compact
                value={editManager}
                onChange={setEditManager}
                placeholder="Search team for account manager"
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

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-1" style={{ width: 'fit-content' }}>
        <button
          onClick={() => setActiveTab('kanban')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-600 transition-colors ${
            activeTab === 'kanban'
              ? 'bg-white text-[var(--black)] shadow-sm'
              : 'text-[var(--light)] hover:text-[var(--mid)]'
          }`}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Kanban
        </button>
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-600 transition-colors ${
            activeTab === 'chat'
              ? 'bg-white text-[var(--black)] shadow-sm'
              : 'text-[var(--light)] hover:text-[var(--mid)]'
          }`}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          Chat
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'kanban' ? (
        <KanbanBoard
          pipeline={pipeline}
          scoreMap={scoreMap}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
          dragging={dragging}
          sensors={sensors}
          onRemove={onRemove}
          onAddCandidate={onAddCandidate}
          onOpenBrief={onOpenBrief}
        />
      ) : (
        <PipelineChatPanel pipeline={pipeline} />
      )}
    </div>
  );
}

// ─── Kanban board ─────────────────────────────────────────────────────────────

function KanbanBoard({
  pipeline,
  scoreMap,
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
  scoreMap: Record<string, number>;
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
              scoreMap={scoreMap}
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
  scoreMap,
  onRemove,
  onAddCandidate,
  onOpenBrief,
  compact,
}: {
  id: string;
  stage: (typeof PIPELINE_STAGES)[number];
  candidates: PipelineCandidate[];
  pipelineCode: string;
  scoreMap: Record<string, number>;
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
              nearworkScore={scoreMap[c.candidateId]}
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
  nearworkScore,
  onRemove,
  onOpenBrief,
  compact,
}: {
  candidate: PipelineCandidate;
  pipelineCode: string;
  nearworkScore?: number;
  onRemove: (candidateCode: string, pipelineCode: string) => Promise<void>;
  onOpenBrief: (c: PipelineCandidate, pipelineCode: string) => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `cand-${candidate.candidateId}`, data: { type: 'candidate' } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const score = nearworkScore ?? candidate.score ?? 0;
  const engLevel = candidate.englishScore?.level;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => router.push(`/candidates/${candidate.candidateId}`)}
      className="cursor-pointer rounded-lg border border-[var(--border)] bg-white p-2.5 shadow-sm hover:border-[var(--green)] hover:shadow-md transition-all"
      title="Open candidate profile"
    >
      {/* Top: Nearwork Score */}
      <div className="flex items-center justify-between gap-2">
        {score > 0 ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-800 ${
              score >= 80
                ? 'bg-green-100 text-green-700'
                : score >= 60
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-red-100 text-red-600'
            }`}
            title={`Nearwork Score: ${score}`}
          >
            NW {score}
          </span>
        ) : (
          <span className="rounded-full bg-[var(--bg)] px-1.5 py-0.5 text-[9px] font-700 text-[var(--light)]" title="No assessment yet">
            No score
          </span>
        )}
        {engLevel && (
          <span
            className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-700 text-blue-700"
            title={`English: ${engLevel}`}
          >
            {engLevel}
          </span>
        )}
      </div>

      {/* Name: first name + last initial */}
      <p className="mt-1.5 truncate text-xs font-600 leading-tight text-[var(--black)]">
        {formatCardName(candidate.name)}
      </p>

      {!compact && (
        <div className="mt-2 flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenBrief(candidate, pipelineCode);
            }}
            className="flex flex-1 items-center justify-center gap-1 rounded py-1 text-[9px] font-600 text-[var(--mid)] hover:bg-[var(--bg)] hover:text-[var(--green)]"
          >
            <ClipboardList className="h-2.5 w-2.5" />
            Brief
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(candidate.candidateId, pipelineCode);
            }}
            className="flex flex-1 items-center justify-center gap-1 rounded py-1 text-[9px] font-600 text-red-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-2.5 w-2.5" />
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
