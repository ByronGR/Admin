'use client';

import { useState, useEffect, useRef } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { fmtRelative, initials } from '@/lib/utils';
import { Send, Search, MessageCircle } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConvSummary {
  id: string;
  phone: string;
  name?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount?: number;
}

interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  createdAt?: string;
  status?: string;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(path: string, opts?: RequestInit) {
  const r = await fetch(`https://admin.nearwork.co/api${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MessagesPage() {
  const { showToast } = useToast();
  const [conversations, setConversations] = useState<ConvSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ConvSummary | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (selected) loadMessages(selected.id);
  }, [selected]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadConversations() {
    setLoading(true);
    try {
      const data = await apiFetch('/messages/conversation');
      setConversations(data.conversations ?? []);
    } catch {
      // Fallback: show empty state gracefully
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadMessages(id: string) {
    setMessagesLoading(true);
    try {
      const data = await apiFetch(`/messages/conversation?id=${id}`);
      setMessages(data.messages ?? []);
    } catch {
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  }

  async function sendReply() {
    if (!replyText.trim() || !selected) return;
    setSending(true);
    const body = replyText.trim();
    setReplyText('');
    try {
      await apiFetch('/messages/whatsapp/send', {
        method: 'POST',
        body: JSON.stringify({ to: selected.phone, body }),
      });
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          direction: 'outbound',
          body,
          createdAt: new Date().toISOString(),
          status: 'sent',
        },
      ]);
    } catch {
      showToast('Failed to send message', 'error');
    } finally {
      setSending(false);
    }
  }

  const filtered = conversations.filter((c) => {
    const q = search.toLowerCase();
    return !q || [c.name, c.phone, c.lastMessage].join(' ').toLowerCase().includes(q);
  });

  return (
    <MainLayout>
      <div className="flex h-[calc(100vh-var(--nav-h)-48px)] overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
        {/* Sidebar */}
        <div className="flex w-72 shrink-0 flex-col border-r border-[var(--border)]">
          <div className="border-b border-[var(--border)] p-4">
            <h1 className="text-sm font-700 text-[var(--black)]">WhatsApp Messages</h1>
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--light)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations..."
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] py-2 pl-8 pr-3 text-xs outline-none focus:border-[var(--green)]"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex h-20 items-center justify-center">
                <Spinner size="sm" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-xs text-[var(--light)]">
                No conversations yet.
              </div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className={`flex w-full items-center gap-3 border-b border-[var(--border)] p-4 text-left hover:bg-[var(--bg)] ${selected?.id === c.id ? 'bg-[var(--green-soft)]' : ''}`}
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-700 text-white"
                    style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}
                  >
                    {initials(c.name ?? c.phone)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className="truncate text-xs font-600 text-[var(--black)]">
                        {c.name ?? c.phone}
                      </p>
                      {c.unreadCount ? (
                        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-700 text-white" style={{ background: 'var(--green)' }}>
                          {c.unreadCount}
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-[10px] text-[var(--light)]">
                      {c.lastMessage ?? 'No messages yet'}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Conversation */}
        {!selected ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <MessageCircle className="mx-auto h-10 w-10 text-[var(--border)]" />
              <p className="mt-3 text-sm text-[var(--light)]">Select a conversation</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col">
            {/* Conversation header */}
            <div className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-3">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-700 text-white"
                style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}
              >
                {initials(selected.name ?? selected.phone)}
              </div>
              <div>
                <p className="text-sm font-600 text-[var(--black)]">{selected.name ?? selected.phone}</p>
                <p className="text-[10px] text-[var(--light)]">{selected.phone}</p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {messagesLoading ? (
                <div className="flex justify-center">
                  <Spinner size="sm" />
                </div>
              ) : messages.length === 0 ? (
                <p className="text-center text-xs text-[var(--light)]">No messages yet.</p>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[70%] rounded-2xl px-4 py-2.5 text-xs ${
                        m.direction === 'outbound'
                          ? 'rounded-br-none text-white'
                          : 'rounded-bl-none bg-[var(--bg)] text-[var(--black)]'
                      }`}
                      style={m.direction === 'outbound' ? { background: 'var(--green)' } : {}}
                    >
                      <p>{m.body}</p>
                      {m.createdAt && (
                        <p className={`mt-1 text-[9px] ${m.direction === 'outbound' ? 'text-white/70' : 'text-[var(--light)]'}`}>
                          {fmtRelative(m.createdAt)}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>

            {/* Reply box */}
            <div className="flex items-end gap-3 border-t border-[var(--border)] p-4">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendReply();
                  }
                }}
                placeholder="Type a message... (Enter to send)"
                rows={2}
                className="flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)] focus:bg-white"
              />
              <button
                onClick={sendReply}
                disabled={sending || !replyText.trim()}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-white disabled:opacity-50"
                style={{ background: 'var(--green)' }}
              >
                {sending ? <Spinner size="sm" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
