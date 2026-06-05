'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, LogOut, Search, User, X } from 'lucide-react';
import {
  auth, signOut, db, collection, getDocs,
  onSnapshot, query, where, orderBy, limit, doc, updateDoc,
} from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { initials, fmtRelative } from '@/lib/utils';
import type { Notification as AppNotification } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  id: string;
  label: string;
  sub: string;
  type: 'Candidate' | 'Organization' | 'Opening' | 'Pipeline';
  href: string;
}

// ─── Global search ────────────────────────────────────────────────────────────

function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q || q.length < 2) { setResults([]); setOpen(false); return; }

    const timer = setTimeout(() => runSearch(q), 200);
    return () => clearTimeout(timer);
  }, [query]);

  async function runSearch(q: string) {
    setSearching(true);
    try {
      const [cSnap, oSnap, opSnap, pSnap] = await Promise.all([
        getDocs(collection(db, 'candidates')),
        getDocs(collection(db, 'organizations')),
        getDocs(collection(db, 'openings')),
        getDocs(collection(db, 'pipelines')),
      ]);

      const res: SearchResult[] = [];

      cSnap.docs.forEach((d) => {
        const data = d.data();
        const name = (data.name ?? '') as string;
        const email = (data.email ?? '') as string;
        if (name.toLowerCase().includes(q) || email.toLowerCase().includes(q)) {
          res.push({ id: d.id, label: name, sub: email, type: 'Candidate', href: '/candidates' });
        }
      });
      oSnap.docs.forEach((d) => {
        const data = d.data();
        const name = (data.name ?? '') as string;
        const industry = (data.industry ?? '') as string;
        if (name.toLowerCase().includes(q) || industry.toLowerCase().includes(q)) {
          res.push({ id: d.id, label: name, sub: industry || 'Organization', type: 'Organization', href: '/organizations' });
        }
      });
      opSnap.docs.forEach((d) => {
        const data = d.data();
        const title = (data.title ?? '') as string;
        const orgName = (data.orgName ?? '') as string;
        if (title.toLowerCase().includes(q) || orgName.toLowerCase().includes(q)) {
          res.push({ id: d.id, label: title, sub: orgName, type: 'Opening', href: '/openings' });
        }
      });
      pSnap.docs.forEach((d) => {
        const data = d.data();
        const title = (data.title ?? '') as string;
        const code = (data.code ?? '') as string;
        if (title.toLowerCase().includes(q) || code.toLowerCase().includes(q)) {
          res.push({ id: d.id, label: title, sub: code, type: 'Pipeline', href: '/pipeline' });
        }
      });

      setResults(res.slice(0, 8));
      setOpen(res.length > 0);
    } catch {
      // silently fail search
    } finally {
      setSearching(false);
    }
  }

  const TYPE_COLORS: Record<SearchResult['type'], string> = {
    Candidate: 'bg-blue-100 text-blue-700',
    Organization: 'bg-amber-100 text-amber-700',
    Opening: 'bg-emerald-100 text-emerald-700',
    Pipeline: 'bg-purple-100 text-purple-700',
  };

  return (
    <div ref={containerRef} className="relative hidden md:block">
      <div className="flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 focus-within:border-[var(--green)] focus-within:bg-white focus-within:shadow-sm transition-all">
        <Search className="h-4 w-4 shrink-0 text-[var(--light)]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search candidates, orgs, openings, pipelines…"
          className="w-72 bg-transparent text-sm outline-none placeholder:text-[var(--light)]"
        />
        {searching && (
          <div className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border border-[var(--light)] border-t-[var(--green)]" />
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-[420px] overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-lg">
          {results.map((r) => (
            <button
              key={`${r.type}-${r.id}`}
              onClick={() => {
                router.push(r.href);
                setQuery('');
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg)]"
            >
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-600 text-[var(--black)]">{r.label}</p>
                <p className="truncate text-xs text-[var(--light)]">{r.sub}</p>
              </div>
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-700 uppercase tracking-wider ${TYPE_COLORS[r.type]}`}>
                {r.type}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main nav ─────────────────────────────────────────────────────────────────

export function Nav() {
  const { user, profile } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const bellRef = useRef<HTMLDivElement>(null);

  const displayName =
    profile?.name ?? user?.displayName ?? user?.email?.split('@')[0] ?? 'Admin';

  // Subscribe to unread notifications for the current admin user
  useEffect(() => {
    if (!profile?.id) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', profile.id),
      where('read', '==', false),
      orderBy('createdAt', 'desc'),
      limit(20),
    );
    const unsub = onSnapshot(q, (snap) => {
      setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AppNotification)));
    }, () => {/* silently fail */});
    return unsub;
  }, [profile?.id]);

  // Close bell dropdown on outside click
  useEffect(() => {
    if (!bellOpen) return;
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [bellOpen]);

  async function dismissNotification(id: string) {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch {/* silently fail */}
  }

  async function dismissAll() {
    await Promise.allSettled(notifications.map((n) => updateDoc(doc(db, 'notifications', n.id), { read: true })));
  }

  async function handleSignOut() {
    await signOut(auth);
    window.location.href = '/login';
  }

  const unreadCount = notifications.length;

  return (
    <header
      className="fixed left-0 right-0 top-0 z-50 flex items-center justify-between border-b border-[var(--border)] bg-white px-5"
      style={{ height: 'var(--nav-h)' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2">
        <span
          className="text-base font-800 tracking-tight"
          style={{ color: 'var(--green)' }}
        >
          nearwork
        </span>
        <span className="rounded bg-[var(--bg)] px-1.5 py-0.5 text-[10px] font-600 text-[var(--light)]">
          ADMIN
        </span>
      </div>

      {/* Global search */}
      <GlobalSearch />

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {/* Notifications Bell */}
        <div ref={bellRef} className="relative">
          <button
            onClick={() => setBellOpen((v) => !v)}
            className="relative rounded-lg p-2 text-[var(--light)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--mid)]"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-700 text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {bellOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setBellOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-80 overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-lg">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                  <span className="text-xs font-700 text-[var(--black)]">Notifications</span>
                  {notifications.length > 0 && (
                    <button onClick={dismissAll} className="text-[10px] text-[var(--light)] hover:text-[var(--mid)]">
                      Mark all read
                    </button>
                  )}
                </div>
                {/* Notification list */}
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-[var(--light)]">
                    No new notifications
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto divide-y divide-[var(--border)]">
                    {notifications.map((n) => (
                      <div key={n.id} className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--bg)]">
                        <div className="mt-0.5 flex-1 min-w-0">
                          {n.link ? (
                            <a
                              href={n.link}
                              onClick={() => { dismissNotification(n.id); setBellOpen(false); }}
                              className="block text-xs font-600 text-[var(--black)] hover:text-[var(--green)] truncate"
                            >
                              {n.title}
                            </a>
                          ) : (
                            <p className="text-xs font-600 text-[var(--black)] truncate">{n.title}</p>
                          )}
                          {n.body && (
                            <p className="mt-0.5 text-[10px] text-[var(--light)] line-clamp-2">{n.body}</p>
                          )}
                          {n.createdAt && (
                            <p className="mt-0.5 text-[9px] text-[var(--light)]">
                              {fmtRelative(n.createdAt as Parameters<typeof fmtRelative>[0])}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => dismissNotification(n.id)}
                          className="mt-0.5 flex-shrink-0 rounded p-0.5 text-[var(--light)] hover:bg-[var(--bg)] hover:text-[var(--mid)]"
                          title="Dismiss"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-[var(--bg)]"
          >
            {profile?.photoUrl ? (
              <img src={profile.photoUrl} alt={displayName} className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-700 text-white"
                style={{ background: 'var(--green)' }}
              >
                {initials(displayName)}
              </div>
            )}
            <span className="hidden text-xs font-500 text-[var(--mid)] sm:block">
              {displayName}
            </span>
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-xl border border-[var(--border)] bg-white py-1 shadow-lg">
                <div className="border-b border-[var(--border)] px-4 py-2.5">
                  <p className="text-xs font-600 text-[var(--black)]">{displayName}</p>
                  <p className="text-xs text-[var(--light)]">{user?.email}</p>
                </div>
                <a
                  href="/profile"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-xs text-[var(--mid)] transition-colors hover:bg-[var(--bg)]"
                >
                  <User className="h-3.5 w-3.5" />
                  My profile
                </a>
                <button
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2 px-4 py-2 text-xs text-[var(--mid)] transition-colors hover:bg-[var(--bg)]"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
