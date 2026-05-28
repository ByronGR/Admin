'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Kanban,
  Users,
  Building2,
  Briefcase,
  Trophy,
  ClipboardList,
  MessageSquare,
  DollarSign,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/pipeline', label: 'Pipeline', icon: Kanban },
  { href: '/candidates', label: 'Candidates', icon: Users },
  { href: '/organizations', label: 'Organizations', icon: Building2 },
  { href: '/openings', label: 'Openings', icon: Briefcase },
  { href: '/hired', label: 'Hired', icon: Trophy },
  { href: '/assessments', label: 'Assessments', icon: ClipboardList },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
  { href: '/salary-rates', label: 'Salary Rates', icon: DollarSign },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="fixed bottom-0 left-0 top-0 flex flex-col border-r border-[var(--border)] bg-white"
      style={{
        width: 'var(--sidebar-w)',
        paddingTop: 'var(--nav-h)',
      }}
    >
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || (pathname?.startsWith(href + '/') ?? false);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-500 transition-colors ${
                    active
                      ? 'bg-[var(--green-soft)] text-[var(--green)]'
                      : 'text-[var(--mid)] hover:bg-[var(--bg)] hover:text-[var(--black)]'
                  }`}
                >
                  <Icon
                    className="h-4 w-4 shrink-0"
                    strokeWidth={active ? 2.5 : 2}
                  />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="border-t border-[var(--border)] px-4 py-3">
        <p className="text-[10px] text-[var(--light)]">
          Nearwork Admin v2.0
        </p>
      </div>
    </aside>
  );
}
