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
  auth,
  db,
  collection,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  addDoc,
  onSnapshot,
  arrayUnion,
} from '@/lib/firebase';
import { notifyStageEmail } from '@/lib/notify-stage-email';
import { MainLayout } from '@/components/layout/main-layout';
import { NW, MONO, Button as NWButton } from '@/components/nw/primitives';
import { PageHeader } from '@/components/nw/shell-ui';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { StaffPicker } from '@/components/ui/staff-picker';
import { HoldToDelete } from '@/components/ui/hold-to-delete';
import { useAuth } from '@/hooks/use-auth';
import { initials, snakeToTitle, fmtCurrency, fmtDate } from '@/lib/utils';
import type { Pipeline, PipelineCandidate, Candidate, CEFRLevel, DropOffReason, Timestamp } from '@/lib/types';
import { stagesFor, isSourcing, normalizeSourcingStage, stageLabel, type StageDef } from '@/lib/pipeline-stages';
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
  UserCheck,
  XCircle,
  ExternalLink,
  FileText,
  Inbox,
  Users,
  Move,
} from 'lucide-react';

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

// Stage colours for the redesign stage-spread bar / dots.
const STAGE_SPREAD_COLOR: Record<StageKey, string> = {
  'applied': NW.gray400,
  'background-check': NW.blue500,
  'interview': '#6366F1',
  'assessment': NW.violet500,
  'partner-review': NW.yellow500,
  'partner-interview': NW.teal500,
  'hired': NW.green600,
  'not-selected': NW.gray300,
};

// Colours for the sourcing stage set (keys that aren't in the full model above).
const SOURCING_STAGE_COLOR: Record<string, string> = {
  'sourced': NW.gray400,
  'screening': '#6366F1',
  'submitted': NW.blue500,
  'in-progress': NW.violet500,
  'hired': NW.green600,
  'not-selected': NW.gray300,
};

// Colour for any stage key across both models, with a safe fallback.
function stageColor(key: string): string {
  return (STAGE_SPREAD_COLOR as Record<string, string>)[key] ?? SOURCING_STAGE_COLOR[key] ?? NW.gray400;
}

// Normalize a stage the right way for the pipeline's type.
function normFor(pt: string | undefined, stage: string): string {
  return isSourcing(pt) ? normalizeSourcingStage(stage) : normalizeStage(stage);
}

// ─── Client-facing stage labels ───────────────────────────────────────────────
// The board runs 8 internal stages; clients following a role see a simplified
// 6-stage view. No shared map existed in the repo, so this collapses the internal
// keys to the client-facing label used in follower broadcasts. (Flagged in the
// change notes — if a canonical client-stage map appears later, swap this out.)
const CLIENT_STAGE_LABEL: Record<StageKey, string> = {
  'applied': 'Applied',
  'background-check': 'Screening',
  'interview': 'Technical',
  'assessment': 'Technical',
  'partner-review': 'Final round',
  'partner-interview': 'Final round',
  'hired': 'Offer',
  'not-selected': 'Not selected',
};

// Fire a follower broadcast to /api/notify (best-effort — never blocks the move).
async function broadcastNotify(payload: Record<string, unknown>): Promise<void> {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch {
    /* never block the stage change */
  }
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
  // Set of candidateId strings that still exist in the `candidates` collection.
  // Used to filter out "ghost" pipeline entries after Firebase deletes. null means
  // not yet loaded (show all while loading so there's no flash of missing content).
  const [activeCandidateIds, setActiveCandidateIds] = useState<Set<string> | null>(null);
  // candidateId → Nearwork Score, loaded from the assessments collection so the
  // board cards can surface each candidate's score at a glance (spec 4d).
  const [scoreMap, setScoreMap] = useState<Record<string, number>>({});
  // `${candidateId}__${pipelineCode}` for candidates who have a completed
  // assessment — used to gate advancing past the assessment stage.
  const [assessedSet, setAssessedSet] = useState<Set<string>>(new Set());
  // Pending-applicant count per pipeline (openingCode → count), so each list row
  // can show total candidates INCLUDING applicants not yet pulled into a stage.
  const [applicantCounts, setApplicantCounts] = useState<Record<string, number>>({});
  // org id/shortId → name, so rows can show the client org even when the
  // pipeline doc only stored orgId (not a denormalized orgName).
  const [orgNames, setOrgNames] = useState<Record<string, string>>({});
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

  // Build a set of valid candidateIds so the board can hide entries whose
  // backing candidate doc was deleted from the candidates collection.
  useEffect(() => {
    getDocs(collection(db, 'candidates'))
      .then((snap) => {
        setActiveCandidateIds(new Set(snap.docs.map((d) => d.id)));
      })
      .catch(() => {
        // Non-critical — if this fails, show all candidates (fail open).
        setActiveCandidateIds(null);
      });
  }, []);

  // Load Nearwork Scores once for all candidates that have an assessment, keyed
  // by candidateId. We keep the highest score per candidate.
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'assessments'));
        const map: Record<string, number> = {};
        const set = new Set<string>();
        snap.docs.forEach((d) => {
          const a = d.data() as { candidateId?: string; pipelineCode?: string; nearworkScore?: number; overallScore?: number; status?: string };
          if (a.candidateId && typeof a.nearworkScore === 'number') {
            if (map[a.candidateId] === undefined || a.nearworkScore > map[a.candidateId]) {
              map[a.candidateId] = a.nearworkScore;
            }
          }
          if (a.candidateId && a.pipelineCode && (typeof a.overallScore === 'number' || a.status === 'completed')) {
            set.add(`${a.candidateId}__${a.pipelineCode}`);
          }
        });
        setScoreMap(map);
        setAssessedSet(set);
      } catch (e) {
        console.error('Pipeline: failed to load assessment scores', e);
      }
    })();
  }, []);

  // Count pending applicants (applications not yet approved/rejected) per opening
  // so each pipeline row can show "candidates incl. applicants". Live so the
  // number drops as applicants get approved into the pipeline.
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'applications'), (snap) => {
      const counts: Record<string, number> = {};
      snap.docs.forEach((d) => {
        const a = d.data() as { openingCode?: string; status?: string; inPipeline?: boolean };
        const pending = !a.inPipeline && (!a.status || a.status === 'applied' || a.status === 'pending');
        if (pending && a.openingCode) counts[a.openingCode] = (counts[a.openingCode] ?? 0) + 1;
      });
      setApplicantCounts(counts);
    }, () => { /* non-critical */ });
    return unsub;
  }, []);

  // Resolve org names so rows can show the client org from the pipeline's orgId.
  useEffect(() => {
    getDocs(collection(db, 'organizations'))
      .then((snap) => {
        const map: Record<string, string> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as { name?: string; shortId?: string };
          if (data.name) {
            map[d.id] = data.name;
            if (data.shortId) map[data.shortId] = data.name;
          }
        });
        setOrgNames(map);
      })
      .catch(() => { /* non-critical */ });
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
  const filtered = pipelines
    .filter((p) => {
      const matchSearch =
        !search ||
        [p.title, p.orgName, p.code, p.recruiter]
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase());
      const matchStatus =
        statusFilter === 'all' || p.status === statusFilter;
      return matchSearch && matchStatus;
    })
    .map((p) => {
      // Remove "ghost" pipeline entries whose backing candidate doc was deleted
      // from the `candidates` collection. While activeCandidateIds is loading
      // (null), pass the full array so there's no flash of empty columns.
      if (!activeCandidateIds) return p;
      return {
        ...p,
        candidates: (p.candidates ?? []).filter(
          // Only keep candidates whose ID exists in the candidates collection.
          // All pipeline candidates are approved — pendingReview entries are gone.
          (c) => activeCandidateIds.has(c.candidateId)
        ),
      };
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
    const movedEntry = (pipeline.candidates ?? []).find((c) => c.candidateId === candidateCode);
    const fromStage = movedEntry?.stage;
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
    // Mirror stage to the candidate doc so the Candidates list can show pipeline progress
    updateDoc(doc(db, 'candidates', candidateCode), {
      activePipelineCode: pipelineCode,
      activePipelineStage: toStage,
      updatedAt: serverTimestamp(),
    }).catch(() => null);
    // Debounced stage email (fire-and-forget; kill-switched server-side)
    notifyStageEmail({
      action: 'stage-moved',
      pipelineCode,
      candidateId: candidateCode,
      fromStage,
      toStage,
      candidateName: movedEntry?.name,
      candidateEmail: movedEntry?.email,
      roleTitle: pipeline.title,
      orgName: pipeline.orgName,
      dropOffReason: opts?.dropOff?.reason,
      pipelineType: pipeline.pipelineType,
    });
    // Broadcast to the role's followers (client users). Only on a FORWARD move —
    // skip backward moves and the drop to Not Selected (that's candidate_declined,
    // not fired here). Best-effort; never blocks the move.
    if (toStage !== 'not-selected' && stageRank(toStage) > stageRank(fromStage ?? '')) {
      broadcastNotify({
        event: 'broadcast',
        broadcastType: 'stage_move',
        entityType: 'opening',
        entityId: pipeline.code,
        orgId: pipeline.orgId,
        candidateName: movedEntry?.name,
        candidateCode: movedEntry?.candidateCode ?? candidateCode,
        stage: CLIENT_STAGE_LABEL[toStage] ?? stageLabel(pipeline.pipelineType, toStage),
      });
    } else if (toStage === 'not-selected') {
      // A decline notifies followers too — no stage on the payload.
      broadcastNotify({
        event: 'broadcast',
        broadcastType: 'candidate_declined',
        entityType: 'opening',
        entityId: pipeline.code,
        orgId: pipeline.orgId,
        candidateName: movedEntry?.name,
        candidateCode: movedEntry?.candidateCode ?? candidateCode,
      });
    }
    showToast(`Moved to ${stageLabel(pipeline.pipelineType, toStage)}`, 'success');
  }

  async function handleDragEnd(event: DragEndEvent, pipelineCode: string) {
    const { active, over } = event;
    setDragging(null);
    if (!over || active.id === over.id) return;

    const toStage = String(over.id).replace('col-', '') as StageKey;
    const candidateCode = String(active.id).replace('cand-', '');

    const pipeline = pipelines.find((p) => p.code === pipelineCode);
    if (!pipeline) return;

    // A paused/cancelled pipeline is frozen — no moves, no emails.
    if (pipeline.status === 'paused' || pipeline.status === 'cancelled') {
      showToast(`This pipeline is ${pipeline.status} — contact an Account Manager to move candidates.`, 'error');
      return;
    }

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

    // Full-recruitment gates only. Sourcing has no Nearwork assessment/interview,
    // so these don't apply (and 'hired' is a valid sourcing target).
    if (!isSourcing(pipeline.pipelineType)) {
      // Assessment gate: a completed assessment is required to reach Partner Review
      // and any stage beyond it (rejection is always allowed).
      const ASSESS_REQUIRED: StageKey[] = ['partner-review', 'partner-interview', 'hired'];
      if (ASSESS_REQUIRED.includes(toStage)) {
        const cand = pipeline.candidates![candIndex];
        if (!assessedSet.has(`${cand.candidateId}__${pipelineCode}`)) {
          const label = PIPELINE_STAGES.find((s) => s.key === toStage)?.label ?? toStage;
          showToast(`An assessment is required before moving to ${label}. Upload the assessment on the candidate's profile first.`, 'error');
          return;
        }
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

  // (approve is now handled inside ApplicantsPanel directly)

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
      // A removed candidate must not receive a pending stage email.
      notifyStageEmail({ action: 'cancel', pipelineCode, candidateId: candidateCode });
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
      // Sourcing openings drop new candidates into 'sourced', not 'applied'.
      stage: normFor(pipeline.pipelineType, addModal.stage) as PipelineCandidate['stage'],
    };

    try {
      await updateDoc(doc(db, 'pipelines', pipeline.id), {
        candidates: [...(pipeline.candidates ?? []), newEntry],
        updatedAt: serverTimestamp(),
      });
      // Adding a candidate straight into a stage emails them too (debounced).
      notifyStageEmail({
        action: 'stage-moved',
        pipelineCode: pipeline.code,
        candidateId: candidate.id,
        fromStage: '',
        toStage: normFor(pipeline.pipelineType, addModal.stage),
        candidateName: candidate.name,
        candidateEmail: candidate.email,
        roleTitle: pipeline.title,
        orgName: pipeline.orgName,
        pipelineType: pipeline.pipelineType,
      });
      // Notify the role's followers that a new candidate was added (best-effort).
      try {
        broadcastNotify({
          event: 'broadcast',
          broadcastType: 'new_candidate',
          entityType: 'opening',
          entityId: pipeline.code,
          candidateName: candidate.name,
          candidateCode: candidate.id,
        });
      } catch {
        /* never block the add */
      }
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
        {activePipeline ? (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div>
                <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">Pipeline</h1>
                <p className="mt-0.5 text-xs text-[var(--light)]">Viewing {activePipeline.code}</p>
              </div>
              {activePipeline.status && activePipeline.status !== 'active' && (
                <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'capitalize', color: activePipeline.status === 'cancelled' ? NW.rose600 : '#A16207', background: activePipeline.status === 'cancelled' ? NW.rose50 : NW.yellow50, border: `1px solid ${activePipeline.status === 'cancelled' ? NW.rose600 : '#A16207'}22`, borderRadius: 999, padding: '3px 10px' }}>
                  {activePipeline.status}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {activePipeline.status !== 'cancelled' && (
                <button
                  onClick={() => updatePipelineStatus(activePipeline.id, activePipeline.status === 'paused' ? 'active' : 'paused')}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
                >
                  {activePipeline.status === 'paused' ? 'Resume pipeline' : 'Pause pipeline'}
                </button>
              )}
              <button
                onClick={() => updatePipelineStatus(activePipeline.id, activePipeline.status === 'cancelled' ? 'active' : 'cancelled')}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-500"
                style={{ borderColor: `${NW.rose500}55`, color: NW.rose600 }}
              >
                {activePipeline.status === 'cancelled' ? 'Reopen pipeline' : 'Cancel pipeline'}
              </button>
              <button
                onClick={() => closePipeline()}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
              >
                <X className="h-3.5 w-3.5" />
                Back to list
              </button>
            </div>
          </div>
        ) : (
          <PageHeader
            overline="Pipeline"
            title="Pipelines"
            subtitle="Each opening runs its own pipeline — open one to manage candidates by stage."
          />
        )}

        {/* Toolbar — Active / All toggle + count */}
        {!activePipeline && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {([['active', 'Active'], ['all', 'All']] as const).map(([k, label]) => {
                const on = statusFilter === k || (k === 'active' && statusFilter === 'active') || (k === 'all' && statusFilter === 'all');
                return (
                  <button
                    key={k}
                    onClick={() => setStatusFilter(k)}
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: on ? NW.white : NW.gray600,
                      background: on ? NW.black : NW.white,
                      border: `1px solid ${on ? NW.black : NW.gray200}`,
                      borderRadius: 9,
                      padding: '7px 14px',
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
              <div style={{ position: 'relative', minWidth: 200, marginLeft: 6 }}>
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--light)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search pipeline, org, recruiter…"
                  className="w-full rounded-lg border border-[var(--border)] bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-[var(--green)]"
                />
              </div>
            </div>
            <span style={{ fontSize: 12.5, color: NW.gray500 }}>
              {filtered.length} pipeline{filtered.length !== 1 ? 's' : ''} · {filtered.reduce((s, p) => s + (p.candidates?.length ?? 0), 0)} candidates total
            </span>
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
                applicantCount={applicantCounts[p.code] ?? 0}
                orgLabel={p.orgName || orgNames[p.orgId] || ''}
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
  applicantCount = 0,
  orgLabel = '',
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
  applicantCount?: number;
  orgLabel?: string;
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
  const [deleting, setDeleting] = useState(false);
  const [spreadOpen, setSpreadOpen] = useState(false);
  const [rowHover, setRowHover] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    await onDelete(pipeline.id);
    setDeleting(false);
  }

  const cands = pipeline.candidates ?? [];
  const pendingApplicants = cands.filter((c) => c.pendingReview).length;
  const rowStages = stagesFor(pipeline.pipelineType);
  const spread = rowStages.map((st) => ({ st, n: cands.filter((c) => normFor(pipeline.pipelineType, c.stage) === st.key).length }));
  const atOffer = spread.find((x) => x.st.key === 'hired')?.n ?? 0;
  const sourced = spread.find((x) => x.st.key === rowStages[0].key)?.n ?? 0;
  const totalWithApplicants = cands.length + applicantCount;

  const statusColor =
    pipeline.status === 'active'
      ? 'b-green'
      : pipeline.status === 'cancelled'
        ? 'b-red'
        : 'b-amber';

  return (
    <div
      className={`rounded-2xl border transition-all ${
        pipeline.status === 'cancelled'
          ? 'border-red-100 bg-red-50/30'
          : 'border-[var(--border)] bg-white'
      }`}
    >
      <div
        onClick={onOpen}
        onMouseEnter={() => setRowHover(true)}
        onMouseLeave={() => setRowHover(false)}
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2.4fr) 96px minmax(0, 1.7fr) 96px 150px 88px',
          alignItems: 'center',
          gap: 16,
          padding: '14px 20px',
          cursor: 'pointer',
          background: rowHover ? NW.gray50 : 'transparent',
          transition: 'background 120ms',
          borderRadius: expanded ? '16px 16px 0 0' : 16,
        }}
      >
        {/* Pipeline title + code + org */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: NW.black, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pipeline.title || 'Untitled pipeline'}</span>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: NW.gray400, background: NW.gray50, borderRadius: 5, padding: '1px 6px', flexShrink: 0 }}>{pipeline.code}</span>
          </div>
          <div style={{ fontSize: 12, color: NW.gray500, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {[orgLabel, pipeline.recruiter].filter(Boolean).join(' · ') || 'No organization linked'}
          </div>
        </div>

        {/* Cands (in-pipeline only) */}
        <div style={{ whiteSpace: 'nowrap' }}>
          <span style={{ fontFamily: MONO, fontSize: 16, fontWeight: 500, color: NW.black }}>{cands.length}</span>
          <span style={{ fontSize: 11, color: NW.gray400, marginLeft: 4 }}>cands</span>
          {pendingApplicants > 0 && <div style={{ fontSize: 11, color: '#A16207', fontWeight: 600, marginTop: 2 }}>{pendingApplicants} to review</div>}
        </div>

        {/* Stage spread bar + breakdown popover */}
        <div
          style={{ position: 'relative', minWidth: 0 }}
          onMouseEnter={() => setSpreadOpen(true)}
          onMouseLeave={() => setSpreadOpen(false)}
        >
          <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', background: NW.gray100 }}>
            {spread.map(({ st, n }) => (n ? <div key={st.key} style={{ flex: n, background: stageColor(st.key) }} /> : null))}
          </div>
          <div style={{ fontSize: 10.5, color: NW.gray400, marginTop: 5 }}>{atOffer} hired · {sourced} applied</div>
          {spreadOpen && (
            <div style={{ position: 'absolute', top: 'calc(100% + 10px)', left: 0, zIndex: 80, background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 11, boxShadow: '0 12px 32px rgba(0,0,0,0.16)', padding: '11px 13px', minWidth: 200, pointerEvents: 'none' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: NW.gray400, marginBottom: 9 }}>Stage breakdown</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {spread.map(({ st, n }) => (
                  <div key={st.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: stageColor(st.key), flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: n ? NW.gray700 : NW.gray400, flex: 1 }}>{st.label}</span>
                    <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, color: n ? NW.black : NW.gray300 }}>{n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Status */}
        <div><Badge label={pipeline.status} variant="status" /></div>

        {/* Total candidates incl. applicants — between status and delete */}
        <div
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, background: NW.teal50, border: `1px solid ${NW.teal500}33`, whiteSpace: 'nowrap', justifySelf: 'start' }}
          title={`${cands.length} in pipeline + ${applicantCount} applicant${applicantCount === 1 ? '' : 's'} = ${totalWithApplicants} total`}
        >
          <Users className="h-3.5 w-3.5" style={{ color: NW.teal600 }} />
          <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: NW.teal700 }}>{totalWithApplicants}</span>
          {applicantCount > 0 && <span style={{ fontSize: 11, color: NW.teal600 }}>· {applicantCount} new</span>}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifySelf: 'end' }} onClick={(e) => e.stopPropagation()}>
          <HoldToDelete onConfirm={handleDelete} busy={deleting} size="sm" label="Hold to delete" hideIcon={false} title="Delete pipeline" />
          <button onClick={onToggle} title={expanded ? 'Collapse board' : 'Expand board'} className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[var(--light)] hover:border-[var(--green)] hover:text-[var(--green)]">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
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
  const [activeTab, setActiveTab] = useState<'applicants' | 'kanban'>('applicants');
  const [showEdit, setShowEdit] = useState(false);

  // Live count of pending applications (not yet approved/rejected) for badge
  const [applicantCount, setApplicantCount] = useState(0);
  useEffect(() => {
    const q = query(collection(db, 'applications'), where('openingCode', '==', pipeline.code));
    const unsub = onSnapshot(q, (snap) => {
      const pending = snap.docs.filter((d) => {
        const s = d.data().status as string | undefined;
        return !s || s === 'applied' || s === 'pending';
      }).length;
      setApplicantCount(pending);
    });
    return () => unsub();
  }, [pipeline.code]);

  // The deal (spec 4g): how many candidates have been hired/placed in this
  // pipeline, alongside the partner (organization) name.
  const wsCands = pipeline.candidates ?? [];
  const hiredCount = wsCands.filter((c) => normalizeStage(c.stage) === 'hired').length;
  const avgScore = wsCands.length
    ? Math.round(wsCands.reduce((s, c) => s + (scoreMap[c.candidateId] ?? c.score ?? 0), 0) / wsCands.length)
    : 0;
  const tileInitials = (pipeline.orgName || pipeline.title || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
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
      {/* Branded header + stat strip */}
      <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <span style={{ width: 46, height: 46, borderRadius: 12, background: NW.teal500, color: NW.white, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18, flexShrink: 0 }}>{tileInitials}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em', color: NW.black, margin: 0 }}>{pipeline.title || 'Untitled pipeline'}</h2>
                <span style={{ fontFamily: MONO, fontSize: 11, color: NW.gray500, background: NW.gray50, borderRadius: 6, padding: '2px 8px' }}>{pipeline.code}</span>
                <Badge label={pipeline.status} variant="status" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 5, fontSize: 12.5, color: NW.gray600, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: NW.black }}>{pipeline.orgName || 'No organization'}</span>
                <span style={{ color: NW.gray300 }}>·</span>
                <span>Recruiter: {pipeline.recruiter || '—'}</span>
                <span style={{ color: NW.gray300 }}>·</span>
                <span>AM: {pipeline.accountManager || '—'}</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setShowEdit((v) => !v)} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]">
              <Edit3 className="h-3.5 w-3.5" /> Edit pipeline
            </button>
            <button onClick={() => router.push(`/openings/${pipeline.code}`)} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]">
              <LayoutGrid className="h-3.5 w-3.5" /> View opening
            </button>
            <button onClick={() => window.open(`/kickoff?code=${pipeline.code}`, '_blank')} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]">
              <ClipboardList className="h-3.5 w-3.5" /> Kick-off Brief
            </button>
          </div>
        </div>

        {/* Stat strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 30, marginTop: 18, paddingTop: 16, borderTop: `1px solid ${NW.gray100}`, flexWrap: 'wrap' }}>
          {[
            { l: 'In pipeline', v: wsCands.length, sub: 'candidates' },
            { l: 'Avg. score', v: avgScore || '—', sub: 'pipeline quality' },
            { l: 'Applicants', v: applicantCount, sub: 'to review' },
            { l: 'Placements', v: hiredCount, sub: 'hired' },
          ].map((s) => (
            <div key={s.l}>
              <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 500, color: NW.black, lineHeight: 1 }}>{s.v}</div>
              <div style={{ fontSize: 11, color: NW.gray500, marginTop: 4 }}>{s.l} · <span style={{ color: NW.gray400 }}>{s.sub}</span></div>
            </div>
          ))}
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
          onClick={() => setActiveTab('applicants')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-600 transition-colors ${
            activeTab === 'applicants'
              ? 'bg-white text-[var(--black)] shadow-sm'
              : 'text-[var(--light)] hover:text-[var(--mid)]'
          }`}
        >
          <Inbox className="h-3.5 w-3.5" />
          Applicants
          {applicantCount > 0 && (
            <span
              className="ml-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-800 text-white"
              style={{ background: 'var(--green)' }}
            >
              {applicantCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('kanban')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-600 transition-colors ${
            activeTab === 'kanban'
              ? 'bg-white text-[var(--black)] shadow-sm'
              : 'text-[var(--light)] hover:text-[var(--mid)]'
          }`}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Pipeline
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'applicants' ? (
        <ApplicantsPanel pipeline={pipeline} />
      ) : (
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
  // All pipeline candidates are approved — show them all in the Kanban.
  const candidates = pipeline.candidates ?? [];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12, color: NW.gray500 }}>
          <Move className="h-3.5 w-3.5" style={{ color: NW.gray400 }} />
          Drag candidates between stages — changes sync to the client&apos;s portal.
        </div>
      )}
      <div className="flex gap-3 overflow-x-auto pb-3" style={{ minHeight: compact ? 180 : 320 }}>
        {stagesFor(pipeline.pipelineType).map((stage) => {
          const stageCandidates = candidates.filter(
            (c) => normFor(pipeline.pipelineType, c.stage) === stage.key
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
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: NW.white, border: `1px solid ${NW.teal500}`, borderRadius: 12, padding: '10px 12px', boxShadow: '0 12px 28px rgba(0,0,0,0.16)' }}>
            <span style={{ width: 28, height: 28, borderRadius: '50%', background: NW.teal500, color: NW.white, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>
              {(dragging.name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: NW.black }}>{formatCardName(dragging.name)}</span>
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
  stage: StageDef;
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
  const color = stageColor(stage.key);

  return (
    <div ref={setNodeRef} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, width: compact ? 184 : 224, minHeight: compact ? 160 : 300 }}>
      {/* Column header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 11px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: color }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: NW.black }}>{stage.label}</span>
          {stage.clientMovable && (
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: NW.teal600 }} title="The client moves candidates into this stage">· client</span>
          )}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 11.5, color: NW.gray500, background: NW.gray50, borderRadius: 999, padding: '1px 8px' }}>{candidates.length}</span>
      </div>

      <SortableContext items={candidates.map((c) => `cand-${c.candidateId}`)} strategy={verticalListSortingStrategy}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 9,
            background: isOver ? color + '12' : NW.offWhite,
            border: `1.5px ${isOver ? 'dashed' : 'solid'} ${isOver ? color + '66' : NW.gray100}`,
            borderRadius: 14,
            padding: 10,
            flex: 1,
            minHeight: compact ? 140 : 220,
            transition: 'background 120ms, border-color 120ms',
          }}
        >
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
          {candidates.length === 0 && (
            <div style={{ fontSize: 11.5, color: NW.gray400, textAlign: 'center', padding: '20px 0' }}>{isOver ? 'Drop here' : 'Empty'}</div>
          )}
          <button
            onClick={() => onAddCandidate(pipelineCode, stage.key)}
            style={{ marginTop: 'auto', borderRadius: 9, border: `1px dashed ${NW.gray200}`, padding: '7px 0', textAlign: 'center', fontSize: 11, fontWeight: 600, color: NW.gray400, background: 'transparent', cursor: 'pointer' }}
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
  const cardInitials = (candidate.name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const scoreColor = score >= 80 ? NW.teal600 : score >= 60 ? '#A16207' : NW.gray500;
  const scoreBg = score >= 80 ? NW.teal50 : score >= 60 ? NW.yellow50 : NW.gray50;

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 12, padding: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.03)', cursor: 'pointer' }}
      {...attributes}
      {...listeners}
      onClick={() => router.push(`/candidates/${candidate.candidateId}`)}
      className="hover:border-[var(--green)] hover:shadow-md transition-all"
      title="Open candidate profile"
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ width: 32, height: 32, borderRadius: '50%', background: NW.teal500, color: NW.white, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{cardInitials}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: NW.black, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{formatCardName(candidate.name)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            {score > 0 ? (
              <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, color: scoreColor, background: scoreBg, border: `1px solid ${scoreColor}22`, borderRadius: 5, padding: '1px 6px' }} title={`Nearwork Score: ${score}`}>NW {score}</span>
            ) : (
              <span style={{ fontSize: 10, fontWeight: 600, color: NW.gray400, background: NW.gray50, borderRadius: 5, padding: '1px 6px' }} title="No assessment yet">No score</span>
            )}
            {engLevel && (
              <span style={{ fontSize: 10, fontWeight: 700, color: '#1D4ED8', background: NW.blue50, borderRadius: 5, padding: '1px 6px' }} title={`English: ${engLevel}`}>{engLevel}</span>
            )}
          </div>
        </div>
      </div>

      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 11, paddingTop: 10, borderTop: `1px solid ${NW.gray100}` }}>
          <button
            onClick={(e) => { e.stopPropagation(); onOpenBrief(candidate, pipelineCode); }}
            style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 7, padding: '5px 0', fontSize: 10.5, fontWeight: 600, color: NW.gray600, background: 'transparent', border: 'none', cursor: 'pointer' }}
            className="hover:bg-[var(--bg)] hover:text-[var(--green)]"
          >
            <ClipboardList className="h-2.5 w-2.5" /> Brief
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(candidate.candidateId, pipelineCode); }}
            style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 7, padding: '5px 0', fontSize: 10.5, fontWeight: 600, color: '#EF7676', background: 'transparent', border: 'none', cursor: 'pointer' }}
            className="hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-2.5 w-2.5" /> Remove
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Applicants panel ─────────────────────────────────────────────────────────
// Reads directly from the `applications` Firestore collection.
// Candidates never touch `pipeline.candidates` until a Nearwork recruiter
// approves them here — at which point they are added to the pipeline at the
// "Applied" stage and become visible in the client portal.

interface AppDoc {
  id: string;
  candidateId: string;
  candidateCode?: string;
  candidateName: string;
  candidateEmail: string;
  openingCode: string;
  cvUrl?: string | null;
  skills?: string[];
  expectedSalary?: string;
  submittedAt?: Timestamp | string;
  status?: string;
}

function ApplicantsPanel({ pipeline }: { pipeline: Pipeline }) {
  const { showToast } = useToast();

  const [applications, setApplications] = useState<AppDoc[]>([]);
  const [loadingApps, setLoadingApps] = useState(true);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [viewingApp, setViewingApp] = useState<AppDoc | null>(null);
  const [fullProfile, setFullProfile] = useState<Candidate | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  // Live listener — only show applications not yet approved or rejected
  useEffect(() => {
    const q = query(collection(db, 'applications'), where('openingCode', '==', pipeline.code));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const pending = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as AppDoc)
          .filter((a) => !a.status || a.status === 'applied' || a.status === 'pending');
        setApplications(pending);
        setLoadingApps(false);
      },
      () => setLoadingApps(false),
    );
    return () => unsub();
  }, [pipeline.code]);

  async function handleApprove(app: AppDoc) {
    setApprovingId(app.id);
    try {
      const candId = app.candidateCode || app.candidateId;
      const newEntry = {
        candidateId: candId,
        candidateCode: candId,
        name: app.candidateName || '',
        email: app.candidateEmail || '',
        stage: 'applied' as StageKey,
        addedAt: new Date().toISOString(),
        source: 'jobs.nearwork.co',
        cvUrl: app.cvUrl ?? null,
        skills: app.skills ?? [],
        expectedSalary: app.expectedSalary ?? '',
      };
      await Promise.all([
        updateDoc(doc(db, 'pipelines', pipeline.id), {
          candidates: arrayUnion(newEntry),
          updatedAt: serverTimestamp(),
        }),
        updateDoc(doc(db, 'applications', app.id), {
          status: 'approved',
          inPipeline: true,
          pipelineStage: 'applied',
        }),
        // Mirror to candidates doc so the Candidates list shows pipeline progress immediately
        updateDoc(doc(db, 'candidates', candId), {
          activePipelineCode: pipeline.code,
          activePipelineStage: 'applied',
          updatedAt: serverTimestamp(),
        }).catch(() => null),
      ]);
      // Entering the pipeline emails the candidate (debounced, like any move).
      notifyStageEmail({
        action: 'stage-moved',
        pipelineCode: pipeline.code,
        candidateId: candId,
        fromStage: '',
        toStage: 'applied',
        candidateName: app.candidateName,
        candidateEmail: app.candidateEmail,
        roleTitle: pipeline.title,
        orgName: pipeline.orgName,
      });
      showToast(`${app.candidateName || 'Applicant'} approved — added to Applied stage`, 'success');
    } catch (e) {
      showToast('Approve failed: ' + (e instanceof Error ? e.message : 'Unknown'), 'error');
    } finally {
      setApprovingId(null);
    }
  }

  async function handleReject(app: AppDoc) {
    setRejectingId(app.id);
    try {
      await updateDoc(doc(db, 'applications', app.id), {
        status: 'rejected',
        rejectedAt: new Date().toISOString(),
      });
      showToast(`${app.candidateName || 'Applicant'} rejected`, 'success');
    } catch (e) {
      showToast('Reject failed: ' + (e instanceof Error ? e.message : 'Unknown'), 'error');
    } finally {
      setRejectingId(null);
    }
  }

  async function openProfile(app: AppDoc) {
    setViewingId(app.id);
    setViewingApp(app);
    setFullProfile(null);
    setLoadingProfile(true);
    try {
      const candId = app.candidateCode || app.candidateId;
      const snap = await getDoc(doc(db, 'candidates', candId));
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() } as Candidate;
        if (!data.cvUrl && !data.resumeUrl && app.cvUrl) {
          data.cvUrl = app.cvUrl;
        }
        setFullProfile(data);
      } else {
        setFullProfile(null);
      }
    } catch {
      setFullProfile(null);
    } finally {
      setLoadingProfile(false);
    }
  }

  const viewingName = fullProfile?.name ?? viewingApp?.candidateName ?? 'Applicant';

  if (loadingApps) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (applications.length === 0) {
    return (
      <div className="flex h-52 flex-col items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-white">
        <Inbox className="h-8 w-8 text-[var(--light)]" />
        <p className="text-sm font-500 text-[var(--mid)]">No pending applicants</p>
        <p className="text-xs text-[var(--light)]">
          Candidates who apply through jobs.nearwork.co will appear here for review.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <p className="text-xs text-[var(--light)] pb-1">
          {applications.length} applicant{applications.length !== 1 ? 's' : ''} waiting for review
          {' · '}Approve to add to the pipeline, or reject to dismiss.
        </p>
        {applications.map((app) => {
          const isApproving = approvingId === app.id;
          const isRejecting = rejectingId === app.id;
          const appliedDateStr = fmtDate(app.submittedAt, { month: 'short', day: 'numeric' });
          const appliedDate = appliedDateStr === '—' ? null : appliedDateStr;
          return (
            <div
              key={app.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white px-4 py-3 transition-colors hover:border-[var(--green)]"
            >
              {/* Avatar */}
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-700 text-white"
                style={{ background: 'var(--green)' }}
              >
                {initials(app.candidateName)}
              </div>

              {/* Name + email */}
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-600 text-[var(--black)]">
                  {app.candidateName || 'No name'}
                </p>
                <p className="text-xs text-[var(--light)]">{app.candidateEmail || '—'}</p>
              </div>

              {/* Applied date */}
              {appliedDate && (
                <span className="hidden shrink-0 text-[11px] text-[var(--light)] sm:block">
                  {appliedDate}
                </span>
              )}

              {/* Actions */}
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  onClick={() => openProfile(app)}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-600 text-[var(--mid)] transition-colors hover:border-[var(--green)] hover:text-[var(--green)]"
                >
                  View profile
                </button>
                <button
                  onClick={() => handleApprove(app)}
                  disabled={isApproving || isRejecting}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-600 text-white transition-opacity disabled:opacity-60"
                  style={{ background: 'var(--green)' }}
                >
                  {isApproving ? <Spinner size="sm" /> : <UserCheck className="h-3 w-3" />}
                  Add to pipeline
                </button>
                <button
                  onClick={() => handleReject(app)}
                  disabled={isApproving || isRejecting}
                  className="rounded-lg border border-red-200 px-2.5 py-1.5 text-[11px] font-600 text-red-500 transition-colors hover:bg-red-50 disabled:opacity-60"
                >
                  {isRejecting ? <Spinner size="sm" /> : <XCircle className="inline mr-1 h-3 w-3" />}
                  Reject
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Applicant profile modal */}
      <Modal
        open={viewingId !== null}
        onClose={() => {
          setViewingId(null);
          setViewingApp(null);
          setFullProfile(null);
        }}
        title={viewingName}
        size="lg"
      >
        {loadingProfile ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : fullProfile ? (
          <ApplicantProfile profile={fullProfile} />
        ) : viewingApp ? (
          <ApplicantProfile
            profile={{
              id: viewingApp.candidateId,
              name: viewingApp.candidateName,
              email: viewingApp.candidateEmail ?? '',
              skills: viewingApp.skills ?? [],
              cvUrl: viewingApp.cvUrl ?? undefined,
              expectedSalary: viewingApp.expectedSalary ?? undefined,
              source: 'jobs.nearwork.co',
            }}
            note="Full candidate profile not yet created — showing application data."
          />
        ) : (
          <p className="py-8 text-center text-sm text-[var(--light)]">
            No profile data available.
          </p>
        )}
      </Modal>
    </>
  );
}

// ─── Applicant profile (shown inside the review modal) ───────────────────────

function ApplicantProfile({ profile, note }: { profile: Candidate; note?: string }) {
  const photoSrc = profile.photoUrl;
  const initials = (profile.name || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="space-y-5">
      {/* Avatar */}
      <div className="flex items-center gap-3">
        {photoSrc ? (
          <img
            src={photoSrc}
            alt={profile.name}
            className="h-14 w-14 rounded-full object-cover border border-[var(--border)]"
          />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--bg)] border border-[var(--border)] text-base font-700 text-[var(--mid)]">
            {initials}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate font-700 text-[var(--black)]">{profile.name}</p>
          {(profile.role || profile.targetRole || profile.headline) && (
            <p className="truncate text-xs text-[var(--mid)]">
              {profile.role || profile.targetRole || profile.headline}
            </p>
          )}
        </div>
      </div>

      {note && (
        <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
          {note}
        </p>
      )}
      {/* Key details */}
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        {[
          { label: 'Email', value: profile.email },
          { label: 'Phone', value: profile.phone },
          { label: 'City', value: profile.location || profile.city },
          { label: 'English', value: profile.english },
          {
            label: 'Expected salary',
            value: profile.expectedSalaryAmount
              ? `${fmtCurrency(profile.expectedSalaryAmount, profile.expectedSalaryCurrency || 'USD')}/mo`
              : profile.expectedSalary
                ? String(profile.expectedSalary)
                : undefined,
          },
          {
            label: 'Experience',
            value:
              typeof profile.experience === 'number'
                ? `${profile.experience} yr${profile.experience !== 1 ? 's' : ''}`
                : undefined,
          },
        ]
          .filter((item) => item.value)
          .map((item) => (
            <div key={item.label} className="min-w-0">
              <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                {item.label}
              </p>
              <p className="mt-0.5 truncate font-500 text-[var(--black)]" title={item.value}>
                {item.value}
              </p>
            </div>
          ))}
      </div>

      {/* Skills */}
      {Array.isArray(profile.skills) && profile.skills.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
            Skills
          </p>
          <div className="flex flex-wrap gap-1.5">
            {profile.skills.map((s) => (
              <span
                key={s}
                className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-0.5 text-[11px] font-500 text-[var(--mid)]"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Work history */}
      {Array.isArray(profile.workHistory) &&
        profile.workHistory.some((w) => w.company || w.title) && (
          <div>
            <p className="mb-2 text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
              Work history
            </p>
            <div className="space-y-2">
              {profile.workHistory
                .filter((w) => w.company || w.title)
                .map((w, i) => (
                  <div
                    key={i}
                    className="flex gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--bg)] text-[9px] font-800 text-[var(--mid)]">
                      {i + 1}
                    </div>
                    <div>
                      <p className="text-xs font-600 text-[var(--black)]">{w.title || '—'}</p>
                      <p className="text-[11px] text-[var(--mid)]">{w.company || '—'}</p>
                      {(w.from || w.to) && (
                        <p className="mt-0.5 text-[10px] text-[var(--light)]">
                          {w.from || '?'} → {w.to === 'present' ? 'Present' : w.to || '?'}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

      {/* Languages */}
      {Array.isArray(profile.languages) && profile.languages.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
            Languages
          </p>
          <div className="flex flex-wrap gap-1.5">
            {profile.languages.map((lang) => (
              <span
                key={lang}
                className="flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[11px] font-600 text-blue-700"
              >
                <Languages className="h-3 w-3" />
                {lang}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Certifications */}
      {Array.isArray(profile.certifications) && profile.certifications.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
            Certifications &amp; courses
          </p>
          <div className="space-y-2">
            {profile.certifications.map((c, i) => (
              <div key={i} className="flex gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-[9px] font-800 text-amber-600">
                  ✓
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-600 text-[var(--black)]">{c.name}</p>
                  {c.issuer && <p className="text-[11px] text-[var(--mid)]">{c.issuer}</p>}
                  {c.date && <p className="mt-0.5 text-[10px] text-[var(--light)]">{c.date}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary */}
      {profile.summary && (
        <div>
          <p className="mb-1.5 text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Summary</p>
          <p className="text-xs leading-relaxed text-[var(--mid)]">{profile.summary}</p>
        </div>
      )}

      {/* CV / Resume */}
      {(profile.cvUrl || profile.resumeUrl) && (
        <div>
          <p className="mb-2 text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
            CV / Resume
          </p>
          <a
            href={profile.cvUrl || profile.resumeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-600 text-[var(--green)] transition-colors hover:border-[var(--green)]"
          >
            <FileText className="h-3.5 w-3.5" />
            Open CV
            <ExternalLink className="h-3 w-3 opacity-60" />
          </a>
        </div>
      )}

      {/* LinkedIn */}
      {profile.linkedIn && (
        <div>
          <p className="mb-1 text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
            LinkedIn
          </p>
          <a
            href={profile.linkedIn}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-[var(--green)] hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            {profile.linkedIn}
          </a>
        </div>
      )}
    </div>
  );
}
