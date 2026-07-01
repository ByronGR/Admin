'use client';

// Nearwork Admin redesign — top bar
// 64px white header inside the content column: centered global search + bell
// + user menu. Search/notifications/logout stay wired to real Firebase.

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  auth, signOut, db, collection, getDocs,
  onSnapshot, query, where, orderBy, limit, doc, updateDoc,
} from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { initials, fmtRelative } from '@/lib/utils';
import type { Notification as AppNotification } from '@/lib/types';
import { NW, Icon, MONO } from '@/components/nw/primitives';

// ─── Global search ────────────────────────────────────────────────────────────

type ResultType = 'Organization' | 'Role' | 'Candidate' | 'Hired' | 'Pipeline';

interface SearchResult {
  id: string;
  label: string;
  sub: string;
  type: ResultType;
  href: string;
  init?: string;
  bg: string;
  round?: boolean;
  icon?: string;
}

const TYPE_COLOR: Record<ResultType, string> = {
  Organization: NW.teal600,
  Role: NW.blue500,
  Candidate: NW.violet500,
  Hired: NW.green600,
  Pipeline: '#6366F1',
};

function colorFor(seed: string) {
  const palette = [NW.teal500, NW.rose500, NW.violet500, NW.blue500, NW.teal600, '#EAB308', '#EC5290'];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function GlobalSearch({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const term = q.trim().toLowerCase();
    if (!term || term.length < 2) { setResults([]); setOpen(false); return; }
    const timer = setTimeout(() => runSearch(term), 200);
    return () => clearTimeout(timer);
  }, [q]);

  async function runSearch(term: string) {
    // Each collection is read independently — a failure on one (rules, missing
    // index) must not silently wipe out the whole search.
    const [cRes, oRes, opRes, pRes, hRes] = await Promise.allSettled([
      getDocs(collection(db, 'candidates')),
      getDocs(collection(db, 'organizations')),
      getDocs(collection(db, 'openings')),
      getDocs(collection(db, 'pipelines')),
      getDocs(collection(db, 'placements')),
    ]);
    const cDocs = cRes.status === 'fulfilled' ? cRes.value.docs : [];
    const oDocs = oRes.status === 'fulfilled' ? oRes.value.docs : [];
    const opDocs = opRes.status === 'fulfilled' ? opRes.value.docs : [];
    const pDocs = pRes.status === 'fulfilled' ? pRes.value.docs : [];
    const hDocs = hRes.status === 'fulfilled' ? hRes.value.docs : [];
    {
      const res: SearchResult[] = [];
      cDocs.forEach((d) => {
        const data = d.data();
        const name = (data.name ?? '') as string;
        const email = (data.email ?? '') as string;
        const role = (data.currentRole ?? data.role ?? '') as string;
        if (name.toLowerCase().includes(term) || email.toLowerCase().includes(term) || role.toLowerCase().includes(term)) {
          res.push({ id: d.id, label: name || email, sub: role || email, type: 'Candidate', href: `/candidates/${d.id}`, init: initials(name || email), bg: colorFor(d.id), round: true });
        }
      });
      oDocs.forEach((d) => {
        const data = d.data();
        const name = (data.name ?? '') as string;
        const industry = (data.industry ?? '') as string;
        if (name.toLowerCase().includes(term) || industry.toLowerCase().includes(term)) {
          res.push({ id: d.id, label: name, sub: industry || 'Organization', type: 'Organization', href: `/organizations/${d.id}`, init: initials(name), bg: colorFor(d.id) });
        }
      });
      opDocs.forEach((d) => {
        const data = d.data();
        const title = (data.title ?? '') as string;
        const orgName = (data.orgName ?? '') as string;
        if (title.toLowerCase().includes(term) || orgName.toLowerCase().includes(term)) {
          res.push({ id: d.id, label: title, sub: orgName, type: 'Role', href: `/openings/${d.id}`, icon: 'briefcase', bg: NW.gray500 });
        }
      });
      pDocs.forEach((d) => {
        const data = d.data();
        const title = (data.title ?? data.openingTitle ?? '') as string;
        const code = (data.code ?? '') as string;
        if (title.toLowerCase().includes(term) || code.toLowerCase().includes(term)) {
          res.push({ id: d.id, label: title || code, sub: code, type: 'Pipeline', href: `/pipeline/${d.id}`, icon: 'kanban-square', bg: '#6366F1' });
        }
      });
      hDocs.forEach((d) => {
        const data = d.data();
        const name = (data.name ?? data.candidateName ?? '') as string;
        const role = (data.role ?? '') as string;
        if (name.toLowerCase().includes(term) || role.toLowerCase().includes(term)) {
          res.push({ id: d.id, label: name, sub: role || 'Hired', type: 'Hired', href: `/hired/${d.id}`, init: initials(name), bg: colorFor(d.id), round: true });
        }
      });
      setResults(res.slice(0, 10));
      setOpen(true);
    }
  }

  return (
    <div ref={containerRef} style={compact ? { flex: 1, minWidth: 0, position: 'relative' } : { width: 520, flexShrink: 1, position: 'relative' }}>
      <Icon name="search" size={16} color={NW.gray400} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => { if (results.length) setOpen(true); }}
        placeholder="Search orgs, roles, candidates, hires…"
        style={{
          width: '100%',
          fontSize: 13.5,
          color: NW.black,
          background: NW.gray50,
          border: `1px solid ${q ? NW.gray200 : 'transparent'}`,
          borderRadius: 999,
          padding: '10px 16px 10px 40px',
          outline: 'none',
        }}
      />
      {q ? (
        <button onClick={() => { setQ(''); setOpen(false); }} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}>
          <Icon name="x" size={14} color={NW.gray400} />
        </button>
      ) : (
        <kbd style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: MONO, fontSize: 11, color: NW.gray400, background: NW.white, border: `1px solid ${NW.gray200}`, borderRadius: 5, padding: '2px 6px' }}>⌘K</kbd>
      )}
      {open && q.trim().length >= 2 && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            right: 0,
            zIndex: 70,
            background: NW.white,
            border: `1px solid ${NW.gray100}`,
            borderRadius: 14,
            boxShadow: '0 18px 50px rgba(0,0,0,0.16)',
            overflow: 'hidden',
            maxHeight: 420,
            overflowY: 'auto',
          }}
        >
          {results.length ? (
            results.map((r, i) => (
              <button
                key={`${r.type}-${r.id}`}
                onClick={() => { router.push(r.href); setQ(''); setOpen(false); }}
                className="nw-search-result"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  border: 'none',
                  borderBottom: i === results.length - 1 ? 'none' : `1px solid ${NW.gray100}`,
                  background: NW.white,
                  cursor: 'pointer',
                  padding: '10px 14px',
                  textAlign: 'left',
                }}
              >
                <span style={{ width: 30, height: 30, borderRadius: r.round ? '50%' : 8, background: r.bg, color: NW.white, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                  {r.init || <Icon name={(r.icon as never) || 'circle'} size={14} color={NW.white} />}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: NW.black, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                  {r.sub && <span style={{ display: 'block', fontSize: 11.5, color: NW.gray500 }}>{r.sub}</span>}
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: TYPE_COLOR[r.type], background: TYPE_COLOR[r.type] + '14', borderRadius: 999, padding: '3px 9px', flexShrink: 0 }}>{r.type}</span>
              </button>
            ))
          ) : (
            <div style={{ padding: '18px 16px', fontSize: 13, color: NW.gray400 }}>No matches for “{q}”.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Top bar ──────────────────────────────────────────────────────────────────

export function Nav({ showMenu = false, onMenuClick }: { showMenu?: boolean; onMenuClick?: () => void } = {}) {
  const { user, profile } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const bellRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const displayName = profile?.name ?? user?.displayName ?? user?.email?.split('@')[0] ?? 'Admin';

  useEffect(() => {
    if (!profile?.id) return;
    const qy = query(
      collection(db, 'notifications'),
      where('userId', '==', profile.id),
      where('read', '==', false),
      orderBy('createdAt', 'desc'),
      limit(20),
    );
    const unsub = onSnapshot(qy, (snap) => {
      setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AppNotification)));
    }, () => {/* silently fail */});
    return unsub;
  }, [profile?.id]);

  useEffect(() => {
    if (!bellOpen && !menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [bellOpen, menuOpen]);

  async function dismissNotification(id: string) {
    try { await updateDoc(doc(db, 'notifications', id), { read: true }); } catch {/* */}
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
      className="nw-topbar"
      style={{
        height: 'var(--nw-topbar-h)',
        minHeight: 'var(--nw-topbar-h)',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '0 28px',
        borderBottom: `1px solid ${NW.gray100}`,
        background: NW.white,
      }}
    >
      {showMenu && (
        <button
          onClick={onMenuClick}
          aria-label="Open menu"
          style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 10, border: `1px solid ${NW.gray100}`, background: NW.white, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="menu" size={20} color={NW.gray700} />
        </button>
      )}
      {!showMenu && <div style={{ flex: 1 }} />}
      <GlobalSearch compact={showMenu} />
      <div style={{ flex: showMenu ? '0 0 auto' : 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
        {/* Bell */}
        <div ref={bellRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setBellOpen((v) => !v)}
            style={{ width: 38, height: 38, borderRadius: 999, border: `1px solid ${NW.gray100}`, background: NW.white, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}
          >
            <Icon name="bell" size={16} color={NW.gray600} />
            {unreadCount > 0 && (
              <span style={{ position: 'absolute', top: 8, right: 9, width: 7, height: 7, background: NW.rose500, borderRadius: '50%', border: `1.5px solid ${NW.white}` }} />
            )}
          </button>
          {bellOpen && (
            <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 70, width: 320, overflow: 'hidden', borderRadius: 14, border: `1px solid ${NW.gray100}`, background: NW.white, boxShadow: '0 18px 50px rgba(0,0,0,0.16)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${NW.gray100}`, padding: '12px 16px' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: NW.black }}>Notifications</span>
                {notifications.length > 0 && (
                  <button onClick={dismissAll} style={{ fontSize: 11, color: NW.gray500, background: 'transparent', border: 'none', cursor: 'pointer' }}>Mark all read</button>
                )}
              </div>
              {notifications.length === 0 ? (
                <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: 12, color: NW.gray400 }}>No new notifications</div>
              ) : (
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  {notifications.map((n) => (
                    <div key={n.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', borderBottom: `1px solid ${NW.gray100}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {n.link ? (
                          <a href={n.link} onClick={() => { dismissNotification(n.id); setBellOpen(false); }} style={{ display: 'block', fontSize: 12, fontWeight: 600, color: NW.black, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</a>
                        ) : (
                          <p style={{ fontSize: 12, fontWeight: 600, color: NW.black, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</p>
                        )}
                        {n.body && <p style={{ marginTop: 2, fontSize: 10.5, color: NW.gray500 }}>{n.body}</p>}
                        {n.createdAt && <p style={{ marginTop: 2, fontSize: 9.5, color: NW.gray400 }}>{fmtRelative(n.createdAt as Parameters<typeof fmtRelative>[0])}</p>}
                      </div>
                      <button onClick={() => dismissNotification(n.id)} title="Dismiss" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: NW.gray400, padding: 2, display: 'flex' }}>
                        <Icon name="x" size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* User menu */}
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px 4px 4px', border: `1px solid ${NW.gray100}`, borderRadius: 999, background: NW.white, cursor: 'pointer' }}
          >
            {profile?.photoUrl ? (
              <img src={profile.photoUrl} alt={displayName} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <span style={{ width: 28, height: 28, borderRadius: '50%', background: NW.teal500, color: NW.white, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{initials(displayName)}</span>
            )}
            <span className="nw-user-name" style={{ fontSize: 13.5, fontWeight: 500, color: NW.gray700 }}>{displayName}</span>
            <Icon name="chevron-down" size={14} color={NW.gray500} />
          </button>
          {menuOpen && (
            <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 70, width: 208, borderRadius: 12, border: `1px solid ${NW.gray100}`, background: NW.white, padding: '4px 0', boxShadow: '0 18px 50px rgba(0,0,0,0.16)' }}>
              <div style={{ borderBottom: `1px solid ${NW.gray100}`, padding: '10px 16px' }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: NW.black }}>{displayName}</p>
                <p style={{ fontSize: 11.5, color: NW.gray400 }}>{user?.email}</p>
              </div>
              <a href="/profile" onClick={() => setMenuOpen(false)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', fontSize: 12.5, color: NW.gray600 }}>
                <Icon name="circle-user" size={14} /> My profile
              </a>
              <button onClick={handleSignOut} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '9px 16px', fontSize: 12.5, color: NW.gray600, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <Icon name="log-out" size={14} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
