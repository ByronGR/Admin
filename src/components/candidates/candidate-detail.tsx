'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  db,
  collection,
  getDocs,
  serverTimestamp,
  query,
  where,
  addDoc,
  doc,
  updateDoc,
} from '@/lib/firebase';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/hooks/use-auth';
import { fmtDate, fmtRelative, initials, fmtCurrency } from '@/lib/utils';
import { normalizeStaffRole } from '@/lib/firebase';
import { STAFF_ROLE_LABELS, PIPELINE_STAGE_LABELS, DROP_OFF_REASON_LABELS } from '@/lib/types';
import type {
  Candidate,
  WorkHistoryEntry,
  Timestamp,
  Pipeline,
  PipelineCandidate,
  PipelineStage,
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
  MessageCircle,
  GitBranch,
  ArrowRight,
  Award,
  Activity,
  Briefcase,
  Languages,
  GraduationCap,
  Volume2,
  Pencil,
  Inbox,
} from 'lucide-react';

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

// ─── Candidate detail (shared by the /candidates/[id] route) ───────────────────

export function CandidateDetail({ candidate }: { candidate: Candidate }) {
  const { showToast } = useToast();
  const { profile } = useAuth();
  const [notes, setNotes] = useState<
    Array<{ id: string; body: string; authorName?: string; createdAt?: unknown }>
  >([]);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

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

  useEffect(() => {
    getDocs(
      query(collection(db, 'candidateNotes'), where('candidateId', '==', candidate.id))
    ).then((snap) => {
      setNotes(
        snap.docs
          .map(
            (d) =>
              ({ id: d.id, ...d.data() } as {
                id: string;
                body: string;
                authorName?: string;
                createdAt?: unknown;
              })
          )
          .sort((a, b) => {
            const ta = (a.createdAt as { seconds?: number })?.seconds ?? 0;
            const tb = (b.createdAt as { seconds?: number })?.seconds ?? 0;
            return tb - ta;
          })
      );
    });
  }, [candidate.id]);

  // ── Pipelines & openings this candidate is in ──────────────────────────────
  const [pipelineEntries, setPipelineEntries] = useState<
    Array<{ pipeline: Pipeline; entry: PipelineCandidate }>
  >([]);
  const [pipelinesLoading, setPipelinesLoading] = useState(true);

  useEffect(() => {
    setPipelinesLoading(true);
    getDocs(collection(db, 'pipelines'))
      .then((snap) => {
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
      })
      .catch(() => setPipelineEntries([]))
      .finally(() => setPipelinesLoading(false));
  }, [candidate.id]);

  function stageLabel(stage?: PipelineStage): string {
    if (!stage) return '—';
    return PIPELINE_STAGE_LABELS[stage] ?? stage;
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
    getDocs(query(collection(db, 'applications'), where('candidateId', 'in', candidateIds)))
      .then((snap) => {
        const apps = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ApplicationDoc);
        apps.sort((a, b) => {
          const ta = (a.submittedAt as { seconds?: number })?.seconds ?? 0;
          const tb = (b.submittedAt as { seconds?: number })?.seconds ?? 0;
          return tb - ta;
        });
        setApplicationEntries(apps);
      })
      .catch(() => setApplicationEntries([]))
      .finally(() => setApplicationsLoading(false));
  }, [candidate.id, candidate.code]);

  function applicationStatus(app: ApplicationDoc): { label: string; variant: 'amber' | 'green' | 'red' } {
    if (app.status === 'rejected') return { label: 'Not selected — pre-filter', variant: 'red' };
    if (app.status === 'approved' || app.inPipeline) return { label: 'In pipeline', variant: 'green' };
    return { label: 'Pending review', variant: 'amber' };
  }

  // ── Assessment & Nearwork Score ────────────────────────────────────────────
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [assessmentLoading, setAssessmentLoading] = useState(true);

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
  }, [candidate.id]);

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
  const scoreDate = tsToDate(assessment?.completedAt);
  const scoreValidUntil = scoreDate
    ? new Date(scoreDate.getTime() + NEARWORK_SCORE_VALID_DAYS * 24 * 60 * 60 * 1000)
    : null;
  const scoreExpired = scoreValidUntil ? Date.now() > scoreValidUntil.getTime() : false;
  const scoreDaysLeft = scoreValidUntil
    ? Math.ceil((scoreValidUntil.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;

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
    // Influence + Steadiness lean toward strong communication; Steadiness +
    // Conscientiousness lean toward team/culture fit. Scaled to 0-100.
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
      // Resolve @handles in the note to staff user ids
      const handles = Array.from(noteText.matchAll(/@(\w+)/g)).map((m) => m[1].toLowerCase());
      const mentions = staff.filter((u) => handles.includes(u.handle)).map((u) => u.id);
      await addDoc(collection(db, 'candidateNotes'), {
        candidateId: candidate.id,
        body: noteText,
        mentions,
        createdAt: serverTimestamp(),
      });
      setNoteText('');
      showToast('Note added', 'success');
      const snap = await getDocs(
        query(collection(db, 'candidateNotes'), where('candidateId', '==', candidate.id))
      );
      setNotes(
        snap.docs
          .map(
            (d) =>
              ({ id: d.id, ...d.data() } as {
                id: string;
                body: string;
                authorName?: string;
                createdAt?: unknown;
              })
          )
          .sort((a, b) => {
            const ta = (a.createdAt as { seconds?: number })?.seconds ?? 0;
            const tb = (b.createdAt as { seconds?: number })?.seconds ?? 0;
            return tb - ta;
          })
      );
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

  return (
    <>
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      {/* Left: details */}
      <div className="space-y-5">
        {/* Bio card */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <div className="flex items-start gap-4">
            {candidate.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={candidate.photoUrl}
                alt={candidate.name}
                className="h-14 w-14 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-800 text-white"
                style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}
              >
                {initials(candidate.name)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-700 text-[var(--black)]">{candidate.name}</h2>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(candidate.code ?? candidate.id);
                    showToast(`Candidate ID ${candidate.code ?? candidate.id} copied`, 'success');
                  }}
                  title="Copy candidate ID"
                  className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[10px] font-600 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
                >
                  {candidate.code ?? candidate.id}
                </button>
              </div>
              <p className="text-xs text-[var(--mid)]">
                {candidate.currentRole ?? '—'}
                {candidate.currentCompany ? ` at ${candidate.currentCompany}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--light)]">
                {candidate.email && (
                  <a
                    href={`mailto:${candidate.email}`}
                    className="flex items-center gap-1 hover:text-[var(--green)]"
                  >
                    <Mail className="h-3 w-3" />
                    {candidate.email}
                  </a>
                )}
                {candidate.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    {candidate.phone}
                  </span>
                )}
                {candidate.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {candidate.location}
                  </span>
                )}
                {linkedInUrl && (
                  <a
                    href={linkedInUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[var(--green)] hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    LinkedIn
                  </a>
                )}
              </div>
            </div>
            {candidate.status && <Badge label={candidate.status} variant="status" />}
          </div>

          {/* Actions: CV + WhatsApp */}
          <div className="mt-4 flex flex-wrap gap-2">
            {(candidate.resumeUrl || candidate.cvUrl) ? (
              <a
                href={candidate.resumeUrl || candidate.cvUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs font-600 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
              >
                <FileText className="h-3.5 w-3.5" />
                View CV
              </a>
            ) : (
              <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs font-500 text-[var(--light)]">
                <FileText className="h-3.5 w-3.5" />
                No CV on file
              </span>
            )}
            <button
              type="button"
              disabled
              title="WhatsApp messaging is coming soon"
              className="flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-500 text-[var(--light)] opacity-70"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              WhatsApp (coming soon)
            </button>
          </div>

          {candidate.skills && candidate.skills.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {candidate.skills.map((s, i) => (
                <span
                  key={i}
                  className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-xs font-500 text-[var(--mid)]"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* English assessment — staff-entered level + comments, visible to the client */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-600 text-[var(--black)]">
              <Volume2 className="h-4 w-4 text-[var(--green)]" />
              English assessment
            </h3>
            <button
              type="button"
              onClick={openEnglishModal}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-600 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
            >
              <Pencil className="h-3.5 w-3.5" />
              {englishScore ? 'Edit' : 'Add assessment'}
            </button>
          </div>
          {englishScore ? (
            <div className="mt-3 flex items-start gap-3">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-800 text-white"
                style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}
              >
                {englishScore.level}
              </div>
              <div className="min-w-0">
                <p className="text-xs leading-relaxed text-[var(--mid)]">{englishScore.feedback}</p>
                {(englishScore.assessedBy || englishScore.assessedAt) && (
                  <p className="mt-1.5 text-[10px] text-[var(--light)]">
                    {englishScore.assessedBy ? `Assessed by ${englishScore.assessedBy}` : 'Assessed'}
                    {englishScore.assessedAt ? ` · ${fmtDate(englishScore.assessedAt)}` : ''}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-[var(--light)]">
              No English level recorded yet. Add a CEFR level and comments — this is shown to the client.
            </p>
          )}
        </div>

        {/* Hired banner — link to the placement / contractor profile */}
        {placement && (
          <a
            href={`/hired/${placement.id}`}
            className="group flex items-center justify-between gap-3 rounded-2xl border p-4 transition-colors hover:border-[var(--green)]"
            style={{ borderColor: 'var(--green)', background: 'rgba(22,160,133,0.06)' }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
                style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}
              >
                <Briefcase className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-700 text-[var(--black)]">
                  Hired{placement.orgName ? ` at ${placement.orgName}` : ''}
                </p>
                <p className="truncate text-[10px] text-[var(--mid)]">
                  {placement.openingTitle ?? 'Placement'}
                  {placement.startDate ? ` · since ${fmtDate(placement.startDate)}` : ''}
                </p>
              </div>
            </div>
            <span className="flex items-center gap-1 text-xs font-600 text-[var(--green)]">
              View hired profile
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </a>
        )}

        {/* Nearwork Score & assessment */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-600 text-[var(--black)]">
            <Award className="h-4 w-4 text-[var(--green)]" />
            Nearwork Score &amp; assessment
          </h3>

          {assessmentLoading ? (
            <div className="flex h-16 items-center justify-center">
              <Spinner size="sm" />
            </div>
          ) : !assessment ? (
            <p className="py-4 text-center text-xs text-[var(--light)]">
              No assessment on file yet.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Score header */}
              <div className="flex items-stretch gap-3">
                <div className="flex flex-col items-center justify-center rounded-xl bg-[var(--bg)] px-5 py-3">
                  <span className="text-3xl font-800 leading-none text-[var(--black)]">
                    {nearworkScore != null ? nearworkScore : '—'}
                  </span>
                  <span className="mt-1 text-[9px] font-600 uppercase tracking-wider text-[var(--light)]">
                    Nearwork Score
                  </span>
                </div>
                <div className="flex flex-1 flex-col justify-center gap-1.5">
                  {nearworkScore != null && scoreValidUntil ? (
                    scoreExpired ? (
                      <Badge label="Score expired — re-assess" variant="amber" />
                    ) : (
                      <Badge
                        label={`Valid ${scoreDaysLeft}d · until ${fmtDate(scoreValidUntil.toISOString())}`}
                        variant="green"
                      />
                    )
                  ) : (
                    <span className="text-[10px] text-[var(--light)]">
                      Not scored yet — scored after the assessment is completed
                    </span>
                  )}
                  <p className="text-[10px] text-[var(--light)]">
                    Nearwork Scores are valid for {NEARWORK_SCORE_VALID_DAYS} days from completion.
                  </p>
                </div>
              </div>

              {/* Technical + DISC */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-[var(--border)] p-3">
                  <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                    Technical
                  </p>
                  <p className="mt-0.5 font-700 text-[var(--black)]">
                    {assessment.technicalScore != null
                      ? `${assessment.technicalScore}/50 · ${Math.round((assessment.technicalScore / 50) * 100)}%`
                      : '—'}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--border)] p-3">
                  <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                    DISC style
                  </p>
                  <p className="mt-0.5 font-700 text-[var(--black)]">
                    {assessment.discStyle
                      ? `${assessment.discStyle} — ${DISC_LABELS[assessment.discStyle].name}`
                      : '—'}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[var(--light)]">
                  {assessment.completedAt
                    ? `Completed ${fmtDate(assessment.completedAt as Timestamp | string)}`
                    : 'Not completed yet'}
                </span>
                <a
                  href="/assessments"
                  className="flex items-center gap-1 text-[10px] font-600 text-[var(--green)] hover:underline"
                >
                  View in assessments
                  <ArrowRight className="h-3 w-3" />
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Skills radar */}
        {hasRadarData && (
          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-600 text-[var(--black)]">
              <Activity className="h-4 w-4 text-[var(--green)]" />
              Skills radar
            </h3>
            <p className="mb-3 text-[10px] text-[var(--light)]">
              Auto-generated from assessment, English &amp; experience data.
            </p>
            <div className="flex justify-center">
              <RadarChart data={radarData} />
            </div>
          </div>
        )}

        {/* Pipelines & openings */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-600 text-[var(--black)]">
            <GitBranch className="h-4 w-4 text-[var(--green)]" />
            Pipelines &amp; openings
          </h3>

          {pipelinesLoading ? (
            <div className="flex h-16 items-center justify-center">
              <Spinner size="sm" />
            </div>
          ) : pipelineEntries.length === 0 ? (
            <p className="py-4 text-center text-xs text-[var(--light)]">
              Not in any pipeline yet.
            </p>
          ) : (
            <div className="space-y-2.5">
              {pipelineEntries.map(({ pipeline, entry }) => {
                const notSelected = entry.stage === 'not-selected';
                const furthest = entry.furthestStage ?? entry.stage;
                return (
                  <a
                    key={pipeline.id}
                    href={`/pipeline?focus=${encodeURIComponent(pipeline.code)}`}
                    className="group block rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5 transition-colors hover:border-[var(--green)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-700 text-[var(--black)]">
                          {pipeline.title}
                        </p>
                        <p className="mt-0.5 truncate text-[10px] text-[var(--light)]">
                          {pipeline.orgName ?? '—'} · {pipeline.code}
                        </p>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--light)] transition-colors group-hover:text-[var(--green)]" />
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {notSelected ? (
                        <Badge label="Not Selected" variant="neutral" />
                      ) : (
                        <Badge label={stageLabel(entry.stage)} variant="green" />
                      )}
                      <span className="text-[10px] text-[var(--light)]">
                        Furthest: <span className="font-600 text-[var(--mid)]">{stageLabel(furthest)}</span>
                      </span>
                      {pipeline.status && pipeline.status !== 'active' && (
                        <span className="text-[10px] capitalize text-[var(--light)]">· {pipeline.status}</span>
                      )}
                    </div>

                    {notSelected && entry.dropOffReason && (
                      <div className="mt-2 rounded-lg border border-red-100 bg-red-50 px-2.5 py-2">
                        <p className="text-[10px] font-700 uppercase tracking-wider text-red-600">
                          Fell off · {DROP_OFF_REASON_LABELS[entry.dropOffReason]}
                        </p>
                        {entry.dropOffNote && (
                          <p className="mt-0.5 text-[11px] text-[var(--mid)]">{entry.dropOffNote}</p>
                        )}
                      </div>
                    )}

                    {entry.englishScore && (
                      <p className="mt-2 text-[10px] text-[var(--light)]">
                        English: <span className="font-600 text-[var(--mid)]">{entry.englishScore.level}</span>
                      </p>
                    )}
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* Applications */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-600 text-[var(--black)]">
            <Inbox className="h-4 w-4 text-[var(--green)]" />
            Applications
          </h3>

          {applicationsLoading ? (
            <div className="flex h-16 items-center justify-center">
              <Spinner size="sm" />
            </div>
          ) : applicationEntries.length === 0 ? (
            <p className="py-4 text-center text-xs text-[var(--light)]">
              No applications submitted yet.
            </p>
          ) : (
            <div className="space-y-2.5">
              {applicationEntries.map((app) => {
                const { label, variant } = applicationStatus(app);
                const roleTitle = app.openingTitle || app.jobTitle || app.title || app.openingCode || 'Unknown role';
                return (
                  <div
                    key={app.id}
                    className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-700 text-[var(--black)]">{roleTitle}</p>
                        {app.openingCode && (
                          <p className="mt-0.5 truncate text-[10px] text-[var(--light)]">{app.openingCode}</p>
                        )}
                      </div>
                      <Badge label={label} variant={variant} />
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--light)]">
                      <span>Applied {fmtDate(app.submittedAt)} · {fmtRelative(app.submittedAt)}</span>
                      {app.status === 'rejected' && app.rejectedAt && (
                        <span>· Rejected {fmtRelative(app.rejectedAt)}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Work history (Jobs applicants) */}
        {Array.isArray(candidate.workHistory) && candidate.workHistory.some(w => w.company || w.title) && (
          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <h3 className="mb-3 text-sm font-600 text-[var(--black)]">Work history</h3>
            <div className="space-y-3">
              {candidate.workHistory.filter(w => w.company || w.title).map((w, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bg)] text-[10px] font-800 text-[var(--mid)]">
                    {i + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-600 text-[var(--black)]">{w.title || '—'}</p>
                    <p className="text-[11px] text-[var(--mid)]">{w.company || '—'}</p>
                    {(w.from || w.to) && (
                      <p className="mt-0.5 text-[10px] text-[var(--light)]">
                        {w.from || '?'} → {w.to === 'present' ? 'Present' : w.to || '?'}
                      </p>
                    )}
                    {w.contact && (
                      <p className="mt-0.5 text-[10px] text-[var(--light)]">Contact: {w.contact}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Languages */}
        {Array.isArray(candidate.languages) && candidate.languages.length > 0 && (
          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-600 text-[var(--black)]">
              <Languages className="h-4 w-4 text-blue-500" /> Languages
            </h3>
            <div className="flex flex-wrap gap-2">
              {candidate.languages.map((lang) => (
                <span
                  key={lang}
                  className="flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-600 text-blue-700"
                >
                  <Languages className="h-3 w-3" />{lang}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Certifications & courses */}
        {Array.isArray(candidate.certifications) && candidate.certifications.length > 0 && (
          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-600 text-[var(--black)]">
              <GraduationCap className="h-4 w-4 text-amber-500" /> Certifications &amp; courses
            </h3>
            <div className="space-y-2.5">
              {candidate.certifications.map((c, i) => (
                <div key={i} className="flex gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-xs font-800 text-amber-600">
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
        {candidate.summary && (
          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <h3 className="mb-2 text-sm font-600 text-[var(--black)]">Summary</h3>
            <p className="text-xs leading-relaxed text-[var(--mid)]">{candidate.summary}</p>
          </div>
        )}

        {/* Gathered info / details */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h3 className="mb-3 text-sm font-600 text-[var(--black)]">Details</h3>
          <div className="grid gap-3 sm:grid-cols-2 text-xs">
            {(candidate.city || candidate.location) && (
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">City / Location</p>
                <p className="mt-0.5 text-[var(--black)]">{candidate.city || candidate.location}</p>
              </div>
            )}
            {candidate.english && (
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">English level</p>
                <p className="mt-0.5 text-[var(--black)]">{candidate.english}</p>
              </div>
            )}
            {(candidate.expectedSalaryAmount != null || candidate.expectedSalary != null) && (
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Expected salary</p>
                <p className="mt-0.5 text-[var(--black)]">
                  {candidate.expectedSalaryAmount
                    ? `${fmtCurrency(Number(candidate.expectedSalaryAmount), candidate.expectedSalaryCurrency || 'USD')}/mo`
                    : typeof candidate.expectedSalary === 'number'
                      ? `${fmtCurrency(candidate.expectedSalary, 'USD')}/mo`
                      : String(candidate.expectedSalary)}
                </p>
              </div>
            )}
            {candidate.phone && (
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Phone</p>
                <p className="mt-0.5 text-[var(--black)]">{candidate.phone}</p>
              </div>
            )}
            {typeof candidate.experience === 'number' && (
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Experience
                </p>
                <p className="mt-0.5 text-[var(--black)]">{candidate.experience} years</p>
              </div>
            )}
            {candidate.createdAt && (
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Joined Nearwork
                </p>
                <p className="mt-0.5 text-[var(--black)]">
                  {fmtDate(candidate.createdAt as Timestamp | string | undefined)}
                </p>
              </div>
            )}
            {candidate.source && (
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Source
                </p>
                <p className="mt-0.5 text-[var(--black)]">{candidate.source}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right: notes */}
      <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h3 className="mb-3 text-sm font-600 text-[var(--black)]">Notes</h3>
        <div className="relative">
          <textarea
            ref={noteRef}
            value={noteText}
            onChange={(e) => onNoteChange(e.target.value, e.target.selectionStart)}
            onBlur={() => setTimeout(() => setMentionOpen(false), 150)}
            placeholder="Add a note... type @ to mention a Nearwork teammate"
            rows={3}
            className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)] focus:bg-white"
          />
          {mentionOpen && mentionMatches.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-lg">
              <p className="border-b border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
                Nearwork team
              </p>
              {mentionMatches.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(u);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--bg)]"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-700 text-white"
                    style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}
                  >
                    {u.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-600 text-[var(--black)]">{u.name}</span>
                    <span className="block truncate text-[10px] text-[var(--light)]">
                      @{u.handle} · {u.role}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={addNote}
          disabled={savingNote || !noteText.trim()}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-600 text-white disabled:opacity-50"
          style={{ background: 'var(--green)' }}
        >
          {savingNote && <Spinner size="sm" />}
          Add note
        </button>

        <div className="mt-4 space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="rounded-lg bg-[var(--bg)] p-3">
              <p className="text-xs text-[var(--black)]">{n.body}</p>
              <p className="mt-1.5 text-[10px] text-[var(--light)]">
                {n.authorName ?? 'Nearwork team'} ·{' '}
                {fmtRelative(n.createdAt as Timestamp | string | undefined)}
              </p>
            </div>
          ))}
          {notes.length === 0 && (
            <p className="text-center text-xs text-[var(--light)]">No notes yet.</p>
          )}
        </div>
      </div>
    </div>

    {/* English assessment edit modal */}
    <Modal
      open={engModalOpen}
      onClose={() => setEngModalOpen(false)}
      title={englishScore ? 'Edit English assessment' : 'Add English assessment'}
      size="md"
    >
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
          <button
            type="button"
            onClick={() => setEngModalOpen(false)}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={saveEnglishAssessment}
            disabled={engSaving || !engFeedback.trim()}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
            style={{ background: 'var(--green)' }}
          >
            {engSaving && <Spinner size="sm" />}
            Save
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
