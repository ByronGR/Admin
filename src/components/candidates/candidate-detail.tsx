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
} from '@/lib/firebase';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { fmtDate, fmtRelative, initials } from '@/lib/utils';
import { normalizeStaffRole } from '@/lib/firebase';
import { STAFF_ROLE_LABELS, PIPELINE_STAGE_LABELS, DROP_OFF_REASON_LABELS } from '@/lib/types';
import type { Candidate, Timestamp, Pipeline, PipelineCandidate, PipelineStage } from '@/lib/types';
import { Mail, Phone, MapPin, ExternalLink, FileText, MessageCircle, GitBranch, ArrowRight } from 'lucide-react';

// ─── Candidate detail (shared by the /candidates/[id] route) ───────────────────

export function CandidateDetail({ candidate }: { candidate: Candidate }) {
  const { showToast } = useToast();
  const [notes, setNotes] = useState<
    Array<{ id: string; body: string; authorName?: string; createdAt?: unknown }>
  >([]);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

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
              <h2 className="text-lg font-700 text-[var(--black)]">{candidate.name}</h2>
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
            {candidate.resumeUrl ? (
              <a
                href={candidate.resumeUrl}
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

        {/* Gathered info / details */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h3 className="mb-3 text-sm font-600 text-[var(--black)]">Details</h3>
          <div className="grid gap-3 sm:grid-cols-2 text-xs">
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
            {candidate.experience != null && (
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Experience
                </p>
                <p className="mt-0.5 text-[var(--black)]">{candidate.experience} years</p>
              </div>
            )}
            {candidate.expectedSalary != null && (
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Expected salary
                </p>
                <p className="mt-0.5 text-[var(--black)]">
                  ${candidate.expectedSalary.toLocaleString()}/mo
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
  );
}
