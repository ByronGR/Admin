'use client';

import { useState } from 'react';
import { Bell, LogOut, ChevronDown, User } from 'lucide-react';
import { auth, signOut } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { initials } from '@/lib/utils';

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
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-700 text-white"
              style={{ background: 'var(--green)' }}
            >
              {initials(displayName)}
            </div>
            <span className="hidden text-xs font-500 text-[var(--mid)] sm:block">
              {displayName}
            </span>
            <ChevronDown className="h-3 w-3 text-[var(--light)]" />
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-xl border border-[var(--border)] bg-white py-1 shadow-lg">
                <div className="border-b border-[var(--border)] px-4 py-2.5">
                  <p className="text-xs font-600 text-[var(--black)]">
                    {displayName}
                  </p>
                  <p className="text-xs text-[var(--light)]">
                    {user?.email}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    // profile page if needed
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-xs text-[var(--mid)] transition-colors hover:bg-[var(--bg)]"
                >
                  <User className="h-3.5 w-3.5" />
                  My profile
                </button>
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
