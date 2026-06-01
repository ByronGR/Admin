'use client';

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKE,
  type ReactNode,
} from 'react';
import {
  auth,
  db,
  collection,
  query,
  where,
  limit,
  addDoc,
  updateDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  normalizeStaffRole,
} from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/components/ui/toast';
import { Modal } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { STAFF_ROLE_LABELS } from '@/lib/types';
import type { Pipeline, PipelineCandidate } from '@/lib/types';
import {
  Send,
  Lock,
  Pin,
  Search,
  SmilePlus,
  Calendar,
  Star,
  FileText,
  X,
  MessageCircle,
} from 'lucide-react';

// ─── Local types ──────────────────────────────────────────────────────────────

interface ChatReaction {
  emoji: string;
  userIds: string[];
}

interface ChatAttachment {
  name: string;
  size: string;
}

interface ChatMessage {
  id: string;
  pipelineCode: string;
  kind: 'msg' | 'system' | 'interview';
  authorId: string;
  authorName: string;
  authorInitials: string;
  authorOrg: 'nearwork' | 'client';
  body?: string;
  text?: string;
  internal?: boolean;
  pinned?: boolean;
  reactions?: ChatReaction[];
  attachments?: ChatAttachment[];
  // interview
  candidateId?: string;
  candidateName?: string;
  when?: string;
  withWho?: string[];
  createdAt?: { seconds: number; toDate(): Date } | null;
}

interface MentionUser {
  id: string;
  name: string;
  initials: string;
  handle: string;
  role?: string;
  kind: 'nearwork' | 'partner';
}

const QUICK_EMOJIS = ['👍', '❤️', '🎉', '🙌', '👀', '🚀'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMsgTime(ts: { seconds: number; toDate(): Date } | null | undefined): string {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today · ${time}`;
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `Yesterday · ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
}

function slugify(name: string) {
  return name.toLowerCase().replace(/\s+/g, '-');
}

function getInitialsStr(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ─── Render message body (@ and / tokens) ────────────────────────────────────

function renderBody(
  text: string,
  candidates: PipelineCandidate[],
  onOpenCandidate: (id: string) => void
): ReactNode[] {
  const parts = text.split(/(@[\w.]+|\/[\w-]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      return (
        <span
          key={i}
          className="rounded px-0.5 font-600"
          style={{ background: 'rgba(22,160,133,0.12)', color: 'var(--green)' }}
        >
          {part}
        </span>
      );
    }
    if (part.startsWith('/')) {
      const slug = part.slice(1);
      const cand = candidates.find((c) => slugify(c.name) === slug);
      if (cand) {
        return (
          <button
            key={i}
            onClick={() => onOpenCandidate(cand.candidateId)}
            className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 align-baseline text-[12px] font-500 text-[var(--black)] hover:border-[var(--green)] hover:bg-white"
          >
            <span
              className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-700 text-white"
              style={{ background: 'var(--green)' }}
            >
              {getInitialsStr(cand.name)}
            </span>
            {cand.name}
          </button>
        );
      }
    }
    return <span key={i}>{part}</span>;
  });
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PipelineChatPanel({ pipeline }: { pipeline: Pipeline }) {
  const { profile } = useAuth();
  const { showToast } = useToast();

  // Messages
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [msgsLoading, setMsgsLoading] = useState(true);

  // Composer
  const [draft, setDraft] = useState('');
  const [internalMode, setInternalMode] = useState(false);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Autocomplete
  type SlashKind = 'mention' | 'candidate' | null;
  const [slashKind, setSlashKind] = useState<SlashKind>(null);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const [mentionUsers, setMentionUsers] = useState<MentionUser[]>([]);

  // Filters
  const [filter, setFilter] = useState<'all' | 'mentions' | 'pinned'>('all');
  const [search, setSearch] = useState('');

  // Reactions
  const [reactPickerFor, setReactPickerFor] = useState<string | null>(null);

  // Interview modal
  const [interviewModal, setInterviewModal] = useState(false);
  const [intCandidateId, setIntCandidateId] = useState('');
  const [intWhen, setIntWhen] = useState('');
  const [intSubmitting, setIntSubmitting] = useState(false);

  // Candidate mini panel
  const [openCandId, setOpenCandId] = useState<string | null>(null);

  const candidates = pipeline.candidates ?? [];

  // ── Load staff for @mention autocomplete ──────────────────────────────────

  useEffect(() => {
    const orgIds = [pipeline.orgId].filter(Boolean) as string[];
    getDocs(collection(db, 'users'))
      .then((snap) => {
        const users: MentionUser[] = [];
        snap.docs.forEach((d) => {
          const data = d.data() as {
            name?: string;
            email?: string;
            staffRole?: string;
            role?: string;
            jobTitle?: string;
            orgId?: string;
            organizationId?: string;
          };
          const name = data.name ?? data.email ?? '';
          if (!name) return;
          const email = (data.email ?? '').toLowerCase();
          const isStaff = email.endsWith('@nearwork.co');
          const userOrg = data.orgId ?? data.organizationId;
          const isPartnerOfThisOrg = !!userOrg && orgIds.includes(userOrg);
          // Nearwork staff are always mentionable; partner users only if they
          // belong to this pipeline's organization.
          if (!isStaff && !isPartnerOfThisOrg) return;
          users.push({
            id: d.id,
            name,
            initials: getInitialsStr(name),
            handle: name.split(' ')[0].toLowerCase(),
            role: isStaff
              ? (data.jobTitle?.trim() ||
                STAFF_ROLE_LABELS[normalizeStaffRole(data.staffRole ?? data.role ?? 'employee')])
              : (pipeline.orgName ?? 'Partner'),
            kind: isStaff ? 'nearwork' : 'partner',
          });
        });
        setMentionUsers(users);
      })
      .catch(() => {});
  }, [pipeline.orgId, pipeline.orgName]);

  // ── Real-time messages ────────────────────────────────────────────────────

  useEffect(() => {
    if (!pipeline.code) {
      setMessages([]);
      setMsgsLoading(false);
      return;
    }
    // NOTE: query by pipelineCode equality only (no orderBy) so this never needs
    // a composite Firestore index — indexes are managed by hand for this project
    // and a missing pipelineCode+createdAt index would silently break the thread.
    // We sort client-side below.
    const q = query(
      collection(db, 'pipeline_messages'),
      where('pipelineCode', '==', pipeline.code),
      limit(200)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage));
        rows.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
        setMessages(rows);
        setMsgsLoading(false);
      },
      (err) => {
        console.error('[pipeline-chat] failed to read pipeline_messages', err);
        setMsgsLoading(false);
      }
    );
    return unsub;
  }, [pipeline.code]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  // ── Autocomplete logic ────────────────────────────────────────────────────

  const slashMatches = useMemo(() => {
    if (slashKind === null) return [] as Array<MentionUser | { candidateId: string; name: string; slug: string; stage: string }>;
    const q = slashQuery.toLowerCase();
    if (slashKind === 'mention') {
      return mentionUsers
        .filter((u) => u.handle.startsWith(q) || u.name.toLowerCase().includes(q))
        .slice(0, 5);
    }
    return candidates
      .filter((c) => slugify(c.name).startsWith(q) || c.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map((c) => ({ ...c, slug: slugify(c.name) }));
  }, [slashKind, slashQuery, mentionUsers, candidates]);

  function detectTrigger(value: string, caret: number) {
    const upto = value.slice(0, caret);
    const at = /@(\w*)$/.exec(upto);
    const slash = /(^|\s)\/([a-zA-Z0-9-]*)$/.exec(upto);
    if (at) {
      setSlashKind('mention');
      setSlashQuery(at[1].toLowerCase());
      setSlashIndex(0);
    } else if (slash) {
      setSlashKind('candidate');
      setSlashQuery(slash[2].toLowerCase());
      setSlashIndex(0);
    } else {
      setSlashKind(null);
    }
  }

  function handleChange(value: string) {
    setDraft(value);
    detectTrigger(value, inputRef.current?.selectionStart ?? value.length);
  }

  function insertSelection(item: MentionUser | { candidateId: string; name: string; slug: string; stage: string }) {
    const el = inputRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? draft.length;
    const before = draft.slice(0, caret);
    const after = draft.slice(caret);
    const isMention = 'handle' in item;
    const token = isMention
      ? `@${(item as MentionUser).handle} `
      : `/${(item as { slug: string }).slug} `;
    const replaced = isMention
      ? before.replace(/@(\w*)$/, token)
      : before.replace(/(^|\s)\/([a-zA-Z0-9-]*)$/, (_m, p1) => `${p1}${token}`);
    const next = replaced + after;
    setDraft(next);
    setSlashKind(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = replaced.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function onKey(e: ReactKE<HTMLTextAreaElement>) {
    if (slashKind !== null && slashMatches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashMatches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        insertSelection(slashMatches[slashIndex] as any);
        return;
      }
      if (e.key === 'Escape') {
        setSlashKind(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // ── Identity ──────────────────────────────────────────────────────────────
  // Prefer the loaded staff profile, but fall back to the authenticated Firebase
  // user so a logged-in person can always post — even if their `users` doc
  // hasn't resolved yet (e.g. hardcoded super admins with no profile doc).
  function getIdentity(): { id: string; name: string } | null {
    if (profile?.id) {
      return { id: profile.id, name: profile.name ?? profile.email ?? 'You' };
    }
    const u = auth.currentUser;
    if (u?.uid) {
      return { id: u.uid, name: u.displayName || u.email || 'You' };
    }
    return null;
  }

  // ── Send message ──────────────────────────────────────────────────────────

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    const me = getIdentity();
    if (!me) {
      showToast('Still signing you in — try again in a moment', 'error');
      return;
    }
    setSending(true);
    try {
      await addDoc(collection(db, 'pipeline_messages'), {
        pipelineCode: pipeline.code,
        orgId: pipeline.orgId || '',
        kind: 'msg',
        authorId: me.id,
        authorName: me.name,
        authorInitials: getInitialsStr(me.name),
        authorOrg: 'nearwork',
        body,
        internal: internalMode,
        pinned: false,
        reactions: [],
        createdAt: serverTimestamp(),
      });
      setDraft('');
      setSlashKind(null);
    } catch (err) {
      console.error('Pipeline chat: send failed', err);
      const detail = err instanceof Error ? err.message : 'Failed to send message';
      showToast(`Couldn't send: ${detail}`, 'error');
    } finally {
      setSending(false);
    }
  }

  // ── Schedule interview ────────────────────────────────────────────────────

  async function scheduleInterview() {
    if (!intCandidateId || !intWhen.trim()) return;
    const me = getIdentity();
    if (!me) {
      showToast('Still signing you in — try again in a moment', 'error');
      return;
    }
    const cand = candidates.find((c) => c.candidateId === intCandidateId);
    if (!cand) return;
    setIntSubmitting(true);
    try {
      await addDoc(collection(db, 'pipeline_messages'), {
        pipelineCode: pipeline.code,
        orgId: pipeline.orgId || '',
        kind: 'interview',
        authorId: me.id,
        authorName: me.name,
        authorInitials: getInitialsStr(me.name),
        authorOrg: 'nearwork',
        candidateId: cand.candidateId,
        candidateName: cand.name,
        when: intWhen.trim(),
        withWho: [me.name],
        internal: false,
        createdAt: serverTimestamp(),
      });
      setInterviewModal(false);
      setIntCandidateId('');
      setIntWhen('');
    } catch (err) {
      console.error('Pipeline chat: schedule interview failed', err);
      const detail = err instanceof Error ? err.message : 'Failed to schedule interview';
      showToast(`Couldn't schedule: ${detail}`, 'error');
    } finally {
      setIntSubmitting(false);
    }
  }

  // ── Reactions ─────────────────────────────────────────────────────────────

  async function toggleReaction(messageId: string, emoji: string) {
    const me = getIdentity();
    if (!me) return;
    const msg = messages.find((m) => m.id === messageId);
    if (!msg || msg.kind !== 'msg') return;
    const reactions = [...(msg.reactions ?? [])];
    const idx = reactions.findIndex((r) => r.emoji === emoji);
    if (idx === -1) {
      reactions.push({ emoji, userIds: [me.id] });
    } else {
      const r = reactions[idx];
      const has = r.userIds.includes(me.id);
      const userIds = has ? r.userIds.filter((u) => u !== me.id) : [...r.userIds, me.id];
      if (userIds.length === 0) reactions.splice(idx, 1);
      else reactions[idx] = { ...r, userIds };
    }
    try {
      await updateDoc(doc(db, 'pipeline_messages', messageId), { reactions });
    } catch (err) {
      console.error('Pipeline chat: reaction failed', err);
    }
    setReactPickerFor(null);
  }

  // ── Pin ───────────────────────────────────────────────────────────────────

  async function togglePin(messageId: string) {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;
    try {
      await updateDoc(doc(db, 'pipeline_messages', messageId), { pinned: !msg.pinned });
    } catch {}
  }

  // ── Quick action: share candidate ─────────────────────────────────────────

  function shareCandidate() {
    setDraft((d) => `${d}${d && !d.endsWith(' ') ? ' ' : ''}Sharing /`);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        const pos = el.value.length;
        el.setSelectionRange(pos, pos);
        detectTrigger(el.value, pos);
      }
    });
  }

  // ── Request feedback quick action ─────────────────────────────────────────

  function requestFeedback() {
    setDraft('Could you share your feedback on the latest candidates? ');
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // ── Visible messages ──────────────────────────────────────────────────────

  const myHandle = (profile?.name ?? profile?.email ?? '').split(' ')[0].toLowerCase();
  const pinnedMsgs = messages.filter((m) => m.kind === 'msg' && m.pinned);

  const visibleMessages = messages.filter((m) => {
    if (filter === 'pinned') return m.kind === 'msg' && m.pinned;
    if (filter === 'mentions')
      return m.kind === 'msg' && m.body?.toLowerCase().includes(`@${myHandle}`);
    if (search.trim()) {
      const q = search.toLowerCase();
      if (m.kind === 'msg') return m.body?.toLowerCase().includes(q);
      if (m.kind === 'system') return m.text?.toLowerCase().includes(q);
      if (m.kind === 'interview') return m.candidateName?.toLowerCase().includes(q) || m.when?.toLowerCase().includes(q);
      return false;
    }
    return true;
  });

  const openCand = openCandId ? candidates.find((c) => c.candidateId === openCandId) : null;

  // ──────────────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
        {/* Main chat */}
        <div className="flex h-[640px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-700 text-[var(--black)]">Pipeline chat</span>
                <span className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[10px] font-600 text-[var(--mid)]">
                  {pipeline.orgName ?? 'Internal'}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-[var(--light)]">
                {pipeline.code} · visible to Nearwork & client
              </p>
            </div>
            {/* Search */}
            <div className="relative hidden sm:block">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--light)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search messages"
                className="h-8 w-44 rounded-lg border border-[var(--border)] bg-[var(--bg)] pl-7 pr-3 text-xs outline-none focus:border-[var(--green)]"
              />
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
            <div className="flex gap-0.5">
              {(['all', 'mentions', 'pinned'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-2.5 py-1 text-xs capitalize transition-colors ${
                    filter === f
                      ? 'bg-[var(--bg)] font-600 text-[var(--black)]'
                      : 'text-[var(--light)] hover:bg-[var(--bg)] hover:text-[var(--mid)]'
                  }`}
                >
                  {f}
                  {f === 'pinned' && pinnedMsgs.length > 0 && (
                    <span className="ml-1 text-[var(--light)]">{pinnedMsgs.length}</span>
                  )}
                </button>
              ))}
            </div>
            <p className="hidden text-[10px] text-[var(--light)] sm:block">
              Type <kbd className="rounded border border-[var(--border)] bg-[var(--bg)] px-1">/</kbd> for candidates ·{' '}
              <kbd className="rounded border border-[var(--border)] bg-[var(--bg)] px-1">@</kbd> for team
            </p>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
            {msgsLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Spinner size="sm" />
              </div>
            ) : visibleMessages.length === 0 ? (
              <div className="flex h-32 items-center justify-center">
                <p className="text-xs text-[var(--light)]">
                  {search ? 'No results.' : filter !== 'all' ? 'Nothing here.' : 'No messages yet — say hello! 👋'}
                </p>
              </div>
            ) : (
              visibleMessages.map((m) => {
                if (m.kind === 'system') {
                  return (
                    <div
                      key={m.id}
                      className="flex items-center gap-2 py-2 text-[11px] text-[var(--light)]"
                    >
                      <span className="h-px flex-1 bg-[var(--border)]" />
                      <span className="flex items-center gap-1">
                        {renderBody(m.text ?? '', candidates, setOpenCandId)}
                        {m.createdAt && <span>· {fmtMsgTime(m.createdAt)}</span>}
                      </span>
                      <span className="h-px flex-1 bg-[var(--border)]" />
                    </div>
                  );
                }

                if (m.kind === 'interview') {
                  const cand = candidates.find((c) => c.candidateId === m.candidateId);
                  return (
                    <div
                      key={m.id}
                      className="mx-1 my-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5"
                    >
                      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-[var(--light)]">
                        <Calendar className="h-3.5 w-3.5 text-[var(--green)]" />
                        <span>Interview scheduled by {m.authorName}</span>
                        {m.createdAt && <span>· {fmtMsgTime(m.createdAt)}</span>}
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          {cand ? (
                            <button
                              onClick={() => setOpenCandId(cand.candidateId)}
                              className="flex items-center gap-2 text-left"
                            >
                              <span
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-700 text-white"
                                style={{ background: 'var(--green)' }}
                              >
                                {getInitialsStr(cand.name)}
                              </span>
                              <div>
                                <p className="text-sm font-600 text-[var(--black)]">{cand.name}</p>
                                <p className="text-[11px] text-[var(--light)] capitalize">{cand.stage}</p>
                              </div>
                            </button>
                          ) : (
                            <p className="text-sm font-600 text-[var(--black)]">{m.candidateName}</p>
                          )}
                          <p className="mt-2 text-sm font-500 text-[var(--black)]">{m.when}</p>
                          {m.withWho && m.withWho.length > 0 && (
                            <p className="text-[11px] text-[var(--light)]">
                              With {m.withWho.join(', ')}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <a
                            href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`Interview: ${m.candidateName}`)}&details=${encodeURIComponent(m.when ?? '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-center text-[11px] font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
                          >
                            Add to calendar
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                }

                // kind: 'msg'
                const isInternal = m.internal;
                const isMe = m.authorId === profile?.id;

                return (
                  <div
                    key={m.id}
                    className={`group relative flex gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-[var(--bg)] ${
                      isInternal ? 'bg-amber-50/60 hover:bg-amber-50' : ''
                    }`}
                  >
                    {/* Avatar */}
                    <div
                      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-700 text-white"
                      style={{
                        background:
                          m.authorOrg === 'nearwork'
                            ? 'linear-gradient(135deg, var(--green), var(--gd))'
                            : 'linear-gradient(135deg, #6366f1, #818cf8)',
                      }}
                    >
                      {m.authorInitials}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span className="text-xs font-700 text-[var(--black)]">{m.authorName}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-600 ${
                            m.authorOrg === 'nearwork'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-indigo-100 text-indigo-700'
                          }`}
                        >
                          {m.authorOrg === 'nearwork' ? 'Nearwork' : 'Client'}
                        </span>
                        <span className="text-[10px] text-[var(--light)]">
                          {fmtMsgTime(m.createdAt)}
                        </span>
                        {isInternal && (
                          <span className="flex items-center gap-0.5 text-[10px] font-600 text-amber-700">
                            <Lock className="h-2.5 w-2.5" /> Internal
                          </span>
                        )}
                        {m.pinned && (
                          <span className="flex items-center gap-0.5 text-[10px] text-[var(--light)]">
                            <Pin className="h-2.5 w-2.5" /> Pinned
                          </span>
                        )}
                      </div>

                      <div className="mt-0.5 text-sm leading-relaxed text-[var(--black)]">
                        {renderBody(m.body ?? '', candidates, setOpenCandId)}
                      </div>

                      {m.attachments && m.attachments.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {m.attachments.map((a, ai) => (
                            <div
                              key={ai}
                              className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5"
                            >
                              <FileText className="h-4 w-4 text-[var(--light)]" />
                              <div className="text-xs">
                                <p className="font-500 text-[var(--black)]">{a.name}</p>
                                <p className="text-[10px] text-[var(--light)]">{a.size}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {m.reactions && m.reactions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {m.reactions.map((r) => {
                            const mine = profile ? r.userIds.includes(profile.id) : false;
                            return (
                              <button
                                key={r.emoji}
                                onClick={() => toggleReaction(m.id, r.emoji)}
                                className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors ${
                                  mine
                                    ? 'border-[var(--green)] bg-green-50'
                                    : 'border-[var(--border)] bg-white hover:bg-[var(--bg)]'
                                }`}
                              >
                                <span>{r.emoji}</span>
                                <span className={mine ? 'text-[var(--green)]' : 'text-[var(--mid)]'}>
                                  {r.userIds.length}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Hover action bar */}
                    <div className="absolute -top-3 right-3 hidden items-center gap-0.5 rounded-lg border border-[var(--border)] bg-white p-0.5 shadow-sm group-hover:flex">
                      {QUICK_EMOJIS.slice(0, 3).map((e) => (
                        <button
                          key={e}
                          onClick={() => toggleReaction(m.id, e)}
                          className="rounded p-1 text-sm hover:bg-[var(--bg)]"
                        >
                          {e}
                        </button>
                      ))}
                      <button
                        onClick={() => setReactPickerFor(reactPickerFor === m.id ? null : m.id)}
                        className="rounded p-1 text-[var(--light)] hover:bg-[var(--bg)] hover:text-[var(--mid)]"
                      >
                        <SmilePlus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => togglePin(m.id)}
                        className={`rounded p-1 hover:bg-[var(--bg)] ${m.pinned ? 'text-amber-500' : 'text-[var(--light)] hover:text-[var(--mid)]'}`}
                      >
                        <Pin className={`h-3.5 w-3.5 ${m.pinned ? 'fill-amber-400' : ''}`} />
                      </button>
                    </div>

                    {/* Emoji picker */}
                    {reactPickerFor === m.id && (
                      <div className="absolute right-3 top-7 z-20 flex gap-1 rounded-xl border border-[var(--border)] bg-white p-1.5 shadow-lg">
                        {QUICK_EMOJIS.map((e) => (
                          <button
                            key={e}
                            onClick={() => toggleReaction(m.id, e)}
                            className="rounded-lg p-1.5 text-base hover:bg-[var(--bg)]"
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Quick actions bar */}
          <div className="flex flex-wrap gap-1.5 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-2">
            <QuickBtn
              icon={<Calendar className="h-3.5 w-3.5" />}
              label="Schedule interview"
              onClick={() => setInterviewModal(true)}
            />
            <QuickBtn
              icon={<MessageCircle className="h-3.5 w-3.5" />}
              label="Share candidate"
              onClick={shareCandidate}
            />
            <QuickBtn
              icon={<Star className="h-3.5 w-3.5" />}
              label="Request feedback"
              onClick={requestFeedback}
            />
          </div>

          {/* Composer */}
          <div className="relative border-t border-[var(--border)] bg-white p-3">
            {/* Autocomplete dropdown */}
            {slashKind !== null && slashMatches.length > 0 && (
              <div className="absolute bottom-full left-3 mb-2 w-72 overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-lg">
                <div className="border-b border-[var(--border)] px-3 py-2 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
                  {slashKind === 'mention' ? 'Team members' : 'Pipeline candidates'}
                </div>
                {slashMatches.map((item, i) => {
                  const isMention = 'handle' in item;
                  const label = item.name;
                  const sub = isMention
                    ? `@${(item as MentionUser).handle} · ${(item as MentionUser).role}`
                    : `${(item as { stage: string }).stage}`;
                  return (
                    <button
                      key={isMention ? (item as MentionUser).id : (item as { candidateId: string }).candidateId}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        insertSelection(item as any);
                      }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                        i === slashIndex ? 'bg-[var(--bg)]' : 'hover:bg-[var(--bg)]'
                      }`}
                    >
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-700 text-white"
                        style={{
                          background: !isMention
                            ? 'linear-gradient(135deg, #6366f1, #818cf8)'
                            : (item as MentionUser).kind === 'partner'
                            ? 'linear-gradient(135deg, #AF7AC5, #E74C7C)'
                            : 'linear-gradient(135deg, var(--green), var(--gd))',
                        }}
                      >
                        {getInitialsStr(label)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-600 text-[var(--black)]">{label}</p>
                        <p className="truncate text-[10px] text-[var(--light)]">{sub}</p>
                      </div>
                      {isMention && (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-700 ${
                            (item as MentionUser).kind === 'partner'
                              ? 'bg-[#FEF0F5] text-[#E74C7C]'
                              : 'bg-[#E8F8F5] text-[var(--green)]'
                          }`}
                        >
                          {(item as MentionUser).kind === 'partner' ? 'Partner' : 'Nearwork'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <div
              className={`flex items-end gap-2 rounded-xl border px-3 py-2 transition-colors focus-within:border-[var(--green)] ${
                internalMode
                  ? 'border-amber-300 bg-amber-50/50'
                  : 'border-[var(--border)] bg-white'
              }`}
            >
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => handleChange(e.target.value)}
                onKeyDown={onKey}
                rows={1}
                placeholder={
                  internalMode
                    ? 'Internal note — only Nearwork can see this'
                    : 'Message the team — / for candidates, @ for mentions'
                }
                className="max-h-32 flex-1 resize-none bg-transparent text-sm text-[var(--black)] outline-none placeholder:text-[var(--light)]"
              />
              {/* Internal toggle */}
              <button
                onClick={() => setInternalMode((v) => !v)}
                title="Internal note (Nearwork only)"
                className={`rounded-lg p-1.5 transition-colors ${
                  internalMode
                    ? 'bg-amber-400 text-white'
                    : 'text-[var(--light)] hover:bg-[var(--bg)] hover:text-[var(--mid)]'
                }`}
              >
                <Lock className="h-4 w-4" />
              </button>
              {/* Send */}
              <button
                onClick={send}
                disabled={!draft.trim() || sending}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white transition-opacity disabled:opacity-40"
                style={{ background: 'var(--green)' }}
              >
                {sending ? <Spinner size="sm" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-1 px-1 text-[10px] text-[var(--light)]">
              Enter to send · Shift+Enter new line
            </p>
          </div>
        </div>

        {/* Right sidebar */}
        <aside className="hidden h-[640px] flex-col rounded-2xl border border-[var(--border)] bg-white lg:flex">
          {/* Candidates */}
          <div className="border-b border-[var(--border)] px-4 py-3">
            <p className="text-xs font-700 text-[var(--black)]">
              Pipeline candidates{' '}
              <span className="text-[var(--light)]">({candidates.length})</span>
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {candidates.length === 0 ? (
              <p className="py-6 text-center text-xs text-[var(--light)]">No candidates yet.</p>
            ) : (
              candidates.map((c) => (
                <button
                  key={c.candidateId}
                  onClick={() => setOpenCandId(c.candidateId)}
                  className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--bg)]"
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-700 text-white"
                    style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}
                  >
                    {getInitialsStr(c.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-600 text-[var(--black)]">{c.name}</p>
                    <p className="truncate text-[10px] capitalize text-[var(--light)]">{c.stage}</p>
                  </div>
                  {c.score !== undefined && c.score > 0 && (
                    <span
                      className={`shrink-0 rounded-full px-1.5 text-[9px] font-700 ${
                        c.score >= 80
                          ? 'bg-green-100 text-green-700'
                          : c.score >= 60
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-600'
                      }`}
                    >
                      {c.score}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Team */}
          <div className="border-t border-[var(--border)] p-3">
            <p className="mb-2 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
              Team
            </p>
            {[
              { label: pipeline.recruiter, role: 'Recruiter' },
              { label: pipeline.accountManager, role: 'Account manager' },
            ]
              .filter((m) => m.label)
              .map((m) => (
                <div key={m.role} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                  <div className="relative">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-700 text-white"
                      style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}
                    >
                      {getInitialsStr(m.label!)}
                    </span>
                    <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-white bg-green-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-600 text-[var(--black)]">{m.label}</p>
                    <p className="text-[10px] text-[var(--light)]">{m.role}</p>
                  </div>
                </div>
              ))}
          </div>
        </aside>
      </div>

      {/* Schedule interview modal */}
      <Modal
        open={interviewModal}
        onClose={() => { setInterviewModal(false); setIntCandidateId(''); setIntWhen(''); }}
        title="Schedule interview"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
              Candidate *
            </label>
            <select
              value={intCandidateId}
              onChange={(e) => setIntCandidateId(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]"
            >
              <option value="">Select candidate…</option>
              {candidates.map((c) => (
                <option key={c.candidateId} value={c.candidateId}>
                  {c.name} · {c.stage}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
              Date & time *
            </label>
            <input
              value={intWhen}
              onChange={(e) => setIntWhen(e.target.value)}
              placeholder="e.g. Thu, Jun 5 · 10:00–11:00 AM CST"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setInterviewModal(false); setIntCandidateId(''); setIntWhen(''); }}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]"
            >
              Cancel
            </button>
            <button
              onClick={scheduleInterview}
              disabled={!intCandidateId || !intWhen.trim() || intSubmitting}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-50"
              style={{ background: 'var(--green)' }}
            >
              {intSubmitting && <Spinner size="sm" />}
              Post to chat
            </button>
          </div>
        </div>
      </Modal>

      {/* Candidate mini panel */}
      <Modal
        open={!!openCand}
        onClose={() => setOpenCandId(null)}
        title={openCand?.name ?? 'Candidate'}
        size="md"
      >
        {openCand && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">Stage</p>
                <p className="mt-0.5 font-600 capitalize text-[var(--black)]">{openCand.stage}</p>
              </div>
              {openCand.score !== undefined && (
                <div>
                  <p className="text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">Score</p>
                  <p className="mt-0.5 font-700 text-[var(--black)]">{openCand.score}</p>
                </div>
              )}
              {openCand.email && (
                <div className="col-span-2">
                  <p className="text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">Email</p>
                  <p className="mt-0.5 text-[var(--black)]">{openCand.email}</p>
                </div>
              )}
              {openCand.englishScore && (
                <div className="col-span-2 rounded-xl bg-[var(--bg)] p-3">
                  <p className="text-[10px] font-700 uppercase tracking-wider text-[var(--green)]">
                    English — {openCand.englishScore.level}
                  </p>
                  <p className="mt-1 text-xs text-[var(--mid)]">{openCand.englishScore.feedback}</p>
                </div>
              )}
              {openCand.notes && (
                <div className="col-span-2">
                  <p className="text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">Notes</p>
                  <p className="mt-0.5 text-[var(--mid)]">{openCand.notes}</p>
                </div>
              )}
            </div>
            <div className="flex gap-2 border-t border-[var(--border)] pt-3">
              <button
                onClick={() => {
                  setDraft(`/${slugify(openCand.name)} `);
                  setOpenCandId(null);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
              >
                Share in chat
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

// ─── Quick action button ──────────────────────────────────────────────────────

function QuickBtn({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-2.5 py-1 text-[11px] font-500 text-[var(--mid)] transition-colors hover:border-[var(--green)] hover:text-[var(--green)]"
    >
      {icon}
      {label}
    </button>
  );
}
