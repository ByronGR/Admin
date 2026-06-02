'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { Search, X, Check } from 'lucide-react';
import { db, HARD_CODED_SUPER_ADMINS, isNearworkEmail } from '@/lib/firebase';
import { initials } from '@/lib/utils';

// ─── Nearwork staff directory (shared, cached) ───────────────────────────────
// Loads the team once and shares the result across every picker on the page, so
// the openings + pipeline forms don't each re-query the `users` collection.

export type StaffOption = { id: string; name: string; email: string; role: string };

let staffCache: Promise<StaffOption[]> | null = null;

function loadStaff(): Promise<StaffOption[]> {
  if (staffCache) return staffCache;
  staffCache = (async () => {
    const byEmail = new Map<string, StaffOption>();
    try {
      const snap = await getDocs(collection(db, 'users'));
      snap.docs.forEach((d) => {
        const data = d.data() as { name?: string; email?: string; jobTitle?: string; staffRole?: string; role?: string };
        const email = (data.email ?? '').toLowerCase();
        // Team = Nearwork staff only; the shared `users` collection also holds
        // client/partner accounts, which must not be selectable here.
        if (!isNearworkEmail(email)) return;
        const name = (data.name ?? '').trim() || email;
        byEmail.set(email, {
          id: d.id,
          name,
          email,
          role: (data.jobTitle ?? '').trim() || (data.staffRole ?? data.role ?? '').replace(/_/g, ' '),
        });
      });
    } catch {
      // Network/permission hiccup — fall back to just the hardcoded admins so the
      // picker is never completely empty.
    }
    for (const email of HARD_CODED_SUPER_ADMINS) {
      const e = email.toLowerCase();
      if (byEmail.has(e)) continue;
      const name = e.split('@')[0].split('.').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
      byEmail.set(e, { id: `sa:${e}`, name, email: e, role: 'Super admin' });
    }
    return Array.from(byEmail.values()).sort((a, b) => a.name.localeCompare(b.name));
  })();
  return staffCache;
}

export function useStaff(): StaffOption[] {
  const [staff, setStaff] = useState<StaffOption[]>([]);
  useEffect(() => {
    let alive = true;
    loadStaff().then((s) => { if (alive) setStaff(s); });
    return () => { alive = false; };
  }, []);
  return staff;
}

// ─── Searchable staff picker ─────────────────────────────────────────────────
// Replaces free-text recruiter / account-manager inputs. Stores the selected
// person's display name (a string) so all existing read sites keep working;
// legacy free-text values still render and can be cleared.

export function StaffPicker({
  value,
  onChange,
  placeholder = 'Search team…',
  compact = false,
}: {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  compact?: boolean;
}) {
  const staff = useStaff();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    const list = query
      ? staff.filter((s) => s.name.toLowerCase().includes(query) || s.email.toLowerCase().includes(query))
      : staff;
    return list.slice(0, 8);
  }, [staff, q]);

  const pad = compact ? 'px-3 py-2 text-xs' : 'px-3 py-2.5 text-sm';

  function pick(option: StaffOption) {
    onChange(option.name);
    setQ('');
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--light)]" />
        <input
          value={open ? q : value}
          onFocus={() => { setOpen(true); setQ(''); }}
          onChange={(e) => { setQ(e.target.value); if (!open) setOpen(true); }}
          placeholder={value && !open ? value : placeholder}
          className={`w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] pl-8 ${value ? 'pr-8' : 'pr-3'} ${pad} outline-none focus:border-[var(--green)] focus:bg-white`}
        />
        {value && (
          <button
            type="button"
            onClick={() => { onChange(''); setQ(''); setOpen(false); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--light)] hover:bg-[var(--border)] hover:text-[var(--black)]"
            aria-label="Clear"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-white py-1 shadow-lg">
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--light)]">No team members found</p>
          ) : (
            matches.map((s) => {
              const selected = s.name === value;
              return (
                <button
                  type="button"
                  key={s.id}
                  onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                  className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-[var(--bg)]"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-600 text-white" style={{ background: 'var(--green)' }}>
                    {initials(s.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-600 text-[var(--black)]">{s.name}</span>
                    <span className="block truncate text-[10px] capitalize text-[var(--light)]">{s.role || s.email}</span>
                  </span>
                  {selected && <Check className="size-3.5 shrink-0 text-[var(--green)]" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
