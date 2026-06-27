'use client';

// Nearwork Admin redesign — sidebar
// Full-height off-white rail. Nav model from the handoff (admin-shell.jsx),
// wired to real Next.js routes via usePathname/Link.

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type IconName } from 'lucide-react/dynamic';
import { NW, Icon, MONO } from '@/components/nw/primitives';
import { APP_VERSION } from '@/lib/version';

type NavItem = { href: string; label: string; icon: IconName; count?: number; dot?: boolean };

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [{ href: '/dashboard', label: 'Dashboard', icon: 'layout-dashboard' }],
  },
  {
    label: 'Partners',
    items: [
      { href: '/organizations', label: 'Organizations', icon: 'building-2' },
      { href: '/spp', label: 'SPP', icon: 'git-merge' },
    ],
  },
  {
    label: 'Pipeline',
    items: [
      { href: '/pipeline', label: 'Pipeline', icon: 'kanban-square' },
      { href: '/candidates', label: 'Candidates', icon: 'users' },
      { href: '/openings', label: 'Openings', icon: 'briefcase' },
      { href: '/hired', label: 'Hired', icon: 'party-popper' },
      { href: '/teams', label: 'Managed teams', icon: 'users-round' },
    ],
  },
  {
    label: 'Insights',
    items: [{ href: '/salary-rates', label: 'FX & rates', icon: 'calculator' }],
  },
];

const FOOTER_ITEMS: NavItem[] = [
  { href: '/users', label: 'Team', icon: 'user-cog' },
  { href: '/profile', label: 'Profile', icon: 'circle-user' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <Link
      href={item.href}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        width: '100%',
        padding: '9px 11px',
        borderRadius: 9,
        fontSize: 13.5,
        fontWeight: active ? 600 : 500,
        color: active ? NW.black : NW.gray600,
        background: active ? NW.white : hov ? 'rgba(255,255,255,0.6)' : 'transparent',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)' : 'none',
        position: 'relative',
        textAlign: 'left',
        transition: 'background 140ms, color 140ms',
      }}
    >
      {active && (
        <span style={{ position: 'absolute', left: -13, top: 9, bottom: 9, width: 3, background: NW.teal500, borderRadius: 2 }} />
      )}
      <Icon name={item.icon} size={17} color={active ? NW.teal600 : NW.gray500} strokeWidth={active ? 2 : 1.75} />
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.count != null && (
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 500,
            color: active ? NW.teal700 : NW.gray500,
            background: active ? NW.teal50 : NW.gray100,
            padding: '1px 7px',
            borderRadius: 999,
            minWidth: 22,
            textAlign: 'center',
          }}
        >
          {item.count}
        </span>
      )}
      {item.dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: NW.rose500 }} />}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || (pathname?.startsWith(href + '/') ?? false);

  return (
    <aside
      style={{
        width: 'var(--nw-sidebar-w)',
        minWidth: 'var(--nw-sidebar-w)',
        height: '100vh',
        background: NW.offWhite,
        borderRight: `1px solid ${NW.gray100}`,
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 14px 16px',
      }}
    >
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '4px 8px 18px' }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: NW.black,
            color: NW.white,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: '-0.04em',
            position: 'relative',
            flexShrink: 0,
          }}
        >
          N
          <div style={{ position: 'absolute', bottom: 6, left: 7, right: 13, height: 2, background: NW.teal500, borderRadius: 1 }} />
        </div>
        <div style={{ lineHeight: 1.1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.03em', color: NW.black }}>nearwork</div>
          <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.18em', color: NW.teal600, marginTop: 2 }}>ADMIN</div>
        </div>
      </div>

      {/* Nav sections */}
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }} className="no-scrollbar">
        {NAV_SECTIONS.map((sec) => (
          <div key={sec.label}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: NW.gray400,
                padding: '0 11px',
                marginBottom: 6,
              }}
            >
              {sec.label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {sec.items.map((it) => (
                <NavLink key={it.href} item={it} active={isActive(it.href)} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer nav */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 12, marginTop: 8, borderTop: `1px solid ${NW.gray200}` }}>
        {FOOTER_ITEMS.map((it) => (
          <NavLink key={it.href} item={it} active={isActive(it.href)} />
        ))}
      </div>
      <Link href="/changelog" style={{ padding: '12px 11px 2px', fontSize: 10.5, color: NW.gray400, fontFamily: MONO }}>
        Nearwork Admin · v{APP_VERSION}
      </Link>
    </aside>
  );
}
