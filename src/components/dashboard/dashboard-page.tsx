'use client';

// ============================================================
// Nearwork Admin redesign — Dashboard (Sprint 2)
// UI ported from the handoff `admin-pages-dashboard.jsx`, wired to the
// real Firestore data the previous dashboard already loaded.
// ============================================================

import { useState, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  db,
  auth,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  doc,
  onSnapshot,
  isNearworkEmail,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { useAuth } from '@/hooks/use-auth';
import { fmtRelative, fmtDate, fmtTime, initials } from '@/lib/utils';

// ─── Read-suppression ─────────────────────────────────────────────────────────
// Marking a notification read in-app should also suppress it from the pending
// email digest. Best-effort, non-blocking.
async function suppressDigest(notifId: string) {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ event: 'notification_read', notifId }),
      });
    }
  } catch { /* best-effort */ }
}

// Exact date-time, e.g. "Sat, Jul 5, 2026 at 2:34 PM".
function fmtExact(val: Parameters<typeof fmtDate>[0]): string {
  if (!val) return '';
  const date = fmtDate(val, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const time = fmtTime(val);
  return `${date} at ${time}`;
}
import {
  PIPELINE_STAGE_LABELS,
  type PipelineStage,
  type Organization,
  type Opening,
  type Candidate,
  type Pipeline,
  type Placement,
  type Application,
  type Timestamp,
  type Notification as AppNotification,
} from '@/lib/types';

// Application docs written by jobs/talent carry a few fields beyond the typed
// `Application` shape (the apply timestamp is `submittedAt`, not `appliedAt`).
type AppDoc = Application & {
  submittedAt?: Timestamp;
  createdAt?: Timestamp;
  title?: string;
  jobTitle?: string;
  isMockData?: boolean;
};
import { type IconName } from 'lucide-react/dynamic';
import { NW, MONO, Icon, Avatar, Button, Chip } from '@/components/nw/primitives';
import { PageHeader, Card, CardHead, FilterButton } from '@/components/nw/shell-ui';

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  icon,
  label,
  value,
  sub,
  accent = false,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        background: accent ? NW.teal500 : NW.white,
        border: `1px solid ${accent ? 'transparent' : NW.gray100}`,
        borderRadius: 16,
        padding: 22,
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: accent ? 'rgba(255,255,255,0.18)' : NW.teal50,
          }}
        >
          <Icon name={icon} size={15} color={accent ? NW.white : NW.teal600} />
        </span>
        <span style={{ fontSize: 13, fontWeight: 500, color: accent ? 'rgba(255,255,255,0.85)' : NW.gray500 }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 16 }}>
        <span style={{ fontFamily: MONO, fontSize: 40, fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1, color: accent ? NW.white : NW.black }}>
          {value}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: accent ? 'rgba(255,255,255,0.8)' : NW.gray500, marginTop: 10 }}>{sub}</div>
    </div>
  );
}

// ── Attention row (wired to real notifications) ───────────────────────────────
const ATT_TONE: Record<string, { fg: string; bg: string; icon: IconName }> = {
  mention: { fg: '#1D4ED8', bg: NW.blue50, icon: 'at-sign' },
  assignment: { fg: NW.teal700, bg: NW.teal50, icon: 'check-square' },
  status_change: { fg: '#A16207', bg: NW.yellow50, icon: 'refresh-cw' },
  system: { fg: '#1D4ED8', bg: NW.blue50, icon: 'info' },
};

function AttentionRow({ n, onOpen }: { n: AppNotification; onOpen: () => void }) {
  const t = ATT_TONE[n.type] || ATT_TONE.system;
  const [hov, setHov] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 4px', borderTop: `1px solid ${NW.gray100}` }}>
      <span style={{ width: 36, height: 36, borderRadius: 9, background: t.bg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name={t.icon} size={17} color={t.fg} />
      </span>
      <button
        onClick={onOpen}
        style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
      >
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, color: NW.black, lineHeight: 1.35 }}>{n.title}</span>
        {n.body && <span style={{ display: 'block', fontSize: 12, color: NW.gray500, marginTop: 2 }}>{n.body}</span>}
      </button>
      <button
        onClick={onOpen}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          color: hov ? NW.white : NW.gray700,
          background: hov ? NW.teal500 : NW.white,
          border: `1px solid ${hov ? 'transparent' : NW.gray200}`,
          borderRadius: 999,
          padding: '6px 14px',
          transition: 'all 130ms',
        }}
      >
        View
      </button>
    </div>
  );
}

// ─── Notification detail modal ─────────────────────────────────────────────────
function NotificationDetailModal({
  n,
  onClose,
  onView,
}: {
  n: AppNotification;
  onClose: () => void;
  onView: (link: string) => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.4)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative', width: '100%', maxWidth: 420, background: NW.white, borderRadius: 16, border: `1px solid ${NW.gray100}`, boxShadow: '0 24px 60px rgba(0,0,0,0.22)', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '18px 20px', borderBottom: `1px solid ${NW.gray100}` }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: NW.black, lineHeight: 1.35 }}>{n.title}</h2>
          <button onClick={onClose} title="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: NW.gray400, padding: 4, display: 'flex', flexShrink: 0 }}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div style={{ padding: '18px 20px' }}>
          {n.body && <p style={{ fontSize: 13.5, color: NW.gray700, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{n.body}</p>}
          {n.createdAt && (
            <p style={{ marginTop: n.body ? 14 : 0, fontSize: 12, color: NW.gray400 }}>
              {fmtExact(n.createdAt as Parameters<typeof fmtExact>[0])}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '14px 20px', borderTop: `1px solid ${NW.gray100}` }}>
          <button onClick={onClose} style={{ fontSize: 13, fontWeight: 600, color: NW.gray700, background: NW.white, border: `1px solid ${NW.gray200}`, borderRadius: 999, padding: '8px 16px', cursor: 'pointer' }}>Close</button>
          {n.link && (
            <button onClick={() => onView(n.link!)} style={{ fontSize: 13, fontWeight: 600, color: NW.white, background: NW.teal500, border: '1px solid transparent', borderRadius: 999, padding: '8px 16px', cursor: 'pointer' }}>View</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Activity row (candidate sign-ups + role applications) ─────────────────────
function ActivityRow({ item, last }: { item: ActivityItem; last: boolean }) {
  const applied = item.kind === 'applied';
  const metaIcon: IconName = applied ? 'briefcase' : 'user-plus';
  const metaColor = applied ? NW.teal600 : NW.violet500;
  const metaLabel = applied ? 'New application' : item.detail;
  return (
    <div style={{ display: 'flex', gap: 12, padding: '11px 0' }}>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Avatar initials={initials(item.name)} size={32} bg={item.bg} />
        {!last && <span style={{ flex: 1, width: 1.5, background: NW.gray100, marginTop: 4 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: 2 }}>
        <div style={{ fontSize: 13, color: NW.gray700, lineHeight: 1.4 }}>
          <span style={{ fontWeight: 600, color: NW.black }}>{item.name}</span>{' '}
          {applied ? (
            <>applied for <span style={{ fontWeight: 600, color: NW.black }}>{item.detail || 'a role'}</span></>
          ) : (
            'joined the ATS'
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
          <Icon name={metaIcon} size={12} color={metaColor} />
          {metaLabel && <span style={{ fontSize: 11.5, color: NW.gray500 }}>{metaLabel}</span>}
          {item.when && <span style={{ fontSize: 11.5, color: NW.gray400 }}>· {item.when}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Funnel (real pipeline stages) ─────────────────────────────────────────────
const FUNNEL_STAGES: PipelineStage[] = ['applied', 'background-check', 'interview', 'assessment', 'partner-review', 'partner-interview', 'hired'];
const FUNNEL_COLOR: Record<string, string> = {
  applied: NW.gray400,
  'background-check': NW.blue500,
  interview: '#6366F1',
  assessment: NW.violet500,
  'partner-review': NW.yellow500,
  'partner-interview': NW.teal500,
  hired: NW.green600,
};

// Normalize the various timestamp shapes Firestore docs carry into epoch ms.
function toMs(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'object' && v !== null && 'toMillis' in v) return (v as { toMillis(): number }).toMillis();
  if (typeof v === 'object' && v !== null && 'seconds' in v) return (v as { seconds: number }).seconds * 1000;
  if (typeof v === 'string' || typeof v === 'number') {
    const t = new Date(v).getTime();
    return isNaN(t) ? 0 : t;
  }
  return 0;
}

function colorFor(seed: string) {
  const palette = [NW.teal500, NW.rose500, NW.violet500, NW.blue500, NW.teal600, '#EAB308', '#EC5290'];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

interface DashStats {
  activeOrgs: number;
  totalOrgs: number;
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
  kind: 'joined' | 'applied';
  detail?: string;   // current role (joined) · role applied for (applied)
  ts: number;        // epoch ms used to order the merged feed
  when?: string;
  bg: string;
}
interface BandwidthItem { name: string; role: string; openingCount: number; pct: number }
interface FunnelItem { stage: PipelineStage; label: string; count: number }

export default function DashboardPage() {
  const { profile } = useAuth();
  const router = useRouter();

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [detail, setDetail] = useState<AppNotification | null>(null);
  const [stats, setStats] = useState<DashStats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [bandwidth, setBandwidth] = useState<BandwidthItem[]>([]);
  const [funnel, setFunnel] = useState<FunnelItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Unread notifications → "Needs your attention"
  useEffect(() => {
    if (!profile?.id) return;
    const qy = query(
      collection(db, 'notifications'),
      where('userId', '==', profile.id),
      where('read', '==', false),
      orderBy('createdAt', 'desc'),
      limit(8),
    );
    const unsub = onSnapshot(qy, (snap) => {
      setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AppNotification)));
    }, () => {/* silently fail */});
    return () => unsub();
  }, [profile?.id]);

  useEffect(() => { loadDashboard(); }, []);

  async function loadDashboard() {
    setLoading(true);
    try {
      const [orgsRes, openingsRes, candidatesRes, pipelinesRes, placementsRes, staffRes, applicationsRes] = await Promise.allSettled([
        getDocs(collection(db, 'organizations')),
        getDocs(collection(db, 'openings')),
        getDocs(collection(db, 'candidates')),
        getDocs(collection(db, 'pipelines')),
        getDocs(collection(db, 'placements')),
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'applications')),
      ]);

      function docsOf<T>(res: PromiseSettledResult<Awaited<ReturnType<typeof getDocs>>>): T[] {
        if (res.status !== 'fulfilled') return [];
        return res.value.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as T));
      }

      const orgs = docsOf<Organization>(orgsRes);
      const openings = docsOf<Opening>(openingsRes);
      const candidates = docsOf<Candidate>(candidatesRes);
      const pipelines = docsOf<Pipeline>(pipelinesRes);
      const placements = docsOf<Placement>(placementsRes);
      const applications = docsOf<AppDoc>(applicationsRes);
      const staff =
        staffRes.status === 'fulfilled'
          ? staffRes.value.docs.map((d) => d.data()).filter((m) => isNearworkEmail((m.email as string) ?? ''))
          : [];

      const activeOrgs = orgs.filter((o) => o.status === 'active');
      const activeOpenings = openings.filter((o) => o.status === 'open');
      const activeCandidates = candidates.filter((c) => !c.status || c.status === 'screening' || c.status === 'interviewing');

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const hiresThisMonth = placements.filter((p) => {
        const d = p.startDate ? new Date(p.startDate) : null;
        return d && d >= startOfMonth;
      });

      setStats({
        activeOrgs: activeOrgs.length,
        totalOrgs: orgs.length,
        topOrgNames: activeOrgs.slice(0, 3).map((o) => o.name).join(' · ') || 'No organizations yet',
        activeOpenings: activeOpenings.length,
        totalOpenings: openings.length,
        totalCandidates: candidates.length,
        activeCandidates: activeCandidates.length,
        hiresThisMonth: hiresThisMonth.length,
        recentHireNames: hiresThisMonth.length ? hiresThisMonth.slice(0, 2).map((p) => p.candidateName ?? '—').join(' · ') : 'None yet this month',
      });

      // Activity — merge recent candidate sign-ups + recent role applications,
      // newest first across both event types.
      const joinedItems: ActivityItem[] = candidates.map((c) => ({
        id: `cand-${c.id}`,
        name: c.name,
        kind: 'joined' as const,
        detail: c.currentRole,
        ts: toMs(c.createdAt),
        when: c.createdAt ? fmtRelative(c.createdAt) : undefined,
        bg: colorFor(c.id),
      }));
      const appliedItems: ActivityItem[] = applications
        .filter((a) => a.isMockData !== true)
        .map((a) => {
          const at = a.submittedAt ?? a.appliedAt ?? a.updatedAt ?? a.createdAt;
          return {
            id: `app-${a.id}`,
            name: a.candidateName || 'A candidate',
            kind: 'applied' as const,
            detail: a.openingTitle || a.title || a.jobTitle,
            ts: toMs(at),
            when: at ? fmtRelative(at) : undefined,
            bg: colorFor(a.candidateId || a.id),
          };
        });
      setActivity(
        [...joinedItems, ...appliedItems].sort((x, y) => y.ts - x.ts).slice(0, 8),
      );

      // Recruiter bandwidth — openings owned per staff recruiter
      const recruiterNames = [...new Set(staff.map((m) => m.name as string).filter(Boolean))];
      const bwItems: BandwidthItem[] = recruiterNames.map((name) => ({
        name,
        role: (staff.find((m) => m.name === name)?.staffRole as string) ?? 'Recruiter',
        openingCount: openings.filter((o) => o.recruiter?.toLowerCase() === name?.toLowerCase()).length,
        pct: 0,
      }));
      const maxCount = Math.max(1, ...bwItems.map((b) => b.openingCount));
      bwItems.forEach((b) => { b.pct = Math.round((b.openingCount / maxCount) * 100); });
      setBandwidth(bwItems.filter((b) => b.openingCount > 0).slice(0, 6));

      // Funnel — real stage counts across every pipeline's candidates
      const stageCounts: Record<string, number> = {};
      pipelines.forEach((p) => {
        (p.candidates ?? []).forEach((c) => {
          const st = (c.stage ?? 'applied') as string;
          stageCounts[st] = (stageCounts[st] ?? 0) + 1;
        });
      });
      setFunnel(FUNNEL_STAGES.map((st) => ({ stage: st, label: PIPELINE_STAGE_LABELS[st], count: stageCounts[st] ?? 0 })));
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }

  // Mark read (also suppresses the pending digest) and open the detail modal.
  async function openDetail(n: AppNotification) {
    setDetail(n);
    try { await updateDoc(doc(db, 'notifications', n.id), { read: true }); } catch {/* */}
    suppressDigest(n.id);
  }

  const firstName = profile?.firstName ?? profile?.name?.split(' ')[0] ?? 'there';
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateLine = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.count));

  return (
    <MainLayout>
      <PageHeader
        overline={dateLine}
        title={`${greeting}, ${firstName}`}
        subtitle="Here's everything happening across your partners and pipeline today."
        actions={
          <>
            <Button variant="secondary" size="md" icon="refresh-cw" onClick={loadDashboard}>Refresh</Button>
            <Button variant="primary" size="md" icon="plus" onClick={() => router.push('/openings/new')}>New opening</Button>
          </>
        }
      />

      {/* Stats */}
      <div className="nw-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 18 }}>
        <StatCard icon="building-2" label="Active organizations" value={stats?.activeOrgs ?? '—'} sub={stats?.topOrgNames ?? '—'} accent />
        <StatCard icon="briefcase" label="Open openings" value={stats?.activeOpenings ?? '—'} sub={`${stats?.totalOpenings ?? 0} total`} />
        <StatCard icon="users" label="Candidates in ATS" value={stats?.totalCandidates ?? '—'} sub={`${stats?.activeCandidates ?? 0} active`} />
        <StatCard icon="party-popper" label="Hires this month" value={stats?.hiresThisMonth ?? '—'} sub={stats?.recentHireNames ?? '—'} />
      </div>

      {/* Attention + activity */}
      <div className="nw-grid-2col" style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 16, marginBottom: 18 }}>
        <Card>
          <CardHead
            icon="bell-ring"
            title="Needs your attention"
            sub={notifications.length ? `${notifications.length} unread notification${notifications.length === 1 ? '' : 's'}` : 'You are all caught up'}
            action={notifications.length ? <Chip variant="rose" size="sm">{notifications.length} open</Chip> : undefined}
          />
          {notifications.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 4px', color: NW.gray500, fontSize: 13 }}>
              <Icon name="check-circle-2" size={18} color={NW.green600} /> Nothing needs your attention right now.
            </div>
          ) : (
            <div>
              {notifications.map((n) => (
                <AttentionRow key={n.id} n={n} onOpen={() => openDetail(n)} />
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHead
            icon="activity"
            title="Live activity"
            action={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: NW.gray500 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: NW.green500 }} />Live
              </span>
            }
          />
          <div style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
            {activity.length === 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12.5, color: NW.gray400 }}>No recent activity yet.</div>
            ) : (
              activity.map((a, i) => <ActivityRow key={a.id} item={a} last={i === activity.length - 1} />)
            )}
          </div>
        </Card>
      </div>

      {/* Funnel + bandwidth */}
      <div className="nw-grid-2col" style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 16 }}>
        <Card>
          <CardHead icon="filter" title="Pipeline funnel" sub="Candidates by stage · all active pipelines" action={<FilterButton label="Stages" value="Live" />} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
            {funnel.map((f) => (
              <div key={f.stage} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ width: 110, fontSize: 12.5, color: NW.gray600, textAlign: 'right', flexShrink: 0 }}>{f.label}</span>
                <div style={{ flex: 1, height: 26, background: NW.gray50, borderRadius: 7, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.max(f.count ? 8 : 0, (f.count / maxFunnel) * 100)}%`,
                      height: '100%',
                      background: FUNNEL_COLOR[f.stage] || NW.teal500,
                      borderRadius: 7,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      paddingRight: 10,
                      transition: 'width 500ms cubic-bezier(0.16,1,0.3,1)',
                    }}
                  >
                    {f.count > 0 && <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, color: NW.white }}>{f.count}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHead icon="gauge" title="Recruiter bandwidth" sub="Open roles owned" action={<Button variant="ghost" size="sm" iconRight="arrow-right" onClick={() => router.push('/users')}>Team</Button>} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 2 }}>
            {bandwidth.length === 0 ? (
              <div style={{ padding: '16px 0', fontSize: 12.5, color: NW.gray400 }}>No staff load yet.</div>
            ) : (
              bandwidth.map((u) => {
                const tone = u.pct >= 80 ? NW.rose500 : u.pct <= 25 ? NW.gray300 : NW.teal500;
                return (
                  <div key={u.name} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <Avatar initials={initials(u.name)} size={30} bg={colorFor(u.name)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 500, color: NW.black, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</span>
                        <span style={{ fontFamily: MONO, fontSize: 11.5, color: NW.gray500 }}>{u.openingCount}</span>
                      </div>
                      <div style={{ height: 6, background: NW.gray50, borderRadius: 999 }}>
                        <div style={{ width: `${u.pct}%`, height: '100%', background: tone, borderRadius: 999 }} />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      {detail && (
        <NotificationDetailModal
          n={detail}
          onClose={() => setDetail(null)}
          onView={(link) => { setDetail(null); router.push(link); }}
        />
      )}
    </MainLayout>
  );
}
