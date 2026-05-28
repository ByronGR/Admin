'use client';

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  db,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  doc,
  onSnapshot,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/use-auth';
import { fmtRelative, fmtNumber } from '@/lib/utils';
import type {
  Organization,
  Opening,
  Candidate,
  Pipeline,
  Placement,
  Notification as AppNotification,
} from '@/lib/types';
import {
  Building2,
  Briefcase,
  Users,
  Trophy,
  RefreshCw,
  Download,
  Bell,
  X,
  SlidersHorizontal,
  AtSign,
  Info,
  CheckSquare,
} from 'lucide-react';

// ─── Widget visibility ────────────────────────────────────────────────────────

type WidgetKey = 'stats' | 'notifications' | 'report' | 'activity' | 'bandwidth';

const WIDGET_LABELS: Record<WidgetKey, string> = {
  stats: 'Metric cards',
  notifications: 'Notification feed',
  report: 'Report builder',
  activity: 'Activity feed',
  bandwidth: 'Team bandwidth',
};

const WIDGET_DEFAULTS: Record<WidgetKey, boolean> = {
  stats: true,
  notifications: true,
  report: true,
  activity: true,
  bandwidth: true,
};

function loadWidgetPrefs(): Record<WidgetKey, boolean> {
  if (typeof window === 'undefined') return WIDGET_DEFAULTS;
  try {
    const saved = localStorage.getItem('dashboard-widgets');
    if (saved) return { ...WIDGET_DEFAULTS, ...JSON.parse(saved) };
  } catch {}
  return WIDGET_DEFAULTS;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashStats {
  activeOrgs: number;
  topOrgNames: string;
  activeOpenings: number;
  totalOpenings: number;
  totalCandidates: number;
  activeCandidates: number;
  hiresThisMonth: number;
  recentHireNames: string;
}

interface ActivityItem {
  id: string;
  name: string;
  role?: string;
  appliedAt?: string;
  color: string;
}

interface BandwidthItem {
  name: string;
  role: string;
  openingCount: number;
  pct: number;
}

interface OrgHealth {
  id: string;
  name: string;
  status: string;
  candidateCount: number;
}

type ReportMetric = 'applications' | 'candidates' | 'openings' | 'pipeline' | 'hires';
type ReportPeriod = '1' | '7' | '30' | '90' | 'all';
type ReportGroup = 'none' | 'role' | 'opening' | 'status' | 'recruiter' | 'org';

interface ReportRow {
  label: string;
  count: number;
  sub?: string;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { profile } = useAuth();
  const router = useRouter();

  // Widget visibility
  const [widgets, setWidgets] = useState<Record<WidgetKey, boolean>>(WIDGET_DEFAULTS);
  const [showWidgetMenu, setShowWidgetMenu] = useState(false);
  const widgetMenuRef = useRef<HTMLDivElement>(null);

  // Init widget prefs from localStorage after mount
  useEffect(() => {
    setWidgets(loadWidgetPrefs());
  }, []);

  // Close widget menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (widgetMenuRef.current && !widgetMenuRef.current.contains(e.target as Node)) {
        setShowWidgetMenu(false);
      }
    }
    if (showWidgetMenu) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showWidgetMenu]);

  function toggleWidget(key: WidgetKey) {
    setWidgets((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem('dashboard-widgets', JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // Notifications
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notifsLoading, setNotifsLoading] = useState(true);

  useEffect(() => {
    if (!profile?.id) {
      setNotifsLoading(false);
      return;
    }
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', profile.id),
      where('read', '==', false),
      orderBy('createdAt', 'desc'),
      limit(20)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AppNotification)));
        setNotifsLoading(false);
      },
      () => setNotifsLoading(false)
    );
    return () => unsub();
  }, [profile?.id]);

  async function dismissNotification(id: string) {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
      // onSnapshot will auto-remove it (filtered to read: false)
    } catch (err) {
      console.error('Dismiss notification error:', err);
    }
  }

  async function dismissAll() {
    for (const n of notifications) {
      await dismissNotification(n.id);
    }
  }

  // Dashboard data
  const [stats, setStats] = useState<DashStats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [bandwidth, setBandwidth] = useState<BandwidthItem[]>([]);
  const [orgHealth, setOrgHealth] = useState<OrgHealth[]>([]);
  const [loading, setLoading] = useState(true);

  // Report builder state
  const [reportMetric, setReportMetric] = useState<ReportMetric>('applications');
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('30');
  const [reportGroup, setReportGroup] = useState<ReportGroup>('none');
  const [reportRows, setReportRows] = useState<ReportRow[]>([]);
  const [reportLoading, setReportLoading] = useState(false);

  // Raw data for report
  const [rawCandidates, setRawCandidates] = useState<Candidate[]>([]);
  const [rawOpenings, setRawOpenings] = useState<Opening[]>([]);
  const [rawPipelines, setRawPipelines] = useState<Pipeline[]>([]);
  const [rawPlacements, setRawPlacements] = useState<Placement[]>([]);

  // Load all dashboard data
  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);
    try {
      const [orgsSnap, openingsSnap, candidatesSnap, pipelinesSnap, placementsSnap, staffSnap] =
        await Promise.all([
          getDocs(collection(db, 'organizations')),
          getDocs(collection(db, 'openings')),
          getDocs(collection(db, 'candidates')),
          getDocs(collection(db, 'pipelines')),
          getDocs(collection(db, 'placements')),
          getDocs(collection(db, 'users')),
        ]);

      const orgs = orgsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Organization));
      const openings = openingsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Opening));
      const candidates = candidatesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Candidate));
      const pipelines = pipelinesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Pipeline));
      const placements = placementsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Placement));
      const staff = staffSnap.docs.map((d) => d.data());

      // Save raw for report builder
      setRawCandidates(candidates);
      setRawOpenings(openings);
      setRawPipelines(pipelines);
      setRawPlacements(placements);

      // Stats
      const activeOrgs = orgs.filter((o) => o.status === 'active');
      const activeOpenings = openings.filter((o) => o.status === 'open');
      const activeCandidates = candidates.filter(
        (c) => !c.status || c.status === 'screening' || c.status === 'interviewing'
      );

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const hiresThisMonth = placements.filter((p) => {
        const d = p.startDate ? new Date(p.startDate) : null;
        return d && d >= startOfMonth;
      });

      setStats({
        activeOrgs: activeOrgs.length,
        topOrgNames:
          activeOrgs
            .slice(0, 3)
            .map((o) => o.name)
            .join(' · ') || 'No organizations yet',
        activeOpenings: activeOpenings.length,
        totalOpenings: openings.length,
        totalCandidates: candidates.length,
        activeCandidates: activeCandidates.length,
        hiresThisMonth: hiresThisMonth.length,
        recentHireNames: hiresThisMonth.length
          ? hiresThisMonth
              .slice(0, 2)
              .map((p) => p.candidateName ?? '—')
              .join(' · ')
          : 'None yet this month',
      });

      // Activity feed — recent candidates
      const colors = ['var(--green)', 'var(--violet)', 'var(--blue)', 'var(--amber)'];
      setActivity(
        candidates.slice(0, 6).map((c, i) => ({
          id: c.id,
          name: c.name,
          role: c.currentRole,
          appliedAt: c.createdAt ? fmtRelative(c.createdAt) : undefined,
          color: colors[i % colors.length],
        }))
      );

      // Recruiter bandwidth
      const recruiterNames = [...new Set(staff.map((m) => m.name).filter(Boolean))];
      const bwItems: BandwidthItem[] = recruiterNames.map((name) => ({
        name,
        role: staff.find((m) => m.name === name)?.staffRole ?? 'Recruiter',
        openingCount: openings.filter(
          (o) => o.recruiter?.toLowerCase() === name?.toLowerCase()
        ).length,
        pct: 0,
      }));
      const maxCount = Math.max(1, ...bwItems.map((b) => b.openingCount));
      bwItems.forEach((b) => {
        b.pct = Math.round((b.openingCount / maxCount) * 100);
      });
      setBandwidth(bwItems.slice(0, 6));

      // Org health
      setOrgHealth(
        orgs.slice(0, 5).map((o) => ({
          id: o.id,
          name: o.name,
          status: o.status ?? 'active',
          candidateCount: pipelines
            .filter((p) => p.orgId === o.id)
            .reduce((sum, p) => sum + (p.candidates?.length ?? 0), 0),
        }))
      );
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }

  // Report builder
  const buildReport = useCallback(() => {
    setReportLoading(true);

    const now = Date.now();
    const periodMs =
      reportPeriod === 'all' ? Infinity : Number(reportPeriod) * 24 * 60 * 60 * 1000;

    function inPeriod(ts: unknown): boolean {
      if (periodMs === Infinity) return true;
      if (!ts) return false;
      let d: Date;
      if (typeof ts === 'string') d = new Date(ts);
      else if (typeof ts === 'object' && ts !== null && 'seconds' in ts) {
        d = new Date((ts as { seconds: number }).seconds * 1000);
      } else return false;
      return now - d.getTime() <= periodMs;
    }

    let rows: ReportRow[] = [];

    if (reportMetric === 'candidates') {
      const filtered = rawCandidates.filter((c) => inPeriod(c.createdAt));
      if (reportGroup === 'none') {
        rows = [{ label: 'Candidates', count: filtered.length }];
      } else if (reportGroup === 'status') {
        const grouped: Record<string, number> = {};
        filtered.forEach((c) => {
          const k = c.status ?? 'unknown';
          grouped[k] = (grouped[k] ?? 0) + 1;
        });
        rows = Object.entries(grouped).map(([k, v]) => ({ label: k, count: v }));
      } else {
        rows = [{ label: 'Candidates', count: filtered.length }];
      }
    } else if (reportMetric === 'openings') {
      const filtered = rawOpenings.filter((o) => inPeriod(o.createdAt));
      if (reportGroup === 'status') {
        const grouped: Record<string, number> = {};
        filtered.forEach((o) => {
          const k = o.status ?? 'unknown';
          grouped[k] = (grouped[k] ?? 0) + 1;
        });
        rows = Object.entries(grouped).map(([k, v]) => ({ label: k, count: v }));
      } else if (reportGroup === 'org') {
        const grouped: Record<string, number> = {};
        filtered.forEach((o) => {
          const k = o.orgName ?? o.orgId ?? 'Unknown org';
          grouped[k] = (grouped[k] ?? 0) + 1;
        });
        rows = Object.entries(grouped).map(([k, v]) => ({ label: k, count: v }));
      } else if (reportGroup === 'recruiter') {
        const grouped: Record<string, number> = {};
        filtered.forEach((o) => {
          const k = o.recruiter ?? 'Unassigned';
          grouped[k] = (grouped[k] ?? 0) + 1;
        });
        rows = Object.entries(grouped).map(([k, v]) => ({ label: k, count: v }));
      } else {
        rows = [{ label: 'Openings', count: filtered.length }];
      }
    } else if (reportMetric === 'pipeline') {
      const allCands = rawPipelines.flatMap((p) =>
        (p.candidates ?? []).map((c) => ({ ...c, pipelineCode: p.code, orgName: p.orgName }))
      );
      if (reportGroup === 'status' || reportGroup === 'role') {
        const grouped: Record<string, number> = {};
        allCands.forEach((c) => {
          const k = c.stage ?? 'unknown';
          grouped[k] = (grouped[k] ?? 0) + 1;
        });
        rows = Object.entries(grouped).map(([k, v]) => ({ label: k, count: v }));
      } else if (reportGroup === 'org') {
        const grouped: Record<string, number> = {};
        allCands.forEach((c) => {
          const k = c.orgName ?? 'Unknown org';
          grouped[k] = (grouped[k] ?? 0) + 1;
        });
        rows = Object.entries(grouped).map(([k, v]) => ({ label: k, count: v }));
      } else {
        rows = [{ label: 'Pipeline candidates', count: allCands.length }];
      }
    } else if (reportMetric === 'hires') {
      const filtered = rawPlacements.filter((p) => inPeriod(p.startDate ?? p.createdAt));
      if (reportGroup === 'org') {
        const grouped: Record<string, number> = {};
        filtered.forEach((p) => {
          const k = p.orgName ?? 'Unknown org';
          grouped[k] = (grouped[k] ?? 0) + 1;
        });
        rows = Object.entries(grouped).map(([k, v]) => ({ label: k, count: v }));
      } else {
        rows = [{ label: 'Hires', count: filtered.length }];
      }
    } else {
      // applications
      const filtered = rawCandidates.filter((c) => inPeriod(c.createdAt));
      rows = [{ label: 'Applications', count: filtered.length }];
    }

    rows.sort((a, b) => b.count - a.count);
    setReportRows(rows);
    setReportLoading(false);
  }, [reportMetric, reportPeriod, reportGroup, rawCandidates, rawOpenings, rawPipelines, rawPlacements]);

  useEffect(() => {
    if (!loading) buildReport();
  }, [buildReport, loading]);

  function exportCSV() {
    const header = 'Label,Count\n';
    const body = reportRows.map((r) => `${r.label},${r.count}`).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nearwork-report-${reportMetric}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const firstName = profile?.firstName ?? profile?.name?.split(' ')[0] ?? 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">
              {greeting}, {firstName} 👋
            </h1>
            <p className="mt-0.5 text-sm text-[var(--light)]">
              Here&apos;s your Nearwork HQ overview for today.
            </p>
          </div>
          <div className="flex gap-2">
            {/* Customize widget menu */}
            <div className="relative" ref={widgetMenuRef}>
              <button
                onClick={() => setShowWidgetMenu((v) => !v)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-500 transition-colors ${
                  showWidgetMenu
                    ? 'border-[var(--green)] text-[var(--green)]'
                    : 'border-[var(--border)] bg-white text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]'
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Customize
              </button>

              {showWidgetMenu && (
                <div className="absolute right-0 top-10 z-50 w-52 rounded-xl border border-[var(--border)] bg-white shadow-lg">
                  <div className="border-b border-[var(--border)] px-4 py-2.5">
                    <p className="text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
                      Visible widgets
                    </p>
                  </div>
                  <div className="p-2">
                    {(Object.keys(WIDGET_LABELS) as WidgetKey[]).map((key) => (
                      <button
                        key={key}
                        onClick={() => toggleWidget(key)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-500 transition-colors hover:bg-[var(--bg)]"
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${
                            widgets[key]
                              ? 'bg-[var(--green)] text-white'
                              : 'border border-[var(--border)] bg-white'
                          }`}
                        >
                          {widgets[key] && (
                            <svg viewBox="0 0 10 8" fill="none" className="h-2.5 w-2.5">
                              <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <span className={widgets[key] ? 'text-[var(--black)]' : 'text-[var(--light)]'}>
                          {WIDGET_LABELS[key]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={loadDashboard}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs font-500 text-[var(--mid)] transition-colors hover:border-[var(--green)] hover:text-[var(--green)]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={() => router.push('/openings')}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-600 text-white"
              style={{ background: 'var(--green)' }}
            >
              + New opening
            </button>
          </div>
        </div>

        {/* Metric cards */}
        {widgets.stats && (
          loading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MetricCard
                icon={<Building2 className="h-5 w-5" />}
                label="Active organizations"
                value={stats?.activeOrgs ?? 0}
                sub={stats?.topOrgNames ?? '—'}
                dark
              />
              <MetricCard
                icon={<Briefcase className="h-5 w-5" />}
                label="Active openings"
                value={stats?.activeOpenings ?? 0}
                sub={`${stats?.totalOpenings ?? 0} total`}
              />
              <MetricCard
                icon={<Users className="h-5 w-5" />}
                label="Candidates in ATS"
                value={stats?.totalCandidates ?? 0}
                sub={`${stats?.activeCandidates ?? 0} active`}
              />
              <MetricCard
                icon={<Trophy className="h-5 w-5" />}
                label="Hires this month"
                value={stats?.hiresThisMonth ?? 0}
                sub={stats?.recentHireNames ?? '—'}
              />
            </div>
          )
        )}

        {/* Notification feed */}
        {widgets.notifications && (
          <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-[var(--green)]" />
                <h2 className="text-sm font-700 text-[var(--black)]">Notifications</h2>
                {notifications.length > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--green)] px-1.5 text-[10px] font-700 text-white">
                    {notifications.length}
                  </span>
                )}
              </div>
              {notifications.length > 1 && (
                <button
                  onClick={dismissAll}
                  className="text-[10px] font-600 text-[var(--light)] transition-colors hover:text-[var(--green)]"
                >
                  Clear all
                </button>
              )}
            </div>

            {notifsLoading ? (
              <div className="flex h-16 items-center justify-center">
                <Spinner size="sm" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex items-center gap-3 rounded-xl bg-[var(--bg)] px-4 py-5">
                <span className="text-xl">🎉</span>
                <div>
                  <p className="text-xs font-600 text-[var(--black)]">You&apos;re all caught up!</p>
                  <p className="text-[11px] text-[var(--light)]">No unread notifications.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {notifications.map((n) => (
                  <NotificationRow
                    key={n.id}
                    notification={n}
                    onDismiss={() => dismissNotification(n.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Report builder */}
        {widgets.report && (
          <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-700 text-[var(--black)]">Report builder</h2>
                <p className="mt-0.5 text-xs text-[var(--light)]">
                  Build quick reports from the ATS, openings, pipelines, and hires data.
                </p>
              </div>
              <button
                onClick={exportCSV}
                disabled={reportRows.length === 0}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] transition-colors hover:border-[var(--green)] hover:text-[var(--green)] disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
            </div>

            <div className="mb-5 flex flex-wrap gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Report
                </label>
                <select
                  value={reportMetric}
                  onChange={(e) => setReportMetric(e.target.value as ReportMetric)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-500 text-[var(--black)] outline-none focus:border-[var(--green)]"
                >
                  <option value="applications">Candidate applications</option>
                  <option value="candidates">Candidates in ATS</option>
                  <option value="openings">Openings</option>
                  <option value="pipeline">Pipeline candidates</option>
                  <option value="hires">Hires / placements</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Time frame
                </label>
                <select
                  value={reportPeriod}
                  onChange={(e) => setReportPeriod(e.target.value as ReportPeriod)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-500 text-[var(--black)] outline-none focus:border-[var(--green)]"
                >
                  <option value="1">Last 24 hours</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                  <option value="all">All time</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Group by
                </label>
                <select
                  value={reportGroup}
                  onChange={(e) => setReportGroup(e.target.value as ReportGroup)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-500 text-[var(--black)] outline-none focus:border-[var(--green)]"
                >
                  <option value="none">No grouping</option>
                  <option value="role">Role</option>
                  <option value="opening">Opening</option>
                  <option value="status">Status</option>
                  <option value="recruiter">Recruiter</option>
                  <option value="org">Organization</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  onClick={buildReport}
                  className="rounded-lg px-4 py-2 text-xs font-600 text-white"
                  style={{ background: 'var(--green)' }}
                >
                  Build report
                </button>
              </div>
            </div>

            {/* Report output */}
            {reportLoading ? (
              <div className="flex h-20 items-center justify-center">
                <Spinner size="sm" />
              </div>
            ) : reportRows.length === 0 ? (
              <div className="rounded-xl bg-[var(--bg)] px-4 py-8 text-center text-xs text-[var(--light)]">
                No data for the selected filters.
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--bg)]">
                      <th className="px-4 py-2.5 text-left font-600 text-[var(--mid)]">Label</th>
                      <th className="px-4 py-2.5 text-right font-600 text-[var(--mid)]">Count</th>
                      <th className="px-4 py-2.5 text-right font-600 text-[var(--mid)]">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportRows.map((r, i) => {
                      const total = reportRows.reduce((s, x) => s + x.count, 0);
                      const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
                      return (
                        <tr
                          key={i}
                          className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg)]"
                        >
                          <td className="px-4 py-2.5 font-500 capitalize text-[var(--black)]">
                            {r.label.replace(/_/g, ' ')}
                          </td>
                          <td className="px-4 py-2.5 text-right font-600 text-[var(--black)]">
                            {fmtNumber(r.count)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-[var(--light)]">{pct}%</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-[var(--bg)]">
                      <td className="px-4 py-2.5 font-700 text-[var(--black)]">Total</td>
                      <td className="px-4 py-2.5 text-right font-700 text-[var(--black)]">
                        {fmtNumber(reportRows.reduce((s, r) => s + r.count, 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right font-600 text-[var(--black)]">100%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Two-column grid: Activity + Recruiter bandwidth */}
        {(widgets.activity || widgets.bandwidth) && (
          <div
            className={`grid gap-6 ${
              widgets.activity && widgets.bandwidth ? 'lg:grid-cols-2' : 'grid-cols-1'
            }`}
          >
            {/* Activity feed */}
            {widgets.activity && (
              <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
                <div className="mb-4 flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--green)] opacity-75"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--green)]"></span>
                  </span>
                  <h3 className="text-sm font-700 text-[var(--black)]">Live activity</h3>
                </div>

                {loading ? (
                  <div className="flex h-20 items-center justify-center">
                    <Spinner size="sm" />
                  </div>
                ) : activity.length === 0 ? (
                  <p className="py-8 text-center text-xs text-[var(--light)]">
                    No recent activity yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {activity.map((item) => (
                      <div key={item.id} className="flex items-start gap-3">
                        <div
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                          style={{ background: item.color }}
                        />
                        <div className="flex-1 text-xs">
                          <span className="font-600 text-[var(--black)]">{item.name}</span>
                          <span className="text-[var(--mid)]"> joined the ATS</span>
                          {item.role && (
                            <span className="text-[var(--mid)]"> · {item.role}</span>
                          )}
                        </div>
                        <span className="shrink-0 text-[10px] text-[var(--light)]">
                          {item.appliedAt ?? 'Recently'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Recruiter bandwidth */}
            {widgets.bandwidth && (
              <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
                <h3 className="mb-4 text-sm font-700 text-[var(--black)]">Recruiter bandwidth</h3>

                {loading ? (
                  <div className="flex h-20 items-center justify-center">
                    <Spinner size="sm" />
                  </div>
                ) : bandwidth.length === 0 ? (
                  <p className="py-4 text-xs text-[var(--light)]">No staff loaded yet.</p>
                ) : (
                  <div className="space-y-3">
                    {bandwidth.map((b, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-700 text-white"
                          style={{
                            background: 'linear-gradient(135deg, var(--green), var(--gd))',
                          }}
                        >
                          {b.name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')
                            .toUpperCase()
                            .slice(0, 2)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-600 text-[var(--black)]">
                              {b.name}
                            </span>
                            <span className="shrink-0 text-xs font-700 text-[var(--green)]">
                              {b.openingCount}
                            </span>
                          </div>
                          <p className="text-[10px] text-[var(--light)]">{b.role}</p>
                          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--bg)]">
                            <div
                              className="h-1 rounded-full transition-all"
                              style={{ width: `${b.pct}%`, background: 'var(--green)' }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Org health */}
                {orgHealth.length > 0 && (
                  <div className="mt-5 border-t border-[var(--border)] pt-5">
                    <p className="mb-3 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
                      Active orgs
                    </p>
                    <div className="space-y-2">
                      {orgHealth.map((o) => (
                        <div key={o.id} className="flex items-center gap-2 text-xs">
                          <span className="flex-1 truncate font-600 text-[var(--black)]">
                            {o.name}
                          </span>
                          <span className="text-[var(--light)]">
                            {o.candidateCount} candidate{o.candidateCount !== 1 ? 's' : ''}
                          </span>
                          <Badge label={o.status} variant="status" className="text-[9px]" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </MainLayout>
  );
}

// ─── Notification row ─────────────────────────────────────────────────────────

function NotificationRow({
  notification: n,
  onDismiss,
}: {
  notification: AppNotification;
  onDismiss: () => void;
}) {
  const [dismissing, setDismissing] = useState(false);

  const typeConfig: Record<string, { icon: ReactNode; bg: string; color: string }> = {
    mention: {
      icon: <AtSign className="h-3.5 w-3.5" />,
      bg: 'bg-blue-50',
      color: 'text-blue-600',
    },
    assignment: {
      icon: <CheckSquare className="h-3.5 w-3.5" />,
      bg: 'bg-green-50',
      color: 'text-green-600',
    },
    status_change: {
      icon: <RefreshCw className="h-3.5 w-3.5" />,
      bg: 'bg-amber-50',
      color: 'text-amber-600',
    },
    system: {
      icon: <Info className="h-3.5 w-3.5" />,
      bg: 'bg-[var(--bg)]',
      color: 'text-[var(--mid)]',
    },
  };

  const cfg = typeConfig[n.type] ?? typeConfig.system;

  async function handleDismiss() {
    setDismissing(true);
    await onDismiss();
  }

  return (
    <div
      className={`flex items-start gap-3 rounded-xl px-4 py-3 transition-opacity ${
        dismissing ? 'opacity-40' : ''
      } ${cfg.bg}`}
    >
      <div className={`mt-0.5 shrink-0 ${cfg.color}`}>{cfg.icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-600 text-[var(--black)]">{n.title}</p>
        {n.body && <p className="mt-0.5 text-[11px] text-[var(--mid)]">{n.body}</p>}
        {n.createdAt && (
          <p className="mt-1 text-[10px] text-[var(--light)]">{fmtRelative(n.createdAt)}</p>
        )}
      </div>
      <button
        onClick={handleDismiss}
        disabled={dismissing}
        className="shrink-0 rounded-md p-1 text-[var(--light)] transition-colors hover:bg-black/5 hover:text-[var(--mid)] disabled:opacity-40"
        title="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({
  icon,
  label,
  value,
  sub,
  dark,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  sub: string;
  dark?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-5 ${
        dark ? 'text-white' : 'border border-[var(--border)] bg-white'
      }`}
      style={dark ? { background: 'var(--black)' } : {}}
    >
      <div
        className={`mb-3 flex items-center gap-2 text-xs font-500 ${
          dark ? 'text-white/60' : 'text-[var(--light)]'
        }`}
      >
        {icon}
        {label}
      </div>
      <div
        className={`text-3xl font-800 tracking-tight ${
          dark ? 'text-white' : 'text-[var(--black)]'
        }`}
      >
        {value}
      </div>
      <div
        className={`mt-1.5 truncate text-xs ${dark ? 'text-white/50' : 'text-[var(--light)]'}`}
      >
        {sub}
      </div>
    </div>
  );
}
