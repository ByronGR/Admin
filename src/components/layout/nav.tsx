'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, LogOut, Search, User } from 'lucide-react';
import { auth, signOut, db, collection, getDocs } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { initials } from '@/lib/utils';

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
      <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 focus-within:border-[var(--green)] focus-within:bg-white">
        <Search className="h-3.5 w-3.5 text-[var(--light)]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search candidates, orgs, openings…"
          className="w-56 bg-transparent text-xs outline-none placeholder:text-[var(--light)]"
        />
        {searching && (
          <div className="h-3 w-3 animate-spin rounded-full border border-[var(--light)] border-t-[var(--green)]" />
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1 w-96 overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-lg">
          {results.map((r) => (
            <button
              key={`${r.type}-${r.id}`}
              onClick={() => {
                router.push(r.href);
                setQuery('');
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--bg)]"
            >
              <div className="flex-1 min-w-0">
                <p className="truncate text-xs font-600 text-[var(--black)]">{r.label}</p>
                <p className="truncate text-[10px] text-[var(--light)]">{r.sub}</p>
              </div>
              <span className={`rounded px-1.5 py-0.5 text-[9px] font-700 uppercase tracking-wider ${TYPE_COLORS[r.type]}`}>
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

  const displayName =
    profile?.name ?? user?.displayName ?? user?.email?.split('@')[0] ?? 'Admin';

  async function handleSignOut() {
    await signOut(auth);
    window.location.href = '/login';
  }

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
        {/* Notifications placeholder */}
        <button className="relative rounded-lg p-2 text-[var(--light)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--mid)]">
          <Bell className="h-4 w-4" />
        </button>

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
