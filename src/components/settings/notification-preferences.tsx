'use client';

// Settings → Notifications
// Per-type 3-state control: Off / In-app / In-app + Email.
// Stored as { app: boolean, email: boolean } per type under
// notificationPreferences/{uid}. Unset defaults to In-app ({app:true,email:false}).
// The notification writer reads these preferences to decide what to deliver.

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { db, doc, getDoc, setDoc, serverTimestamp, auth } from '@/lib/firebase';
import { useToast } from '@/components/ui/toast';
import { NW, Icon } from '@/components/nw/primitives';
import { Card, CardHead } from '@/components/nw/shell-ui';

type Pref = { app: boolean; email: boolean };
type Mode = 'off' | 'app' | 'email';

const TYPES: { key: string; label: string; desc: string }[] = [
  { key: 'clientRequests', label: 'Client requests', desc: 'When a client asks to advance, hire, decline, or interview a candidate' },
  { key: 'clientNotes', label: 'Client notes', desc: 'When a client leaves a note on a candidate' },
  { key: 'kickoffDecisions', label: 'Kickoff decisions', desc: 'When a client approves or requests changes on a brief' },
  { key: 'pipelineActivity', label: 'Followed pipelines', desc: 'Activity on pipelines you follow' },
];

const DEFAULT_PREF: Pref = { app: true, email: false };
const PREF_OFF: Pref = { app: false, email: false };

// Staff defaults: these keys default to In-app when unset. Everything else
// (e.g. pipelineActivity / Followed pipelines) defaults to Off.
const DEFAULT_ON = new Set(['clientRequests', 'clientNotes', 'kickoffDecisions']);

function defaultFor(key: string): Pref {
  return DEFAULT_ON.has(key) ? { ...DEFAULT_PREF } : { ...PREF_OFF };
}

function prefToMode(p: Pref): Mode {
  if (!p.app && !p.email) return 'off';
  if (p.app && p.email) return 'email';
  return 'app';
}

function modeToPref(m: Mode): Pref {
  if (m === 'off') return { app: false, email: false };
  if (m === 'email') return { app: true, email: true };
  return { app: true, email: false };
}

const SEGMENTS: { mode: Mode; label: string }[] = [
  { mode: 'off', label: 'Off' },
  { mode: 'app', label: 'In-app' },
  { mode: 'email', label: 'In-app + Email' },
];

function Segmented({ value, onChange, disabled }: { value: Mode; onChange: (m: Mode) => void; disabled?: boolean }) {
  return (
    <div style={{ display: 'inline-flex', background: NW.gray100, borderRadius: 9, padding: 3, flexShrink: 0 }}>
      {SEGMENTS.map((s) => {
        const on = s.mode === value;
        return (
          <button
            key={s.mode}
            onClick={() => !disabled && onChange(s.mode)}
            disabled={disabled}
            style={{
              font: 'inherit',
              fontSize: 12.5,
              fontWeight: on ? 600 : 500,
              padding: '6px 12px',
              borderRadius: 7,
              border: 'none',
              cursor: disabled ? 'default' : 'pointer',
              color: on ? NW.black : NW.gray500,
              background: on ? NW.white : 'transparent',
              boxShadow: on ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
              transition: 'background 140ms, color 140ms',
              whiteSpace: 'nowrap',
            }}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

export function NotificationPreferences() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const uid = profile?.id ?? auth.currentUser?.uid ?? null;

  const [prefs, setPrefs] = useState<Record<string, Pref>>(() =>
    Object.fromEntries(TYPES.map((t) => [t.key, defaultFor(t.key)]))
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!uid) {
        setLoading(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'notificationPreferences', uid));
        const stored = (snap.data()?.preferences ?? {}) as Record<string, Partial<Pref>>;
        if (cancelled) return;
        setPrefs(
          Object.fromEntries(
            TYPES.map((t) => {
              const s = stored[t.key];
              return [t.key, s && typeof s.app === 'boolean' && typeof s.email === 'boolean' ? { app: s.app, email: s.email } : defaultFor(t.key)];
            })
          )
        );
      } catch {
        // fall back to defaults on read error
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  async function change(key: string, mode: Mode) {
    if (!uid) {
      showToast('Your session expired — please sign in again.', 'error');
      return;
    }
    const prev = prefs;
    const next = { ...prefs, [key]: modeToPref(mode) };
    setPrefs(next); // optimistic
    try {
      await setDoc(
        doc(db, 'notificationPreferences', uid),
        { uid, preferences: next, updatedAt: serverTimestamp() },
        { merge: true }
      );
      showToast('Notification preference saved', 'success');
    } catch {
      setPrefs(prev); // revert
      showToast('Failed to save', 'error');
    }
  }

  return (
    <Card>
      <CardHead
        icon="bell"
        title="Notifications"
        sub="Choose how you're notified for each type. Default is In-app."
      />
      {loading ? (
        <div style={{ padding: '18px 4px', fontSize: 13, color: NW.gray500 }}>
          <Icon name="loader" size={15} color={NW.gray400} /> Loading your preferences…
        </div>
      ) : (
        TYPES.map((t, i) => (
          <div
            key={t.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
              padding: '15px 0',
              borderTop: i ? `1px solid ${NW.gray100}` : `1px solid ${NW.gray100}`,
            }}
          >
            <div style={{ minWidth: 200, flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: NW.black }}>{t.label}</div>
              <div style={{ fontSize: 12.5, color: NW.gray500, marginTop: 2 }}>{t.desc}</div>
            </div>
            <Segmented value={prefToMode(prefs[t.key])} onChange={(m) => change(t.key, m)} />
          </div>
        ))
      )}
    </Card>
  );
}
