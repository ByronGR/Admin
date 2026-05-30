'use client';

import { useState, useEffect } from 'react';
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
import type { Candidate, Timestamp } from '@/lib/types';
import { Mail, Phone, MapPin, ExternalLink, FileText, MessageCircle } from 'lucide-react';

// ─── Candidate detail (shared by the /candidates/[id] route) ───────────────────

export function CandidateDetail({ candidate }: { candidate: Candidate }) {
  const { showToast } = useToast();
  const [notes, setNotes] = useState<
    Array<{ id: string; body: string; authorName?: string; createdAt?: unknown }>
  >([]);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

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

  async function addNote() {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await addDoc(collection(db, 'candidateNotes'), {
        candidateId: candidate.id,
        body: noteText,
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
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Add a note... Use @name to mention someone"
          rows={3}
          className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)] focus:bg-white"
        />
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
