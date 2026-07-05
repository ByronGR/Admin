'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  auth,
  db,
  collection,
  getDocs,
  getDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  addDoc,
  doc,
  updateDoc,
} from '@/lib/firebase';
import { PIPELINE_STAGES } from '@/components/pipeline/pipeline-page';
import { notifyStageEmail } from '@/lib/notify-stage-email';
import { Spinner } from '@/components/ui/spinner';
import { Modal } from '@/components/ui/modal';
import { HoldToDelete } from '@/components/ui/hold-to-delete';
import { useToast } from '@/components/ui/toast';
import { AssessmentsSection } from './assessments-section';
import { useAuth } from '@/hooks/use-auth';
import { fmtDate, fmtRelative, initials, fmtCurrency, candidateLocationLabel, properName } from '@/lib/utils';
import { normalizeStaffRole } from '@/lib/firebase';
import { STAFF_ROLE_LABELS, PIPELINE_STAGE_LABELS, DROP_OFF_REASON_LABELS } from '@/lib/types';
import type {
  Candidate,
  Timestamp,
  Pipeline,
  PipelineCandidate,
  PipelineStage,
  DropOffReason,
  Assessment,
  Placement,
  CEFRLevel,
  EnglishScore,
} from '@/lib/types';
import { DISC_LABELS } from '@/lib/question-bank';
import {
  Mail,
  Phone,
  MapPin,
  ExternalLink,
  FileText,
  GitBranch,
  ArrowRight,
  Award,
  Activity,
  Briefcase,
  Languages,
  GraduationCap,
  Pencil,
  Inbox,
  Calendar,
  ChevronRight,
  Check,
  X,
} from 'lucide-react';
import { NW, MONO, MatchScore, Avatar as NWAvatar } from '@/components/nw/primitives';

// CEFR → 0-100 for the Nearwork Score radar / display.
const CEFR_TO_PCT: Record<CEFRLevel, number> = {
  A1: 20,
  A2: 35,
  B1: 55,
  B2: 75,
  C1: 90,
  C2: 100,
};

const CEFR_LEVELS: CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const NEARWORK_SCORE_VALID_DAYS = 90;

interface ApplicationDoc {
  id: string;
  candidateId: string;
  openingCode?: string;
  openingTitle?: string;
  jobTitle?: string;
  title?: string;
  status?: string;
  inPipeline?: boolean;
  pipelineStage?: string;
  submittedAt?: Timestamp | string;
  rejectedAt?: Timestamp | string;
}

function tsToDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (typeof ts === 'object' && ts !== null && 'seconds' in ts) {
    return new Date((ts as { seconds: number }).seconds * 1000);
  }
  if (typeof ts === 'string') {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Parse a free-text work-history date ("2024", "Jan 2024", "Present"…) into a
// sortable number (year*12 + month). "Present/current" → very large so a current
// role floats to the top; unparseable → null.
const WORK_PRESENT = Number.MAX_SAFE_INTEGER;
function workWhenKey(s?: string): number | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  if (!t || t === '-' || t === '—') return null;
  if (/present|current|now|ongoing|actual|today/.test(t)) return WORK_PRESENT;
  const ym = t.match(/(19|20)\d{2}/);
  if (!ym) return null;
  const year = parseInt(ym[0], 10);
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  let month = 0;
  for (let i = 0; i < 12; i++) if (t.includes(months[i])) { month = i + 1; break; }
  return year * 12 + month;
}
// Recency of a role: prefer its end date; a missing end with a known start is
// treated as ongoing (current); fully unknown sorts last.
function workRecency(w: { from?: string; to?: string }): number {
  const end = workWhenKey(w.to);
  if (end != null) return end;
  return workWhenKey(w.from) != null ? WORK_PRESENT : -1;
}

// ─── Candidate detail (shared by the /candidates/[id] route) ───────────────────

export function CandidateDetail({ candidate }: { candidate: Candidate }) {
  const { showToast } = useToast();
  const { profile } = useAuth();
  const [notes, setNotes] = useState<
    Array<{
      id: string;
      body: string;
      text?: string;
      scope?: string;
      side?: string;
      author?: string;
      authorName?: string;
      createdAt?: unknown;
    }>
  >([]);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  // Note visibility: Internal (Nearwork only) by default, or Shared with client.
  const [noteScope, setNoteScope] = useState<'staff_internal' | 'client_visible'>('staff_internal');

  // Profile tabs (redesign) — exact prototype tabs.
  const [detailTab, setDetailTab] = useState<'experience' | 'education' | 'languages' | 'skills' | 'applications'>('experience');

  // ── English assessment (Nearwork-recorded level + comments) ────────────────
  const [englishScore, setEnglishScore] = useState<EnglishScore | undefined>(candidate.englishScore);
  const [engModalOpen, setEngModalOpen] = useState(false);
  const [engLevel, setEngLevel] = useState<CEFRLevel>(englishScore?.level ?? 'B2');
  const [engFeedback, setEngFeedback] = useState(englishScore?.feedback ?? '');
  const [engSaving, setEngSaving] = useState(false);

  function openEnglishModal() {
    setEngLevel(englishScore?.level ?? 'B2');
    setEngFeedback(englishScore?.feedback ?? '');
    setEngModalOpen(true);
  }

  async function saveEnglishAssessment() {
    if (!engFeedback.trim()) {
      showToast('Please enter feedback before saving', 'error');
      return;
    }
    setEngSaving(true);
    try {
      const next: EnglishScore = {
        level: engLevel,
        feedback: engFeedback.trim(),
        assessedBy: profile?.name || profile?.email || undefined,
        assessedAt: new Date().toISOString(),
      };
      await updateDoc(doc(db, 'candidates', candidate.id), {
        englishScore: next,
        updatedAt: serverTimestamp(),
      });
      setEnglishScore(next);
      setEngModalOpen(false);
      showToast('English assessment saved', 'success');
    } catch {
      showToast('Failed to save English assessment', 'error');
    } finally {
      setEngSaving(false);
    }
  }

  // ── @-mentions: Nearwork staff only on the candidate page ──────────────────
  type MentionUser = { id: string; name: string; handle: string; initials: string; role: string };
  const [staff, setStaff] = useState<MentionUser[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const mentionStart = useRef(-1);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    getDocs(collection(db, 'users'))
      .then((snap) => {
        const users: MentionUser[] = snap.docs
          .map((d) => {
            const data = d.data() as { name?: string; email?: string; staffRole?: string; role?: string; jobTitle?: string };
            return {
              id: d.id,
              name: data.name ?? data.email ?? '',
              email: (data.email ?? '').toLowerCase(),
              role:
                data.jobTitle?.trim() ||
                STAFF_ROLE_LABELS[normalizeStaffRole(data.staffRole ?? data.role ?? 'employee')],
            };
          })
          // Nearwork team members only
          .filter((u) => u.email.endsWith('@nearwork.co'))
          .map((u) => ({
            id: u.id,
            name: u.name,
            handle: (u.name || u.email).split(' ')[0].toLowerCase(),
            initials: initials(u.name || u.email),
            role: u.role,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setStaff(users);
      })
      .catch(() => setStaff([]));
  }, []);

  const mentionMatches = useMemo(() => {
    if (!mentionOpen) return [];
    const q = mentionQuery.toLowerCase();
    return staff
      .filter((u) => u.handle.startsWith(q) || u.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionOpen, mentionQuery, staff]);

  function onNoteChange(value: string, caret: number) {
    setNoteText(value);
    const upto = value.slice(0, caret);
    const m = /@(\w*)$/.exec(upto);
    if (m) {
      mentionStart.current = caret - m[0].length;
      setMentionQuery(m[1]);
      setMentionOpen(true);
    } else {
      setMentionOpen(false);
    }
  }

  function pickMention(u: MentionUser) {
    const start = mentionStart.current;
    if (start < 0) return;
    const caret = noteRef.current?.selectionStart ?? noteText.length;
    const next = `${noteText.slice(0, start)}@${u.handle} ${noteText.slice(caret)}`;
    setNoteText(next);
    setMentionOpen(false);
    requestAnimationFrame(() => noteRef.current?.focus());
  }

  // Load notes via the privileged server route (Admin SDK): returns the full
  // staff view of the shared `candidateNotes` collection — our notes plus the
  // client's shared notes — while hiding the client's team-only notes. Matches
  // by both candidateId and candidateCode so App-written notes are found too.
  async function loadNotes() {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const params = new URLSearchParams({ candidateId: candidate.id });
      if (candidate.code) params.set('candidateCode', candidate.code);
      const res = await fetch(`/api/candidate-notes?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.notes)) setNotes(data.notes);
    } catch {
      /* leave notes as-is on a transient failure */
    }
  }

  useEffect(() => {
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate.id, candidate.code]);

  // ── Pipelines & openings this candidate is in ──────────────────────────────
  const [pipelineEntries, setPipelineEntries] = useState<
    Array<{ pipeline: Pipeline; entry: PipelineCandidate }>
  >([]);
  const [pipelinesLoading, setPipelinesLoading] = useState(true);

  useEffect(() => {
    setPipelinesLoading(true);
    // Live subscription so a stage move by another recruiter updates here in
    // real time (the pipeline board is already live; this keeps the profile in step).
    const unsub = onSnapshot(
      collection(db, 'pipelines'),
      (snap) => {
        const matches: Array<{ pipeline: Pipeline; entry: PipelineCandidate }> = [];
        snap.docs.forEach((d) => {
          const p = { id: d.id, ...d.data() } as Pipeline;
          const entry = (p.candidates ?? []).find((c) => c.candidateId === candidate.id);
          if (entry) matches.push({ pipeline: p, entry });
        });
        // Active pipelines first, then by most recently updated
        matches.sort((a, b) => {
          const aActive = a.pipeline.status === 'active' ? 0 : 1;
          const bActive = b.pipeline.status === 'active' ? 0 : 1;
          if (aActive !== bActive) return aActive - bActive;
          const ta = (a.pipeline.updatedAt as { seconds?: number })?.seconds ?? 0;
          const tb = (b.pipeline.updatedAt as { seconds?: number })?.seconds ?? 0;
          return tb - ta;
        });
        setPipelineEntries(matches);
        setPipelinesLoading(false);
      },
      () => {
        setPipelineEntries([]);
        setPipelinesLoading(false);
      },
    );
    return () => unsub();
  }, [candidate.id]);

  function stageLabel(stage?: PipelineStage): string {
    if (!stage) return '—';
    return PIPELINE_STAGE_LABELS[stage] ?? stage;
  }

  // ── Client requests (raised from the client App on this candidate) ──────────
  // The App writes to the shared `pipelineRequests` collection, keyed by EITHER
  // candidateId or candidateCode. We subscribe (live) to both and merge/dedupe
  // by doc id. Staff READ + UPDATE these directly (rules already allow it).
  type ClientRequest = {
    id: string;
    type?: 'advance' | 'hire' | 'reject' | 'interview' | string;
    fromStage?: string;
    toStage?: string;
    reason?: string;
    status?: 'pending' | 'handled' | 'dismissed' | string;
    requestedBy?: string;
    requestedByEmail?: string;
    orgName?: string;
    pipelineTitle?: string;
    pipelineCode?: string;
    createdAt?: unknown;
  };
  const [clientRequests, setClientRequests] = useState<ClientRequest[]>([]);
  const [resolvingReq, setResolvingReq] = useState<string | null>(null);

  useEffect(() => {
    // Two live queries — by candidateId AND by candidateCode — merged by doc id,
    // because the App may key a request by either field.
    // Keep each source's latest docs separately, then merge by id on every update
    // (dedupe: a doc matched by both id and code appears once).
    const bySource: Record<'id' | 'code', ClientRequest[]> = { id: [], code: [] };

    const push = (docs: Array<{ id: string; data: () => Record<string, unknown> }>, source: 'id' | 'code') => {
      bySource[source] = docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) } as ClientRequest));
      const byId = new Map<string, ClientRequest>();
      [...bySource.id, ...bySource.code].forEach((r) => byId.set(r.id, r));
      const merged = Array.from(byId.values());
      // Newest first.
      merged.sort(
        (a, b) =>
          ((b.createdAt as { seconds?: number })?.seconds ?? 0) -
          ((a.createdAt as { seconds?: number })?.seconds ?? 0),
      );
      setClientRequests(merged);
    };

    const unsubId = onSnapshot(
      query(collection(db, 'pipelineRequests'), where('candidateId', '==', candidate.id)),
      (snap) => push(snap.docs, 'id'),
      () => {},
    );
    const unsubCode = candidate.code
      ? onSnapshot(
          query(collection(db, 'pipelineRequests'), where('candidateCode', '==', candidate.code)),
          (snap) => push(snap.docs, 'code'),
          () => {},
        )
      : () => {};
    return () => { unsubId(); if (candidate.code) unsubCode(); };
  }, [candidate.id, candidate.code]);

  const pendingRequests = useMemo(
    () => clientRequests.filter((r) => (r.status ?? 'pending') === 'pending'),
    [clientRequests],
  );

  function clientRequestLabel(r: ClientRequest): React.ReactNode {
    const stage = r.toStage ? (PIPELINE_STAGE_LABELS[r.toStage as PipelineStage] ?? r.toStage) : '';
    switch (r.type) {
      case 'advance':
        return <>Client asked to advance to <strong>{stage || 'the next stage'}</strong></>;
      case 'hire':
        return <>Client asked to <strong>hire</strong> this candidate</>;
      case 'reject':
        return <>Client asked to <strong>reject</strong> this candidate</>;
      case 'interview':
        return <>Client requested an <strong>interview</strong></>;
      default:
        return <>Client raised a <strong>{r.type ?? 'request'}</strong></>;
    }
  }

  async function resolveClientRequest(req: ClientRequest, status: 'handled' | 'dismissed') {
    if (resolvingReq) return;
    setResolvingReq(req.id);
    try {
      const handledBy = profile?.name || auth.currentUser?.displayName || 'Nearwork team';
      const handledByEmail = profile?.email || auth.currentUser?.email || '';
      await updateDoc(doc(db, 'pipelineRequests', req.id), {
        status,
        handledBy,
        handledByEmail,
        handledAt: serverTimestamp(),
      });
      showToast(status === 'handled' ? 'Request marked handled' : 'Request dismissed', 'success');
      // The live subscription refreshes the list automatically.
    } catch {
      showToast('Failed to update the request', 'error');
    } finally {
      setResolvingReq(null);
    }
  }

  // ── Stage editing from the profile (only for active opening + pipeline) ─────
  // opening status by id/code, so we can require the opening to be "open".
  const [openingStatusMap, setOpeningStatusMap] = useState<Record<string, string>>({});
  const [stageSaving, setStageSaving] = useState(false);
  const [dropModal, setDropModal] = useState<{ open: boolean; pipeline: Pipeline | null; entry: PipelineCandidate | null }>({ open: false, pipeline: null, entry: null });
  const [dropReason, setDropReason] = useState<DropOffReason>('mia');
  const [dropNote, setDropNote] = useState('');

  useEffect(() => {
    getDocs(collection(db, 'openings'))
      .then((snap) => {
        const m: Record<string, string> = {};
        snap.docs.forEach((d) => {
          const o = d.data() as { code?: string; status?: string };
          m[d.id] = o.status ?? '';
          if (o.code) m[o.code] = o.status ?? '';
        });
        setOpeningStatusMap(m);
      })
      .catch(() => {});
  }, []);

  // The opening is treated as "open" unless we can positively resolve it to a
  // non-open status (so a missing openingId doesn't hide the control).
  function openingIsOpen(p: Pipeline): boolean {
    const st = p.openingId ? openingStatusMap[p.openingId] : undefined;
    return st === undefined ? true : st === 'open';
  }

  const PROGRESS_KEYS = PIPELINE_STAGES.filter((s) => s.key !== 'not-selected').map((s) => s.key);
  const rankOf = (s?: string) => PROGRESS_KEYS.indexOf((s ?? '') as (typeof PROGRESS_KEYS)[number]);

  async function applyStageChange(
    pipeline: Pipeline,
    entry: PipelineCandidate,
    toStage: PipelineStage,
    dropOff?: { reason: DropOffReason; note: string },
  ) {
    if (stageSaving) return;
    // Assessment gate: a completed assessment is required to reach Partner Review
    // and beyond (rejection is always allowed).
    if ((['partner-review', 'partner-interview', 'hired'] as PipelineStage[]).includes(toStage)) {
      try {
        const snap = await getDoc(doc(db, 'assessments', `${candidate.id}__${pipeline.code}`));
        const d = snap.data() as { overallScore?: number; status?: string } | undefined;
        const ok = snap.exists() && (typeof d?.overallScore === 'number' || d?.status === 'completed');
        if (!ok) {
          showToast(`An assessment is required before moving to ${stageLabel(toStage)}. Upload it in the Skills tab first.`, 'error');
          return;
        }
      } catch {
        showToast('Could not verify the assessment. Please try again.', 'error');
        return;
      }
    }
    setStageSaving(true);
    try {
      const considered = toStage === 'not-selected' ? entry.stage : toStage;
      const prevFurthest = entry.furthestStage ?? entry.stage;
      const furthestStage = rankOf(considered) >= rankOf(prevFurthest) ? considered : prevFurthest;
      const newCandidates = (pipeline.candidates ?? []).map((c) =>
        c.candidateId !== candidate.id
          ? c
          : {
              ...c,
              stage: toStage,
              furthestStage,
              ...(dropOff ? { dropOffReason: dropOff.reason, dropOffNote: dropOff.note } : {}),
            },
      );
      await updateDoc(doc(db, 'pipelines', pipeline.id), { candidates: newCandidates, updatedAt: serverTimestamp() });
      await updateDoc(doc(db, 'candidates', candidate.id), {
        activePipelineCode: pipeline.code,
        activePipelineStage: toStage,
        updatedAt: serverTimestamp(),
      }).catch(() => null);
      notifyStageEmail({
        action: 'stage-moved',
        pipelineCode: pipeline.code,
        candidateId: candidate.id,
        fromStage: entry.stage,
        toStage,
        candidateName: candidate.name,
        candidateEmail: candidate.email,
        roleTitle: pipeline.title,
        orgName: pipeline.orgName,
        dropOffReason: dropOff?.reason,
      });
      showToast(`Moved to ${stageLabel(toStage)}`, 'success');
    } catch {
      showToast('Failed to update stage', 'error');
    } finally {
      setStageSaving(false);
    }
  }

  // Full purge of this candidate (Firebase account + all collections + files).
  const [deletingCandidate, setDeletingCandidate] = useState(false);
  async function deleteCandidate() {
    setDeletingCandidate(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Your session expired — please sign in again.');
      const res = await fetch('/api/delete-candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ candidateId: candidate.id, code: candidate.code ?? null, email: candidate.email ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to delete candidate');
      showToast('Candidate fully deleted', 'success');
      window.location.href = '/candidates';
    } catch (e) {
      showToast((e as Error)?.message || 'Failed to delete candidate', 'error');
      setDeletingCandidate(false);
    }
  }

  // Called from the stage dropdown. Not Selected opens the reason modal first.
  function onStageSelect(pipeline: Pipeline, entry: PipelineCandidate, toStage: PipelineStage) {
    if (toStage === entry.stage) return;
    if (toStage === 'not-selected') {
      setDropReason('mia');
      setDropNote('');
      setDropModal({ open: true, pipeline, entry });
      return;
    }
    applyStageChange(pipeline, entry, toStage);
  }

  // ── Every application this candidate has submitted, including ones still
  // sitting in the pre-filter queue (Admin's Applicants inbox) or rejected
  // there before ever reaching a pipeline. ───────────────────────────────────
  const [applicationEntries, setApplicationEntries] = useState<ApplicationDoc[]>([]);
  const [applicationsLoading, setApplicationsLoading] = useState(true);

  useEffect(() => {
    setApplicationsLoading(true);
    // The candidate's `applications` docs may be keyed by the candidate doc's
    // id, or (for legacy accounts) by its `code` field — query both.
    const candidateIds = Array.from(new Set([candidate.id, candidate.code].filter(Boolean))) as string[];
    const queries = [getDocs(query(collection(db, 'applications'), where('candidateId', 'in', candidateIds)))];
    // A candidate can end up with more than one CAND-XXXXXX code (e.g. a fresh
    // code generated by a Jobs application that didn't match the existing
    // record by id). Also match by email so those applications still surface.
    if (candidate.email) {
      queries.push(
        getDocs(query(collection(db, 'applications'), where('candidateEmail', '==', candidate.email)))
      );
    }
    Promise.all(queries)
      .then((snaps) => {
        const byId = new Map<string, ApplicationDoc>();
        snaps.forEach((snap) =>
          snap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() } as ApplicationDoc))
        );
        const apps = Array.from(byId.values());
        apps.sort((a, b) => {
          const ta = (a.submittedAt as { seconds?: number })?.seconds ?? 0;
          const tb = (b.submittedAt as { seconds?: number })?.seconds ?? 0;
          return tb - ta;
        });
        setApplicationEntries(apps);
      })
      .catch(() => setApplicationEntries([]))
      .finally(() => setApplicationsLoading(false));
  }, [candidate.id, candidate.code, candidate.email]);

  function applicationStatus(app: ApplicationDoc): { label: string; color: string; bg: string } {
    if (app.status === 'rejected') return { label: 'Not selected — pre-filter', color: NW.rose600, bg: NW.rose50 };
    if (app.status === 'approved' || app.inPipeline) return { label: 'In pipeline', color: NW.green600, bg: NW.green50 };
    return { label: 'Pending review', color: '#A16207', bg: NW.yellow50 };
  }

  // ── Assessment & Nearwork Score ────────────────────────────────────────────
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [assessmentLoading, setAssessmentLoading] = useState(true);
  const [assessmentRefresh, setAssessmentRefresh] = useState(0);

  useEffect(() => {
    setAssessmentLoading(true);
    getDocs(query(collection(db, 'assessments'), where('candidateId', '==', candidate.id)))
      .then((snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Assessment));
        // Prefer the most recently completed/scored assessment.
        const scored = list.filter(
          (a) => a.technicalScore != null || a.nearworkScore != null || a.completedAt
        );
        const pool = scored.length ? scored : list;
        pool.sort(
          (a, b) =>
            (tsToDate(b.completedAt ?? b.updatedAt ?? b.createdAt)?.getTime() ?? 0) -
            (tsToDate(a.completedAt ?? a.updatedAt ?? a.createdAt)?.getTime() ?? 0)
        );
        setAssessment(pool[0] ?? null);
      })
      .catch(() => setAssessment(null))
      .finally(() => setAssessmentLoading(false));
  }, [candidate.id, assessmentRefresh]);

  // ── Hired / placement ──────────────────────────────────────────────────────
  const [placement, setPlacement] = useState<Placement | null>(null);

  useEffect(() => {
    getDocs(query(collection(db, 'placements'), where('candidateId', '==', candidate.id)))
      .then((snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Placement));
        list.sort(
          (a, b) =>
            new Date(b.startDate ?? 0).getTime() - new Date(a.startDate ?? 0).getTime()
        );
        setPlacement(list[0] ?? null);
      })
      .catch(() => setPlacement(null));
  }, [candidate.id]);

  // Best English level recorded — prefers the candidate's own assessment,
  // falling back to the best level recorded across their pipelines.
  const bestEnglish = useMemo<CEFRLevel | null>(() => {
    let best: CEFRLevel | null = englishScore?.level ?? null;
    let bestPct = best ? CEFR_TO_PCT[best] : -1;
    for (const { entry } of pipelineEntries) {
      const lvl = entry.englishScore?.level;
      if (lvl && CEFR_TO_PCT[lvl] > bestPct) {
        bestPct = CEFR_TO_PCT[lvl];
        best = lvl;
      }
    }
    return best;
  }, [pipelineEntries, englishScore]);

  // Nearwork Score + 90-day validity.
  const nearworkScore = assessment?.nearworkScore ?? null;

  // Skills radar — auto-fed from real data (English, Technical, Experience,
  // Communication & Culture). Communication/Culture are derived from DISC.
  const radarData = useMemo(() => {
    const technicalPct =
      assessment?.technicalScore != null
        ? Math.round((assessment.technicalScore / 50) * 100)
        : 0;
    const englishPct = bestEnglish ? CEFR_TO_PCT[bestEnglish] : 0;
    const experiencePct =
      candidate.experience != null
        ? Math.min(100, Math.round((candidate.experience / 10) * 100))
        : 0;

    const disc = assessment?.discScores;
    const total = disc ? (disc.D ?? 0) + (disc.I ?? 0) + (disc.S ?? 0) + (disc.C ?? 0) : 0;
    const communicationPct =
      disc && total > 0
        ? Math.min(100, Math.round((((disc.I ?? 0) + (disc.S ?? 0) * 0.5) / total) * 200))
        : 0;
    const culturePct =
      disc && total > 0
        ? Math.min(100, Math.round((((disc.S ?? 0) + (disc.C ?? 0) * 0.5) / total) * 200))
        : 0;

    return [
      { axis: 'English', value: englishPct },
      { axis: 'Technical', value: technicalPct },
      { axis: 'Experience', value: experiencePct },
      { axis: 'Communication', value: communicationPct },
      { axis: 'Culture', value: culturePct },
    ];
  }, [assessment, bestEnglish, candidate.experience]);

  const hasRadarData = radarData.some((d) => d.value > 0);

  async function addNote() {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      const handles = Array.from(noteText.matchAll(/@(\w+)/g)).map((m) => m[1].toLowerCase());
      const mentions = staff.filter((u) => handles.includes(u.handle)).map((u) => u.id);

      const shared = noteScope === 'client_visible';
      // The candidate's org lives on their pipeline entry, not the candidate doc.
      // Prefer the active pipeline, else any pipeline they're in.
      const orgPipeline = (activePipe ?? pipelineEntries[0])?.pipeline;
      // CRITICAL: shared notes MUST carry the real orgId (the client portal fetches
      // shared notes by org id). Internal notes must NOT carry the client's orgId,
      // or it would break the client's org-scoped query — they're found by
      // candidateId only.
      const orgId = shared ? (orgPipeline?.orgId ?? '') : '';
      const orgName = orgPipeline?.orgName ?? '';
      const authorName = profile?.name || auth.currentUser?.displayName || 'Nearwork team';
      const authorEmail = profile?.email || auth.currentUser?.email || '';

      await addDoc(collection(db, 'candidateNotes'), {
        candidateId: candidate.id,
        candidateCode: candidate.code ?? '',
        text: noteText,
        body: noteText,
        scope: noteScope,
        visibility: noteScope,
        side: 'nearwork',
        author: authorName,
        authorName,
        authorEmail,
        orgId,
        orgName,
        mentions,
        createdAt: serverTimestamp(),
      });
      setNoteText('');
      setNoteScope('staff_internal');
      showToast('Note added', 'success');
      await loadNotes();
    } catch {
      showToast('Failed to save note', 'error');
    } finally {
      setSavingNote(false);
    }
  }

  const linkedInUrl = candidate.linkedIn
    ? candidate.linkedIn.startsWith('http')
      ? candidate.linkedIn
      : `https://${candidate.linkedIn}`
    : null;

  // ── Header / quick-fact derivations ─────────────────────────────────────────
  const jobTitle = [candidate.currentRole, candidate.targetRole, candidate.headline, candidate.role]
    .map((x) => (x ?? '').trim())
    .find((x) => x && x.toLowerCase() !== 'candidate') || '—';
  const cityLabel = candidateLocationLabel(candidate);
  const yearsExp = candidate.experience;
  const statusActive = !['rejected', 'withdrawn', 'inactive'].includes(String(candidate.status ?? '').toLowerCase());
  const cvUrl = candidate.resumeUrl || candidate.cvUrl || null;
  // Always newest → oldest: most-recent/current role first, descending by end
  // date (then start date as a tiebreaker), regardless of stored order.
  const work = (candidate.workHistory ?? [])
    .filter((w) => w.company || w.title)
    .slice()
    .sort((a, b) => {
      const ra = workRecency(a);
      const rb = workRecency(b);
      if (rb !== ra) return rb - ra;
      const fa = workWhenKey(a.from) ?? -1;
      const fb = workWhenKey(b.from) ?? -1;
      return fb - fa;
    });
  const monthlySalary = candidate.expectedSalaryAmount != null
    ? `${fmtCurrency(Number(candidate.expectedSalaryAmount), candidate.expectedSalaryCurrency || 'USD')}/mo`
    : typeof candidate.expectedSalary === 'number'
      ? `${fmtCurrency(candidate.expectedSalary, 'USD')}/mo`
      : (typeof candidate.expectedSalary === 'string' && candidate.expectedSalary.trim()) ? candidate.expectedSalary : null;
  const activePipe = pipelineEntries.find(({ entry }) => entry.stage !== 'not-selected');
  // Where the candidate was dropped, so we can show the last stage they reached.
  const rejectedPipe = pipelineEntries.find(({ entry }) => entry.stage === 'not-selected');
  // Stage is editable from the profile ONLY when the candidate sits in an
  // active pipeline whose opening is still open.
  const stageEditable =
    !!activePipe && activePipe.pipeline.status === 'active' && openingIsOpen(activePipe.pipeline);
  const appsCount = pipelineEntries.length + applicationEntries.length;
  const pastApps = applicationEntries;

  const DETAIL_TABS: { key: typeof detailTab; label: string; icon: React.ReactNode }[] = [
    { key: 'experience', label: 'Experience', icon: <Briefcase className="h-4 w-4" /> },
    { key: 'education', label: 'Education', icon: <GraduationCap className="h-4 w-4" /> },
    { key: 'languages', label: 'Languages', icon: <Languages className="h-4 w-4" /> },
    { key: 'skills', label: 'Skills', icon: <Award className="h-4 w-4" /> },
    { key: 'applications', label: 'Applications', icon: <Inbox className="h-4 w-4" /> },
  ];

  const card: React.CSSProperties = { background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.03)', padding: 22 };
  const cardHead = (icon: React.ReactNode, title: string, sub?: string, action?: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: NW.gray50, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: NW.gray600 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: NW.black }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: NW.gray500, marginTop: 1 }}>{sub}</div>}
        </div>
      </div>
      {action}
    </div>
  );
  const snapRow = (label: string, value: React.ReactNode, last = false) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderBottom: last ? 'none' : `1px solid ${NW.gray100}` }}>
      <span style={{ fontSize: 12.5, color: NW.gray500 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: NW.black, textAlign: 'right' }}>{value}</span>
    </div>
  );
  const cefrPct = (lvl?: CEFRLevel) => (lvl ? CEFR_TO_PCT[lvl] : 0);

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, minWidth: 0 }}>
          {candidate.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={candidate.photoUrl} alt={candidate.name} style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
          ) : (
            <NWAvatar initials={initials(candidate.name) || '—'} size={64} bg={NW.teal500} />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: NW.black }}>{properName(candidate.name) || 'Unnamed candidate'}</h1>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: statusActive ? NW.green600 : NW.gray500, background: statusActive ? NW.green50 : NW.gray50, border: `1px solid ${(statusActive ? NW.green600 : NW.gray500)}22`, borderRadius: 999, padding: '3px 10px' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusActive ? NW.green500 : NW.gray300 }} />
                {statusActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap', fontSize: 13.5, color: NW.gray600 }}>
              <span>{jobTitle}</span>
              {cityLabel && <><span style={{ color: NW.gray300 }}>·</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><MapPin className="h-3.5 w-3.5" style={{ color: NW.gray400 }} />{cityLabel}</span></>}
              {yearsExp != null && <><span style={{ color: NW.gray300 }}>·</span><span>{yearsExp}+ yrs experience</span></>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled
            title="Scheduling is coming soon"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 18px', fontSize: 14, fontWeight: 600, color: NW.black, background: NW.white, border: `1px solid ${NW.gray200}`, borderRadius: 999, cursor: 'not-allowed', opacity: 0.7 }}
          >
            <Calendar className="h-4 w-4" /> Schedule
          </button>
          {cvUrl ? (
            <a href={cvUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 18px', fontSize: 14, fontWeight: 600, color: NW.white, background: NW.teal500, borderRadius: 999, textDecoration: 'none' }}>
              <FileText className="h-4 w-4" /> View CV
            </a>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 18px', fontSize: 14, fontWeight: 600, color: NW.gray400, background: NW.white, border: `1px dashed ${NW.gray200}`, borderRadius: 999 }}>
              <FileText className="h-4 w-4" /> No CV
            </span>
          )}
        </div>
      </div>

      {/* Client requests — raised from the client App; staff act on them here.
          Placed above the main grid so staff see them immediately. */}
      {pendingRequests.length > 0 && (
        <div
          style={{
            ...card,
            marginBottom: 16,
            borderColor: `${NW.yellow500}55`,
            background: NW.yellow50,
            padding: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, background: NW.white, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#A16207' }}>
              <Inbox className="h-4 w-4" />
            </span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: NW.black }}>Client requests</div>
              <div style={{ fontSize: 12, color: '#A16207', marginTop: 1 }}>
                {pendingRequests.length} pending {pendingRequests.length === 1 ? 'request' : 'requests'} from the client to action
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pendingRequests.map((r) => {
              const busy = resolvingReq === r.id;
              const isReject = r.type === 'reject';
              return (
                <div
                  key={r.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    background: NW.white,
                    border: `1px solid ${isReject ? `${NW.rose500}33` : NW.gray100}`,
                    borderRadius: 12,
                    padding: '14px 16px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: NW.black }}>{clientRequestLabel(r)}</div>
                      {(r.pipelineTitle || r.pipelineCode) && (
                        <div style={{ fontSize: 12, color: NW.gray500, marginTop: 2 }}>
                          {r.pipelineTitle ?? ''}{r.pipelineTitle && r.pipelineCode ? ' · ' : ''}{r.pipelineCode ?? ''}
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#A16207', background: NW.yellow50, border: `1px solid ${NW.yellow500}44`, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      Pending
                    </span>
                  </div>

                  {r.reason && r.reason.trim() && (
                    <div style={{ fontSize: 13, color: isReject ? NW.rose600 : NW.gray700, background: isReject ? NW.rose50 : NW.gray50, border: `1px solid ${isReject ? `${NW.rose500}22` : NW.gray100}`, borderRadius: 8, padding: '8px 12px', lineHeight: 1.5 }}>
                      <span style={{ fontWeight: 600 }}>{isReject ? 'Reason: ' : 'Note: '}</span>{r.reason}
                    </div>
                  )}

                  <div style={{ fontSize: 11.5, color: NW.gray500 }}>
                    {r.requestedBy ?? r.requestedByEmail ?? 'Client'} · {fmtRelative(r.createdAt as Timestamp | string | undefined)}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => resolveClientRequest(r, 'handled')}
                      disabled={busy}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', fontSize: 12.5, fontWeight: 600, color: NW.white, background: NW.teal500, border: 'none', borderRadius: 999, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}
                    >
                      {busy ? <Spinner size="sm" /> : <Check className="h-3.5 w-3.5" />} Mark handled
                    </button>
                    <button
                      type="button"
                      onClick={() => resolveClientRequest(r, 'dismissed')}
                      disabled={busy}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', fontSize: 12.5, fontWeight: 600, color: NW.gray700, background: NW.white, border: `1px solid ${NW.gray200}`, borderRadius: 999, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}
                    >
                      <X className="h-3.5 w-3.5" /> Dismiss
                    </button>
                    <span style={{ fontSize: 11.5, color: NW.gray500 }}>
                      Move the candidate with the stage controls, then mark this handled.
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 16, alignItems: 'start' }} className="nw-cand-grid">
        {/* Left — tabs */}
        <div>
          <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${NW.gray100}`, marginBottom: 18, flexWrap: 'wrap' }}>
            {DETAIL_TABS.map((t) => {
              const on = detailTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setDetailTab(t.key)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: on ? 700 : 500, color: on ? NW.black : NW.gray500, background: 'transparent', border: 'none', borderBottom: `2px solid ${on ? NW.teal500 : 'transparent'}`, padding: '10px 13px', marginBottom: -1, cursor: 'pointer' }}
                >
                  <span style={{ color: on ? NW.teal600 : NW.gray400 }}>{t.icon}</span>
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Experience */}
          {detailTab === 'experience' && (
            <div style={card}>
              {cardHead(<Briefcase className="h-4 w-4" />, 'Work experience', work.length ? `${work.length} role${work.length === 1 ? '' : 's'}${yearsExp != null ? ` · ${yearsExp}+ years` : ''}` : undefined)}
              {work.length === 0 ? (
                <div style={{ fontSize: 13, color: NW.gray400, padding: '6px 0' }}>No work history on file yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {work.map((w, i) => (
                    <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span style={{ width: 12, height: 12, borderRadius: '50%', background: i === 0 ? NW.teal500 : NW.white, border: `2px solid ${i === 0 ? NW.teal500 : NW.gray200}`, marginTop: 4 }} />
                        {i < work.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 40, background: NW.gray100 }} />}
                      </div>
                      <div style={{ paddingBottom: 20, flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: NW.black }}>{w.title || 'Role'}</span>
                          {(w.from || w.to) && <span style={{ fontSize: 12, color: NW.gray400 }}>{w.from || '?'} – {w.to === 'present' ? 'Present' : (w.to || '?')}</span>}
                        </div>
                        {w.company && <div style={{ fontSize: 13, color: NW.teal700, fontWeight: 500, marginTop: 2 }}>{w.company}</div>}
                        {w.contact && <div style={{ fontSize: 12.5, color: NW.gray500, marginTop: 4 }}>Contact: {w.contact}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {candidate.summary && (
                <div style={{ marginTop: work.length ? 6 : 0, paddingTop: 14, borderTop: `1px solid ${NW.gray100}` }}>
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: NW.gray400, marginBottom: 6 }}>Summary</div>
                  <p style={{ fontSize: 13.5, lineHeight: 1.6, color: NW.gray600, margin: 0 }}>{candidate.summary}</p>
                </div>
              )}
            </div>
          )}

          {/* Education */}
          {detailTab === 'education' && (
            <div style={card}>
              {cardHead(<GraduationCap className="h-4 w-4" />, 'Education & certifications')}
              {(candidate.certifications ?? []).length === 0 ? (
                <div style={{ fontSize: 13, color: NW.gray400, padding: '6px 0' }}>No education or certifications on file yet.</div>
              ) : (
                <div>
                  {(candidate.certifications ?? []).map((c, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '11px 0', borderTop: i === 0 ? 'none' : `1px solid ${NW.gray100}` }}>
                      <span style={{ width: 36, height: 36, borderRadius: 10, background: NW.violet50, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: NW.violet500 }}>
                        <GraduationCap className="h-4 w-4" />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: NW.black }}>{c.name}</div>
                        {c.issuer && <div style={{ fontSize: 12.5, color: NW.gray600, marginTop: 1 }}>{c.issuer}</div>}
                      </div>
                      {c.date && <span style={{ fontSize: 12, color: NW.gray400 }}>{c.date}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Languages */}
          {detailTab === 'languages' && (
            <div style={card}>
              {cardHead(
                <Languages className="h-4 w-4" />, 'Languages', undefined,
                <button onClick={openEnglishModal} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: NW.gray700, background: NW.white, border: `1px solid ${NW.gray200}`, borderRadius: 999, padding: '6px 12px', cursor: 'pointer' }}>
                  <Pencil className="h-3.5 w-3.5" /> {englishScore ? 'Edit English' : 'Add English'}
                </button>,
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* English (assessed) */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: NW.black }}>English</span>
                    <span style={{ fontSize: 12.5, color: NW.gray500 }}>{englishScore?.level ?? bestEnglish ?? 'Not assessed'}</span>
                  </div>
                  <div style={{ height: 7, background: NW.gray100, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${cefrPct(englishScore?.level ?? bestEnglish ?? undefined)}%`, height: '100%', background: NW.teal500, borderRadius: 4 }} />
                  </div>
                  {englishScore?.feedback && <p style={{ fontSize: 12, color: NW.gray500, marginTop: 6, lineHeight: 1.5 }}>{englishScore.feedback}</p>}
                </div>
                {/* Other languages */}
                {(candidate.languages ?? []).map((lang) => (
                  <div key={lang}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: NW.black }}>{lang}</span>
                      <span style={{ fontSize: 12.5, color: NW.gray500 }}>Conversational</span>
                    </div>
                    <div style={{ height: 7, background: NW.gray100, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: '70%', height: '100%', background: NW.blue500, borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
                {!englishScore && !bestEnglish && (candidate.languages ?? []).length === 0 && (
                  <div style={{ fontSize: 13, color: NW.gray400 }}>No languages recorded yet.</div>
                )}
              </div>
            </div>
          )}

          {/* Skills */}
          {detailTab === 'skills' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={card}>
                {cardHead(<Award className="h-4 w-4" />, 'Skills', undefined, nearworkScore != null ? <MatchScore value={nearworkScore} size={44} /> : undefined)}
                {(candidate.skills ?? []).length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {(candidate.skills ?? []).map((s) => (
                      <span key={s} style={{ fontSize: 12, fontWeight: 500, color: NW.gray700, background: NW.gray50, border: `1px solid ${NW.gray100}`, borderRadius: 999, padding: '4px 10px' }}>{s}</span>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: NW.gray400 }}>No skills tagged yet.</div>
                )}
                <div style={{ fontSize: 12, color: NW.gray400, marginTop: 16 }}>Match score reflects the candidate&apos;s Nearwork Score. Skills are drawn from CV, assessments and recruiter tags.</div>
              </div>

              <AssessmentsSection
                candidateId={candidate.id}
                pipelines={pipelineEntries}
                onEnglishUpdated={async () => {
                  try {
                    const snap = await getDoc(doc(db, 'candidates', candidate.id));
                    const es = snap.data()?.englishScore;
                    if (es) setEnglishScore(es as EnglishScore);
                  } catch { /* keep current */ }
                  setAssessmentRefresh((k) => k + 1);
                }}
              />

            </div>
          )}

          {/* Applications */}
          {detailTab === 'applications' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={card}>
                {cardHead(<GitBranch className="h-4 w-4" />, 'Current application', activePipe ? undefined : rejectedPipe ? 'Not selected' : 'Not in an active pipeline')}
                {pipelinesLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}><Spinner size="sm" /></div>
                ) : activePipe ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', borderRadius: 12, border: `1px solid ${NW.gray100}`, background: NW.offWhite }}>
                    <a href={`/pipeline?focus=${encodeURIComponent(activePipe.pipeline.code)}`} style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0, textDecoration: 'none' }}>
                      <span style={{ width: 42, height: 42, borderRadius: 11, background: NW.teal500 + '18', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: NW.teal600 }}><Briefcase className="h-5 w-5" /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: NW.black }}>{activePipe.pipeline.title}</div>
                        <div style={{ fontSize: 12.5, color: NW.gray500, marginTop: 1 }}>{activePipe.pipeline.orgName ?? '—'} · {activePipe.pipeline.code}</div>
                      </div>
                    </a>
                    {stageEditable ? (
                      <select
                        value={activePipe.entry.stage}
                        disabled={stageSaving}
                        onChange={(e) => onStageSelect(activePipe.pipeline, activePipe.entry, e.target.value as PipelineStage)}
                        title="Change stage"
                        style={{ fontSize: 12.5, fontWeight: 600, color: NW.black, background: NW.white, border: `1px solid ${NW.gray200}`, borderRadius: 9, padding: '7px 10px', cursor: stageSaving ? 'wait' : 'pointer', flexShrink: 0 }}
                      >
                        {PIPELINE_STAGES.map((s) => (
                          <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                      </select>
                    ) : (
                      <a href={`/pipeline?focus=${encodeURIComponent(activePipe.pipeline.code)}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 500, color: NW.gray700, textDecoration: 'none', flexShrink: 0 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: NW.teal500 }} />{stageLabel(activePipe.entry.stage)}
                        <ChevronRight className="h-4 w-4" style={{ color: NW.gray400 }} />
                      </a>
                    )}
                  </div>
                ) : rejectedPipe ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', borderRadius: 12, border: `1px solid ${NW.rose500}22`, background: NW.rose50 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ width: 42, height: 42, borderRadius: 11, background: NW.rose500 + '18', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: NW.rose600 }}><GitBranch className="h-5 w-5" /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: NW.black }}>{rejectedPipe.pipeline.title}</div>
                        <div style={{ fontSize: 12.5, color: NW.gray500, marginTop: 1 }}>{rejectedPipe.pipeline.orgName ?? '—'} · {rejectedPipe.pipeline.code}</div>
                      </div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: NW.rose600, background: NW.white, borderRadius: 999, padding: '3px 10px', flexShrink: 0 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: NW.rose500 }} />Not selected
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <span style={{ fontSize: 12.5, color: NW.gray700, background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 8, padding: '5px 10px' }}>
                        Last stage reached: <strong style={{ color: NW.black }}>{stageLabel(rejectedPipe.entry.furthestStage)}</strong>
                      </span>
                      {rejectedPipe.entry.dropOffReason && (
                        <span style={{ fontSize: 12.5, color: NW.gray700, background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 8, padding: '5px 10px' }}>
                          Reason: <strong style={{ color: NW.black }}>{DROP_OFF_REASON_LABELS[rejectedPipe.entry.dropOffReason] ?? rejectedPipe.entry.dropOffReason}</strong>
                        </span>
                      )}
                    </div>
                    {rejectedPipe.entry.dropOffNote && (
                      <div style={{ fontSize: 12.5, color: NW.gray600, fontStyle: 'italic' }}>&ldquo;{rejectedPipe.entry.dropOffNote}&rdquo;</div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: NW.gray500, background: NW.gray50, borderRadius: 12, padding: 16 }}>This candidate isn&apos;t in any active pipeline right now.</div>
                )}
              </div>

              <div style={card}>
                {cardHead(<Inbox className="h-4 w-4" />, 'Application history', `${pastApps.length} application${pastApps.length === 1 ? '' : 's'}`)}
                {applicationsLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}><Spinner size="sm" /></div>
                ) : pastApps.length === 0 ? (
                  <div style={{ fontSize: 13, color: NW.gray400 }}>No applications on record.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {pastApps.map((a) => {
                      const st = applicationStatus(a);
                      const title = a.openingTitle || a.jobTitle || a.title || a.openingCode || 'Role';
                      const inner = (
                        <>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 600, color: NW.black }}>{title}</div>
                            <div style={{ fontSize: 12, color: NW.gray500, marginTop: 1 }}>{a.openingCode || ''}{a.submittedAt ? `${a.openingCode ? ' · ' : ''}applied ${fmtRelative(a.submittedAt)}` : ''}</div>
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 600, color: st.color, background: st.bg, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>{st.label}</span>
                          {a.openingCode && <ChevronRight className="h-3.5 w-3.5" style={{ color: NW.gray400 }} />}
                        </>
                      );
                      return a.openingCode ? (
                        <a key={a.id} href={`/pipeline?focus=${encodeURIComponent(a.openingCode)}`} style={{ display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${NW.gray100}`, borderRadius: 12, padding: '12px 14px', textDecoration: 'none' }}>{inner}</a>
                      ) : (
                        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${NW.gray100}`, borderRadius: 12, padding: '12px 14px' }}>{inner}</div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right — rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Danger zone — full delete */}
          <div style={{ ...card, borderColor: `${NW.rose500}44` }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: NW.rose600, marginBottom: 4 }}>Danger zone</div>
            <div style={{ fontSize: 12, color: NW.gray500, marginBottom: 12, lineHeight: 1.5 }}>
              Permanently removes this candidate everywhere — profile, login account, applications, assessments, notes and uploaded files. Cannot be undone. Hired/payroll records are kept.
            </div>
            <HoldToDelete onConfirm={deleteCandidate} busy={deletingCandidate} label="Hold to delete candidate" fullWidth />
          </div>

          {/* Hired banner */}
          {placement && (
            <a href={`/hired/${placement.id}`} style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderColor: NW.teal500, background: 'rgba(22,160,133,0.06)', textDecoration: 'none', padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                <span style={{ width: 36, height: 36, borderRadius: '50%', background: NW.teal500, color: NW.white, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Briefcase className="h-4 w-4" /></span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: NW.black }}>Hired{placement.orgName ? ` at ${placement.orgName}` : ''}</div>
                  <div style={{ fontSize: 11.5, color: NW.gray500 }}>{placement.openingTitle ?? 'Placement'}</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4" style={{ color: NW.teal600 }} />
            </a>
          )}

          {/* Contact */}
          <div style={card}>
            {cardHead(<Mail className="h-4 w-4" />, 'Contact')}
            {candidate.email && (
              <a href={`mailto:${candidate.email}`} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', textDecoration: 'none' }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: NW.gray50, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: NW.gray600 }}><Mail className="h-4 w-4" /></span>
                <span style={{ fontSize: 13, color: NW.teal700, fontWeight: 500, wordBreak: 'break-all' }}>{candidate.email}</span>
              </a>
            )}
            {candidate.phone && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: candidate.email ? `1px solid ${NW.gray100}` : 'none' }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: NW.gray50, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: NW.gray600 }}><Phone className="h-4 w-4" /></span>
                <span style={{ fontFamily: MONO, fontSize: 13, color: NW.gray800 }}>{candidate.phone}</span>
              </div>
            )}
            {cvUrl && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: `1px solid ${NW.gray100}` }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: NW.rose50, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: NW.rose600 }}><FileText className="h-4 w-4" /></span>
                <span style={{ flex: 1, fontSize: 13, color: NW.gray700 }}>Resume / CV</span>
                <a href={cvUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, color: NW.teal600 }}><ExternalLink className="h-3.5 w-3.5" /> View</a>
              </div>
            )}
            {linkedInUrl && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: `1px solid ${NW.gray100}` }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: NW.blue50, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: NW.blue500 }}><ExternalLink className="h-4 w-4" /></span>
                <a href={linkedInUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: NW.teal700, fontWeight: 500 }}>LinkedIn profile</a>
              </div>
            )}
            {!candidate.email && !candidate.phone && !cvUrl && !linkedInUrl && (
              <div style={{ fontSize: 13, color: NW.gray400 }}>No contact details on file.</div>
            )}
          </div>

          {/* Quick facts */}
          <div style={card}>
            {cardHead(<Award className="h-4 w-4" />, 'Quick facts')}
            {snapRow('Status', <span style={{ color: statusActive ? NW.green600 : NW.gray500, fontWeight: 600 }}>{statusActive ? 'Active' : 'Inactive'}</span>)}
            {snapRow('Salary expectation', <span style={{ fontFamily: MONO }}>{monthlySalary ?? '—'}</span>)}
            {snapRow('Location', cityLabel || '—')}
            {snapRow('Experience', yearsExp != null ? `${yearsExp}+ years` : '—')}
            {snapRow('Source', candidate.source || '—')}
            {snapRow('Applications', `${appsCount} total`, true)}
          </div>

          {/* Latest assessment */}
          {assessment && (assessment.technicalScore != null || assessment.discStyle) && (
            <div style={card}>
              {cardHead(<Activity className="h-4 w-4" />, 'Latest assessment')}
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                {assessment.technicalScore != null && (
                  <div>
                    <div style={{ fontSize: 11, color: NW.gray500 }}>Technical</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
                      <span style={{ fontFamily: MONO, fontSize: 30, fontWeight: 500, color: NW.teal600, letterSpacing: '-0.02em' }}>{assessment.technicalScore}</span>
                      <span style={{ fontSize: 12, color: NW.gray400 }}>/50</span>
                    </div>
                  </div>
                )}
                {assessment.discStyle && (
                  <div style={{ borderLeft: assessment.technicalScore != null ? `1px solid ${NW.gray100}` : 'none', paddingLeft: assessment.technicalScore != null ? 20 : 0 }}>
                    <div style={{ fontSize: 11, color: NW.gray500, marginBottom: 4 }}>DISC</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: NW.black }}>{assessment.discStyle} — {DISC_LABELS[assessment.discStyle].name}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          <div style={card}>
            {cardHead(<Pencil className="h-4 w-4" />, 'Notes')}
            <div style={{ position: 'relative' }}>
              <textarea
                ref={noteRef}
                value={noteText}
                onChange={(e) => onNoteChange(e.target.value, e.target.selectionStart)}
                onBlur={() => setTimeout(() => setMentionOpen(false), 150)}
                placeholder="Add a note… type @ to mention a Nearwork teammate"
                rows={3}
                className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)] focus:bg-white"
              />
              {mentionOpen && mentionMatches.length > 0 && (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-lg">
                  <p className="border-b border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">Nearwork team</p>
                  {mentionMatches.map((u) => (
                    <button key={u.id} type="button" onMouseDown={(e) => { e.preventDefault(); pickMention(u); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--bg)]">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-700 text-white" style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}>{u.initials}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-600 text-[var(--black)]">{u.name}</span>
                        <span className="block truncate text-[10px] text-[var(--light)]">@{u.handle} · {u.role}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Visibility toggle — Internal (default) vs Shared with client */}
            <div className="mt-2 flex gap-2">
              {([
                { key: 'staff_internal', label: 'Internal' },
                { key: 'client_visible', label: 'Shared with client' },
              ] as const).map((opt) => {
                const on = noteScope === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setNoteScope(opt.key)}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-[11px] font-600 transition-colors ${
                      on ? 'text-white' : 'border border-[var(--border)] text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]'
                    }`}
                    style={on ? { background: 'var(--green)' } : {}}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] text-[var(--light)]">
              {noteScope === 'client_visible'
                ? 'Visible to the client on the candidate profile.'
                : 'Nearwork only — not shown to the client.'}
            </p>
            <button onClick={addNote} disabled={savingNote || !noteText.trim()} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-600 text-white disabled:opacity-50" style={{ background: 'var(--green)' }}>
              {savingNote && <Spinner size="sm" />} Add note
            </button>
            <div className="mt-4 space-y-3">
              {notes.map((n) => {
                const scope = n.scope ?? 'staff_internal';
                const badge =
                  n.side === 'client'
                    ? { label: 'From client', color: 'var(--blue, #2563eb)', bg: 'rgba(37,99,235,0.10)' }
                    : scope === 'client_visible'
                      ? { label: 'Shared with client', color: 'var(--green)', bg: 'rgba(22,160,133,0.10)' }
                      : { label: 'Internal', color: 'var(--light)', bg: 'var(--bg)' };
                return (
                  <div key={n.id} className="rounded-lg bg-[var(--bg)] p-3">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-600"
                        style={{ color: badge.color, background: badge.bg }}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--black)]">{n.body || n.text}</p>
                    <p className="mt-1.5 text-[10px] text-[var(--light)]">{n.authorName ?? n.author ?? 'Nearwork team'} · {fmtRelative(n.createdAt as Timestamp | string | undefined)}</p>
                  </div>
                );
              })}
              {notes.length === 0 && <p className="text-center text-xs text-[var(--light)]">No notes yet.</p>}
            </div>
          </div>
        </div>
      </div>

      {/* English assessment edit modal */}
      <Modal open={engModalOpen} onClose={() => setEngModalOpen(false)} title={englishScore ? 'Edit English assessment' : 'Add English assessment'} size="md">
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">CEFR Level *</label>
            <div className="flex gap-2 flex-wrap">
              {CEFR_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setEngLevel(level)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-700 transition-colors ${
                    engLevel === level ? 'text-white' : 'border border-[var(--border)] text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]'
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
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Comments *</label>
            <textarea
              value={engFeedback}
              onChange={(e) => setEngFeedback(e.target.value)}
              rows={3}
              placeholder="Describe the candidate's English proficiency: fluency, accent, comprehension, professional communication…"
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
            <p className="mt-1 text-[10px] text-[var(--light)]">Visible to Nearwork staff and to the client.</p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEngModalOpen(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">Cancel</button>
            <button type="button" onClick={saveEnglishAssessment} disabled={engSaving || !engFeedback.trim()} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60" style={{ background: 'var(--green)' }}>
              {engSaving && <Spinner size="sm" />} Save
            </button>
          </div>
        </div>
      </Modal>

      {/* Drop-off reason — required when moving a candidate to Not Selected */}
      <Modal open={dropModal.open} onClose={() => !stageSaving && setDropModal({ open: false, pipeline: null, entry: null })} title="Move to Not Selected" size="md">
        <div className="space-y-4">
          <p className="text-xs text-[var(--mid)]">Pick a reason. The candidate sees a warm, generic message — your internal note is never sent to them.</p>
          <div>
            <label className="mb-2 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Reason *</label>
            <select
              value={dropReason}
              onChange={(e) => setDropReason(e.target.value as DropOffReason)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            >
              {(Object.keys(DROP_OFF_REASON_LABELS) as DropOffReason[]).map((r) => (
                <option key={r} value={r}>{DROP_OFF_REASON_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Internal note (optional)</label>
            <textarea
              value={dropNote}
              onChange={(e) => setDropNote(e.target.value)}
              rows={3}
              placeholder="Context for the team — not shown to the candidate."
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDropModal({ open: false, pipeline: null, entry: null })} disabled={stageSaving} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)] disabled:opacity-50">Cancel</button>
            <button
              type="button"
              onClick={async () => {
                if (!dropModal.pipeline || !dropModal.entry) return;
                await applyStageChange(dropModal.pipeline, dropModal.entry, 'not-selected', { reason: dropReason, note: dropNote.trim() });
                setDropModal({ open: false, pipeline: null, entry: null });
              }}
              disabled={stageSaving}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
              style={{ background: 'var(--rose)' }}
            >
              {stageSaving && <Spinner size="sm" />} Move to Not Selected
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ─── Skills radar (SVG, 5 axes) ────────────────────────────────────────────────

function RadarChart({ data }: { data: { axis: string; value: number }[] }) {
  const size = 240;
  const cx = size / 2;
  const cy = size / 2;
  const r = 78;
  const n = data.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pointAt = (i: number, value: number): [number, number] => {
    const rr = (Math.max(0, Math.min(100, value)) / 100) * r;
    return [cx + rr * Math.cos(angle(i)), cy + rr * Math.sin(angle(i))];
  };

  const rings = [0.25, 0.5, 0.75, 1];
  const polygon = data.map((d, i) => pointAt(i, d.value).join(',')).join(' ');

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
      {/* Grid rings */}
      {rings.map((ring, ri) => (
        <polygon
          key={ri}
          points={data
            .map((_, i) => {
              const [x, y] = pointAt(i, ring * 100);
              return `${x},${y}`;
            })
            .join(' ')}
          fill="none"
          stroke="var(--border)"
          strokeWidth={1}
        />
      ))}
      {/* Spokes */}
      {data.map((_, i) => {
        const [x, y] = pointAt(i, 100);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border)" strokeWidth={1} />;
      })}
      {/* Data polygon */}
      <polygon points={polygon} fill="rgba(22,160,133,0.18)" stroke="var(--green)" strokeWidth={2} />
      {/* Data points */}
      {data.map((d, i) => {
        const [x, y] = pointAt(i, d.value);
        return <circle key={i} cx={x} cy={y} r={3} fill="var(--green)" />;
      })}
      {/* Axis labels */}
      {data.map((d, i) => {
        const [x, y] = pointAt(i, 118);
        const anchor = Math.abs(x - cx) < 12 ? 'middle' : x > cx ? 'start' : 'end';
        return (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
            className="fill-[var(--mid)]"
            style={{ fontSize: 10, fontWeight: 600 }}
          >
            {d.axis}
            <tspan x={x} dy={12} className="fill-[var(--light)]" style={{ fontSize: 9, fontWeight: 500 }}>
              {d.value}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
