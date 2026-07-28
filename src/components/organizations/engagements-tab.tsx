'use client';

// ============================================================
// Engagements — one record per client deal (legal + openings + payments).
// Renders as a tab on the Organization detail page.
// An engagement has a staff-chosen name and can bundle one or more HubSpot
// deals; stages reflect the deals' REAL HubSpot pipeline stage (won/lost too).
// Firestore: engagements / engagementDocuments / organizationDocuments /
// engagementPayments; files in Firebase Storage.
// ============================================================

import { useState, useEffect, useCallback, useRef, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  db, auth, storage, collection, getDocs, doc, addDoc, updateDoc, deleteDoc, setDoc,
  serverTimestamp, query, where, ref, uploadBytes, getDownloadURL,
} from '@/lib/firebase';
import { NW, Icon, Button } from '@/components/nw/primitives';
import { Card, CardHead } from '@/components/nw/shell-ui';
import { Modal } from '@/components/ui/modal';
import { fmtDate } from '@/lib/utils';
import {
  ENG_STAGES,
  type Organization, type Opening,
  type Engagement, type EngagementDocument, type OrgDocument, type EngagementPayment,
  type EngagementStage, type DealDocStatus, type LinkedDeal, type DealStageType, type DealPipelineStage,
} from '@/lib/types';

const fmtMoney = (n?: number) => '$' + Number(n || 0).toLocaleString('en-US');
const uploaderName = () => auth.currentUser?.displayName || auth.currentUser?.email || 'Staff';
const fileSize = (bytes: number) => (bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB');
const manualStageType = (label?: string): DealStageType => {
  const s = (label || '').toLowerCase();
  return s.includes('won') ? 'won' : s.includes('lost') ? 'lost' : 'open';
};

// Deal shape returned by /api/hubspot-deals.
type HsDeal = { id: string; title: string; value: number; ownerName: string; closeDate: string; stageLabel: string; stageType: DealStageType; stages: DealPipelineStage[] };

// ── Presentational bits ───────────────────────────────────────────────────────
const DOC_STATUS: Record<string, { fg: string; bg: string; dot: string }> = {
  Signed: { fg: NW.teal700, bg: NW.teal50, dot: NW.teal500 },
  'Awaiting signature': { fg: '#A16207', bg: NW.yellow50, dot: NW.yellow500 },
  Draft: { fg: NW.gray600, bg: NW.gray50, dot: NW.gray400 },
  Paid: { fg: NW.teal700, bg: NW.teal50, dot: NW.teal500 },
  Pending: { fg: '#A16207', bg: NW.yellow50, dot: NW.yellow500 },
};
function DocStatusPill({ status }: { status: string }) {
  const s = DOC_STATUS[status] || DOC_STATUS.Draft;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: s.fg, background: s.bg, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }} />{status}
    </span>
  );
}
function TypeBadge({ type }: { type: string }) {
  const c = type === 'MSA' ? NW.violet500 : type === 'Service Quote' ? NW.blue500 : type === 'SOW' ? NW.teal600 : NW.gray500;
  return <span style={{ fontSize: 10.5, fontWeight: 600, color: c, background: c + '18', borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>{type}</span>;
}
function HubspotBadge({ children = 'Synced from HubSpot' }: { children?: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, color: '#B4531E', background: '#FF7A5919', border: '1px solid #FF7A5933', borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap' }}>
      <Icon name="refresh-cw" size={10} color="#B4531E" />{children}
    </span>
  );
}

const STAGE_TYPE_STYLE: Record<DealStageType, { fg: string; bg: string; fill: string }> = {
  won: { fg: NW.green600, bg: NW.green50, fill: NW.green600 },
  lost: { fg: '#C0392B', bg: '#FEF0F0', fill: '#C0392B' },
  open: { fg: NW.teal700, bg: NW.teal50, fill: NW.teal600 },
};

// A single stage as a coloured pill — the real HubSpot label.
function StagePill({ label, type }: { label?: string; type: DealStageType }) {
  const s = STAGE_TYPE_STYLE[type] || STAGE_TYPE_STYLE.open;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: s.fg, background: s.bg, border: `1px solid ${s.fg}22`, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.fill }} />{label || '—'}
    </span>
  );
}

// Full tracker from a deal's REAL ordered pipeline stages — current filled
// (green if won, red if lost), earlier stages ticked.
function StageTracker({ stages }: { stages: DealPipelineStage[] }) {
  if (!stages?.length) return null;
  const curIdx = stages.findIndex(s => s.current);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {stages.map((s, n) => {
        const done = curIdx >= 0 && n < curIdx;
        const on = s.current;
        const fill = on ? STAGE_TYPE_STYLE[s.type].fill : done ? NW.teal50 : NW.gray50;
        const color = on ? NW.white : done ? NW.teal700 : NW.gray400;
        const border = on ? fill : done ? NW.teal500 + '33' : NW.gray100;
        return (
          <span key={s.label + n} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: on ? 600 : 500, color, background: fill, border: `1px solid ${border}` }}>
              {done && <Icon name="check" size={12} color={NW.teal600} />}{s.label}
            </span>
            {n < stages.length - 1 && <span style={{ width: 12, height: 1, background: n < curIdx ? NW.teal500 + '55' : NW.gray200 }} />}
          </span>
        );
      })}
    </div>
  );
}

function EngEmpty({ icon, title, sub, action }: { icon: string; title: string; sub: string; action?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '28px 20px', border: `1px dashed ${NW.gray200}`, borderRadius: 12, background: NW.offWhite }}>
      <Icon name={icon as never} size={20} color={NW.gray300} />
      <div style={{ fontSize: 13, fontWeight: 600, color: NW.gray600, marginTop: 7 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: NW.gray400, marginTop: 3 }}>{sub}</div>
      {action && <div style={{ marginTop: 13 }}>{action}</div>}
    </div>
  );
}

const engField: CSSProperties = { width: '100%', boxSizing: 'border-box', border: `1px solid ${NW.gray200}`, borderRadius: 9, padding: '9px 11px', font: 'inherit', fontSize: 13.5, color: NW.black, outline: 'none', background: NW.white };
const engLbl: CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: NW.gray500, marginBottom: 6, display: 'block' };

function ModalFooter({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${NW.gray100}` }}>{children}</div>;
}

// Search HubSpot deals by name; each result can be added to the engagement.
function DealSearch({ onPick }: { onPick: (deal: HsDeal) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<HsDeal[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error' | 'unconfigured'>('idle');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); setState('idle'); return; }
    setState('loading');
    const t = setTimeout(async () => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        const r = await fetch(`/api/hubspot-deals?q=${encodeURIComponent(q.trim())}`, { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} });
        const d = await r.json();
        if (!d.ok) {
          setState(d.reason === 'not_configured' ? 'unconfigured' : 'error');
          setMsg(d.reason === 'missing_scope' ? 'the token is missing the deals scope' : d.reason === 'unauthorized' ? 'please reload and sign in again' : d.message || '');
          setResults([]);
          return;
        }
        setResults(d.deals || []); setState('done');
      } catch { setState('error'); setMsg('network error'); }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);
  const note = (text: string) => <div style={{ fontSize: 12, color: NW.gray400, marginTop: 8 }}>{text}</div>;
  return (
    <div>
      <div style={{ position: 'relative' }}>
        <input style={{ ...engField, paddingLeft: 34 }} value={q} placeholder="Type a deal name to search HubSpot" onChange={e => setQ(e.target.value)} />
        <span style={{ position: 'absolute', left: 11, top: 10 }}><Icon name="search" size={15} color={NW.gray400} /></span>
      </div>
      {state === 'loading' && note('Searching HubSpot…')}
      {state === 'unconfigured' && note('HubSpot isn’t connected in this environment.')}
      {state === 'error' && note(`Couldn’t reach HubSpot${msg ? ' — ' + msg : ''}.`)}
      {state === 'done' && results.length === 0 && q.trim().length >= 2 && note('No matching deals.')}
      {results.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 190, overflowY: 'auto' }}>
          {results.map(d => (
            <button key={d.id} type="button" onClick={() => onPick(d)} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, textAlign: 'left', font: 'inherit', cursor: 'pointer', padding: '9px 11px', borderRadius: 10, border: `1px solid ${NW.gray100}`, background: NW.white }}
              onMouseEnter={e => { e.currentTarget.style.background = NW.gray50; }} onMouseLeave={e => { e.currentTarget.style.background = NW.white; }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: NW.black }}>{d.title}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: NW.gray500, marginTop: 2 }}>{fmtMoney(d.value)}{d.ownerName ? ' · ' + d.ownerName : ''}{d.closeDate ? ' · closes ' + d.closeDate : ''}</span>
              </span>
              {d.stageLabel && <StagePill label={d.stageLabel} type={d.stageType} />}
              <Icon name="plus" size={15} color={NW.teal600} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Create / edit engagement ──────────────────────────────────────────────────
function EngagementModal({ eng, orgId, orgName, onClose, onDone }: { eng?: Engagement; orgId: string; orgName?: string; onClose: () => void; onDone: () => void }) {
  const isEdit = !!eng;
  const [title, setTitle] = useState(eng?.title || '');
  const [stage, setStage] = useState<EngagementStage>((eng?.stage as EngagementStage) || 'Qualified');
  const [deals, setDeals] = useState<LinkedDeal[]>(eng?.deals || []);
  const [value, setValue] = useState(eng?.value ? String(eng.value) : '');
  const [ownerName, setOwnerName] = useState(eng?.ownerName || '');
  const [closeDate, setCloseDate] = useState(eng?.closeDate || '');
  const [saving, setSaving] = useState(false);

  const addDeal = (d: HsDeal) => setDeals(p => (p.some(x => x.id === d.id) ? p : [...p, { id: d.id, title: d.title, value: d.value, stageLabel: d.stageLabel, stageType: d.stageType, stages: d.stages, ownerName: d.ownerName, closeDate: d.closeDate }]));
  const removeDeal = (id: string) => setDeals(p => p.filter(x => x.id !== id));
  const hasDeals = deals.length > 0;
  const total = deals.reduce((s, d) => s + (d.value || 0), 0);

  async function save() {
    if (!title.trim() || saving) return;
    setSaving(true);
    const payload: Record<string, unknown> = {
      title: title.trim(), stage,
      value: hasDeals ? total : (parseInt(value.replace(/[^0-9]/g, ''), 10) || 0),
      ownerName: hasDeals ? (deals.length === 1 ? deals[0].ownerName || '' : '') : ownerName.trim(),
      closeDate: hasDeals ? (deals.length === 1 ? deals[0].closeDate || '' : '') : closeDate.trim(),
      deals, hubspotDealId: deals[0]?.id || eng?.hubspotDealId || '',
      updatedAt: serverTimestamp(),
    };
    try {
      if (eng) await updateDoc(doc(db, 'engagements', eng.id), payload);
      else await addDoc(collection(db, 'engagements'), { ...payload, orgId, orgName: orgName || '', currency: 'USD', openingCodes: [], createdAt: serverTimestamp(), createdBy: uploaderName() });
      onDone();
    } catch (e) { console.error('[engagements] save failed', e); alert('Could not save — check permissions.'); setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit engagement' : 'New engagement'} size="lg" className="min-w-0">
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 }}>
        <div><label style={engLbl}>Engagement name</label><input style={engField} value={title} placeholder="Name this engagement — e.g. Marketing team, Q3" onChange={e => setTitle(e.target.value)} autoFocus /></div>

        <div>
          <label style={engLbl}>Linked HubSpot deals {hasDeals ? `(${deals.length})` : '(optional)'}</label>
          {hasDeals && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              {deals.map(d => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, padding: '8px 11px', borderRadius: 10, background: '#FF7A590D', border: '1px solid #FF7A5933' }}>
                  <Icon name="refresh-cw" size={13} color="#B4531E" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: NW.black, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</div>
                    <div style={{ fontSize: 11, color: NW.gray500 }}>{fmtMoney(d.value)}{d.ownerName ? ' · ' + d.ownerName : ''}</div>
                  </div>
                  {d.stageLabel && <StagePill label={d.stageLabel} type={d.stageType} />}
                  <button type="button" onClick={() => removeDeal(d.id)} title="Remove" style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'inline-flex' }}><Icon name="x" size={15} color={NW.gray500} /></button>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, fontSize: 12, color: NW.gray600 }}>Total <span style={{ fontWeight: 700, color: NW.black }}>{fmtMoney(total)}</span></div>
            </div>
          )}
          <DealSearch onPick={addDeal} />
        </div>

        {!hasDeals && (
          <div><label style={engLbl}>Stage (manual)</label><select style={engField} value={stage} onChange={e => setStage(e.target.value as EngagementStage)}>{ENG_STAGES.map(s => <option key={s}>{s}</option>)}</select></div>
        )}

        {isEdit && !hasDeals && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
            <div><label style={engLbl}>Deal value (USD)</label><input style={engField} value={value} placeholder="84000" onChange={e => setValue(e.target.value)} /></div>
            <div><label style={engLbl}>Close date</label><input style={engField} value={closeDate} placeholder="Aug 01, 2026" onChange={e => setCloseDate(e.target.value)} /></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={engLbl}>Owner</label><input style={engField} value={ownerName} placeholder="Deal owner" onChange={e => setOwnerName(e.target.value)} /></div>
          </div>
        )}

        <div style={{ fontSize: 11.5, color: NW.gray500, display: 'flex', gap: 7, alignItems: 'flex-start' }}>
          <Icon name="info" size={13} color={NW.gray400} style={{ marginTop: 1 }} />
          Give the engagement your own name, then link one or more HubSpot deals — values and stages come straight from HubSpot.
        </div>
      </div>
      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={!title.trim() || saving} onClick={save}>{saving ? 'Saving…' : isEdit ? 'Save' : 'Create engagement'}</Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Upload a document into an engagement ──────────────────────────────────────
function UploadDocModal({ engagementId, orgId, openings, onClose, onDone }: { engagementId: string; orgId: string; openings: Opening[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<{ name: string; type: string; status: DealDocStatus; openingCodes: string[] }>({ name: '', type: 'Service Quote', status: 'Draft', openingCodes: [] });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));
  const toggle = (c: string) => setF(p => ({ ...p, openingCodes: p.openingCodes.includes(c) ? p.openingCodes.filter(x => x !== c) : [...p.openingCodes, c] }));
  function pick(picked: File | null) { if (!picked) return; setFile(picked); setF(p => ({ ...p, name: p.name || picked.name })); }
  async function save() {
    if (!f.name.trim() || saving) return;
    setSaving(true);
    try {
      let url = '', storagePath = '', size = '';
      if (file) {
        storagePath = `engagements/${engagementId}/${Date.now()}-${file.name}`;
        const sref = ref(storage, storagePath);
        await uploadBytes(sref, file);
        url = await getDownloadURL(sref);
        size = fileSize(file.size);
      }
      await addDoc(collection(db, 'engagementDocuments'), {
        engagementId, orgId, type: f.type, name: f.name.trim(), status: f.status,
        openingCodes: f.openingCodes, url, storagePath, size,
        uploadedAt: serverTimestamp(), uploadedBy: uploaderName(),
      });
      onDone();
    } catch (e) { console.error('[engagements] upload failed', e); alert('Could not upload — check permissions.'); setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="Upload document">
      <div style={{ display: 'grid', gap: 14 }}>
        <input ref={inputRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={e => pick(e.target.files?.[0] || null)} />
        <div onClick={() => inputRef.current?.click()} style={{ border: `1px dashed ${file ? NW.teal500 : NW.gray200}`, borderRadius: 12, background: NW.offWhite, padding: '20px 16px', textAlign: 'center', cursor: 'pointer' }}>
          <Icon name={file ? 'file-text' : 'upload-cloud'} size={22} color={file ? NW.teal600 : NW.gray400} />
          <div style={{ fontSize: 12.5, color: NW.gray600, marginTop: 6 }}>{file ? file.name : <>Drop a PDF here or <span style={{ color: NW.teal600, fontWeight: 600 }}>browse</span></>}</div>
          <div style={{ fontSize: 11, color: NW.gray400, marginTop: 3 }}>Stored in Firebase · staff-only</div>
        </div>
        <div><label style={engLbl}>File name</label><input style={engField} value={f.name} placeholder="SOW — Product Designer.pdf" onChange={e => set('name', e.target.value)} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div><label style={engLbl}>Type</label><select style={engField} value={f.type} onChange={e => set('type', e.target.value)}>{['Service Quote', 'SOW', 'Other'].map(t => <option key={t}>{t}</option>)}</select></div>
          <div><label style={engLbl}>Status</label><select style={engField} value={f.status} onChange={e => set('status', e.target.value)}>{(['Draft', 'Awaiting signature', 'Signed'] as const).map(s => <option key={s}>{s}</option>)}</select></div>
        </div>
        <div>
          <label style={engLbl}>Tag to openings (optional)</label>
          {openings.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {openings.map(op => { const on = f.openingCodes.includes(op.id); return (
                <button key={op.id} type="button" onClick={() => toggle(op.id)} style={{ font: 'inherit', fontSize: 12, fontWeight: on ? 600 : 500, cursor: 'pointer', borderRadius: 999, padding: '6px 12px', border: `1px solid ${on ? NW.teal500 : NW.gray200}`, background: on ? NW.teal50 : NW.white, color: on ? NW.teal700 : NW.gray600 }}>{op.title}</button>
              ); })}
            </div>
          ) : <div style={{ fontSize: 12.5, color: NW.gray400 }}>No openings linked to this engagement yet.</div>}
        </div>
        <div style={{ fontSize: 11.5, color: NW.gray500, display: 'flex', gap: 7, alignItems: 'flex-start' }}><Icon name="info" size={13} color={NW.gray400} style={{ marginTop: 1 }} />The MSA is uploaded at the organization level — it covers every engagement automatically.</div>
      </div>
      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={!f.name.trim() || saving} onClick={save}>{saving ? 'Uploading…' : 'Save document'}</Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Link openings to an engagement ────────────────────────────────────────────
function LinkOpeningsModal({ engagement, orgOpenings, onClose, onDone }: { engagement: Engagement; orgOpenings: Opening[]; onClose: () => void; onDone: () => void }) {
  const [sel, setSel] = useState<string[]>(engagement.openingCodes || []);
  const [saving, setSaving] = useState(false);
  const toggle = (id: string) => setSel(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  async function save() {
    setSaving(true);
    try { await updateDoc(doc(db, 'engagements', engagement.id), { openingCodes: sel, updatedAt: serverTimestamp() }); onDone(); }
    catch (e) { console.error('[engagements] link failed', e); alert('Could not save — check permissions.'); setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="Openings in this engagement">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {orgOpenings.map(op => { const on = sel.includes(op.id); return (
          <button key={op.id} type="button" onClick={() => toggle(op.id)} style={{ display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', font: 'inherit', cursor: 'pointer', padding: '11px 12px', borderRadius: 11, border: `1px solid ${on ? NW.teal500 : NW.gray100}`, background: on ? NW.teal50 : NW.white }}>
            <span style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${on ? NW.teal600 : NW.gray300}`, background: on ? NW.teal600 : NW.white, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{on && <Icon name="check" size={12} color={NW.white} />}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: NW.black }}>{op.title}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: NW.gray500 }}>{[op.department, op.seniority].filter(Boolean).join(' · ') || 'Role'}{typeof op.applicationCount === 'number' ? ` · ${op.applicationCount} applicants` : ''}</span>
            </span>
            <span style={{ fontSize: 11, color: NW.gray400, textTransform: 'uppercase' }}>{op.code || op.id}</span>
          </button>
        ); })}
        {orgOpenings.length === 0 && <div style={{ fontSize: 13, color: NW.gray400 }}>This organization has no openings yet.</div>}
      </div>
      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Account MSA modal (org-level) ─────────────────────────────────────────────
function MsaModal({ org, msa, onClose, onDone }: { org: Organization; msa: OrgDocument | null; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  async function upload() {
    if (!file || saving) return;
    setSaving(true);
    try {
      const storagePath = `organizations/${org.id}/msa/${Date.now()}-${file.name}`;
      const sref = ref(storage, storagePath);
      await uploadBytes(sref, file);
      const url = await getDownloadURL(sref);
      await setDoc(doc(db, 'organizationDocuments', `${org.id}-msa`), {
        orgId: org.id, type: 'MSA', name: file.name, status: 'Signed', url, storagePath,
        size: fileSize(file.size), uploadedAt: serverTimestamp(), uploadedBy: uploaderName(),
      });
      onDone();
    } catch (e) { console.error('[engagements] MSA upload failed', e); alert('Could not upload — check permissions.'); setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="Account MSA">
      <p style={{ fontSize: 13, color: NW.gray600, lineHeight: 1.6, margin: '0 0 14px' }}>The MSA sits at the organization level and is linked into every engagement for {org.name}.</p>
      <input ref={inputRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={e => setFile(e.target.files?.[0] || null)} />
      {msa && !file ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 13px', border: `1px solid ${NW.gray100}`, borderRadius: 11 }}>
          <span style={{ width: 32, height: 32, borderRadius: 8, background: NW.violet500 + '18', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="file-text" size={15} color={NW.violet500} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: NW.black }}>{msa.name}</div>
            <div style={{ fontSize: 11.5, color: NW.gray500 }}>{fmtDate(msa.uploadedAt)} · {msa.uploadedBy}{msa.size ? ' · ' + msa.size : ''}</div>
          </div>
          <DocStatusPill status={msa.status} />
        </div>
      ) : (
        <div onClick={() => inputRef.current?.click()} style={{ border: `1px dashed ${file ? NW.teal500 : NW.gray200}`, borderRadius: 12, background: NW.offWhite, padding: '22px 16px', textAlign: 'center', cursor: 'pointer' }}>
          <Icon name={file ? 'file-text' : 'upload-cloud'} size={22} color={file ? NW.teal600 : NW.gray400} />
          <div style={{ fontSize: 12.5, color: NW.gray600, marginTop: 6 }}>{file ? file.name : <>Drop the signed MSA here or <span style={{ color: NW.teal600, fontWeight: 600 }}>browse</span></>}</div>
        </div>
      )}
      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        {(file || !msa) && <Button size="sm" disabled={!file || saving} onClick={upload}>{saving ? 'Uploading…' : msa ? 'Replace MSA' : 'Upload MSA'}</Button>}
      </ModalFooter>
    </Modal>
  );
}

// ── Engagement detail — one scrolling screen ──────────────────────────────────
function EngagementDetail({ eng, org, openings, docs, msa, payments, onBack, reload }: {
  eng: Engagement; org: Organization; openings: Opening[];
  docs: EngagementDocument[]; msa: OrgDocument | null; payments: EngagementPayment[];
  onBack: () => void; reload: () => void;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<null | 'edit' | 'upload' | 'openings' | 'msa'>(null);
  const linked = openings.filter(o => (eng.openingCodes || []).includes(o.id));
  const paid = payments.filter(p => p.status === 'Paid').reduce((s, p) => s + p.amount, 0);
  const pending = payments.filter(p => p.status !== 'Paid').reduce((s, p) => s + p.amount, 0);
  const opTitle = (code: string) => openings.find(o => o.id === code)?.title || code;

  const dealsList = eng.deals || [];
  const totalValue = dealsList.length ? dealsList.reduce((s, d) => s + (d.value || 0), 0) : (eng.value || 0);
  const headerStats = dealsList.length
    ? [{ l: 'Deal value', v: fmtMoney(totalValue), icon: 'circle-dollar-sign' }, { l: 'Deals', v: String(dealsList.length), icon: 'refresh-cw' }]
    : [{ l: 'Deal value', v: fmtMoney(eng.value), icon: 'circle-dollar-sign' }, { l: 'Owner', v: eng.ownerName || '—', icon: 'user-round' }, { l: 'Close date', v: eng.closeDate || '—', icon: 'calendar' }];

  const groups = ['MSA', 'Service Quote', 'SOW', 'Other'].map(t => ({
    type: t,
    rows: t === 'MSA' ? (msa ? [{ ...msa, linkedFromOrg: true }] : []) : docs.filter(d => d.type === t),
  })).filter(g => g.rows.length || g.type !== 'Other');

  async function removeDoc(id: string) {
    try { await deleteDoc(doc(db, 'engagementDocuments', id)); reload(); }
    catch (e) { console.error('[engagements] remove failed', e); alert('Could not remove — check permissions.'); }
  }

  return (
    <div>
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14, background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 600, color: NW.gray500, padding: 0 }}><Icon name="arrow-left" size={14} color={NW.gray500} /> All engagements</button>

      {/* Header — the engagement, with its HubSpot deal(s) shown visually */}
      <Card pad={18} style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.03em', margin: 0 }}>{eng.title}</h2>
              {dealsList.length ? <HubspotBadge>{dealsList.length === 1 ? 'Synced from HubSpot' : `${dealsList.length} HubSpot deals`}</HubspotBadge> : <span style={{ fontSize: 10.5, fontWeight: 600, color: NW.gray500, background: NW.gray50, border: `1px solid ${NW.gray100}`, borderRadius: 999, padding: '3px 9px' }}>Entered manually</span>}
            </div>
            <div style={{ fontSize: 12, color: NW.gray500, marginTop: 5 }}>{org.name} · created {fmtDate(eng.createdAt)}{eng.createdBy ? ` by ${eng.createdBy}` : ''}</div>
          </div>
          <Button variant="secondary" size="sm" icon="pencil" onClick={() => setModal('edit')}>Edit deal</Button>
        </div>

        <div style={{ marginTop: 16, paddingTop: 15, borderTop: `1px solid ${NW.gray100}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
          {dealsList.length === 1 && dealsList[0].stages?.length ? (
            <StageTracker stages={dealsList[0].stages} />
          ) : dealsList.length ? (
            <span style={{ fontSize: 12.5, color: NW.gray500 }}>{dealsList.length} deals — stages below</span>
          ) : (
            <StagePill label={eng.stage} type={manualStageType(eng.stage)} />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            {headerStats.map(s => (
              <div key={s.l} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, background: NW.gray50, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={s.icon as never} size={15} color={NW.gray500} /></span>
                <span>
                  <span style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: NW.gray400 }}>{s.l}</span>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: NW.black, marginTop: 1 }}>{s.v}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {dealsList.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dealsList.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 11, border: `1px solid ${NW.gray100}`, background: NW.white }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: '#FF7A5914', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="refresh-cw" size={13} color="#B4531E" /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: NW.black, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</div>
                  <div style={{ fontSize: 11.5, color: NW.gray500 }}>{fmtMoney(d.value)}{d.ownerName ? ' · ' + d.ownerName : ''}{d.closeDate ? ' · closes ' + d.closeDate : ''}</div>
                </div>
                <StagePill label={d.stageLabel} type={d.stageType} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Legal */}
      <Card pad={18} style={{ marginBottom: 14 }}>
        <CardHead icon="file-text" title="Legal" sub={`${docs.length + (msa ? 1 : 0)} documents · staff-only`}
          action={<Button variant="secondary" size="sm" icon="plus" onClick={() => setModal('upload')}>Upload</Button>} />
        {groups.map(g => (
          <div key={g.type} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: NW.gray400 }}>{g.type}</span>
              {g.type === 'MSA' && <span style={{ fontSize: 11, color: NW.gray400 }}>· linked from {org.name} — covers all engagements</span>}
            </div>
            {g.rows.length ? g.rows.map(d => {
              const linkedFromOrg = 'linkedFromOrg' in d;
              return (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', border: `1px solid ${NW.gray100}`, borderRadius: 11, background: NW.white, marginBottom: 7 }}>
                  <span style={{ width: 32, height: 32, borderRadius: 8, background: NW.rose500 + '14', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="file-text" size={15} color={NW.rose500} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: NW.black, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</div>
                    <div style={{ fontSize: 11.5, color: NW.gray500 }}>{fmtDate(d.uploadedAt)}{d.uploadedBy ? ' · ' + d.uploadedBy : ''}{d.size ? ' · ' + d.size : ''}{(d as EngagementDocument).openingCodes?.length ? ' · ' + (d as EngagementDocument).openingCodes!.map(opTitle).join(', ') : ''}</div>
                  </div>
                  {linkedFromOrg && <span style={{ fontSize: 11, color: NW.gray600, background: NW.gray50, border: `1px solid ${NW.gray100}`, borderRadius: 999, padding: '3px 9px' }}>Account level</span>}
                  <TypeBadge type={d.type} />
                  <DocStatusPill status={d.status} />
                  {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" title="Download" style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${NW.gray200}`, background: NW.white, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="download" size={14} color={NW.gray600} /></a>}
                  {!linkedFromOrg && <button title="Remove" onClick={() => removeDoc(d.id)} style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${NW.gray200}`, background: NW.white, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="trash-2" size={14} color={NW.rose500} /></button>}
                </div>
              );
            }) : g.type === 'MSA' ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 12.5, color: NW.gray500, padding: '11px 12px', border: `1px dashed ${NW.gray200}`, borderRadius: 11, background: NW.offWhite }}>
                <span>No MSA on file for {org.name} yet — it covers every engagement once added.</span>
                <Button variant="secondary" size="sm" icon="upload" onClick={() => setModal('msa')}>Upload MSA</Button>
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: NW.gray400, padding: '9px 12px', border: `1px dashed ${NW.gray200}`, borderRadius: 11, background: NW.offWhite }}>
                {`No ${g.type.toLowerCase()} yet.`}
              </div>
            )}
          </div>
        ))}
      </Card>

      {/* Operations — openings */}
      <Card pad={18} style={{ marginBottom: 14 }}>
        <CardHead icon="briefcase" title="Openings" sub={`${linked.length} role${linked.length === 1 ? '' : 's'} covered by this deal`}
          action={<Button variant="secondary" size="sm" icon="link" onClick={() => setModal('openings')}>Link openings</Button>} />
        {linked.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {linked.map(op => (
              <div key={op.id} onClick={() => router.push(`/openings?id=${op.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 13px', borderRadius: 11, cursor: 'pointer', border: `1px solid ${NW.gray100}`, background: NW.white }}
                onMouseEnter={e => { e.currentTarget.style.background = NW.gray50; }} onMouseLeave={e => { e.currentTarget.style.background = NW.white; }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: NW.teal500 + '18', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="briefcase" size={15} color={NW.teal600} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: NW.black }}>{op.title}</div>
                  <div style={{ fontSize: 11.5, color: NW.gray500 }}>{[op.department, op.location].filter(Boolean).join(' · ') || 'Role'}</div>
                </div>
                <span style={{ fontSize: 11, color: NW.gray400, textTransform: 'uppercase' }}>{op.code || op.id}</span>
                {typeof op.applicationCount === 'number' && <span style={{ fontSize: 11.5, color: NW.gray500 }}><span style={{ color: NW.gray700 }}>{op.applicationCount}</span> applicants</span>}
                <Icon name="chevron-right" size={15} color={NW.gray300} />
              </div>
            ))}
          </div>
        ) : <EngEmpty icon="briefcase" title="No openings linked yet" sub="Tick the roles this deal covers — documents can then be tagged to them." action={<Button variant="secondary" size="sm" icon="link" onClick={() => setModal('openings')}>Link openings</Button>} />}
      </Card>

      {/* Payments */}
      <Card pad={18}>
        <CardHead icon="credit-card" title="Payments" sub="Read-only mirror of Stripe & Mercury"
          action={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: NW.gray500 }}><Icon name="lock" size={12} color={NW.gray400} />Admin never moves money</span>} />
        {payments.length ? (<>
          <div style={{ display: 'flex', gap: 26, marginBottom: 14 }}>
            <div><div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: NW.gray400 }}>Collected</div><div style={{ fontSize: 17, fontWeight: 700, color: NW.teal700, marginTop: 3 }}>{fmtMoney(paid)}</div></div>
            <div><div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: NW.gray400 }}>Outstanding</div><div style={{ fontSize: 17, fontWeight: 700, color: pending ? '#A16207' : NW.gray400, marginTop: 3 }}>{fmtMoney(pending)}</div></div>
          </div>
          {payments.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 4px', borderTop: `1px solid ${NW.gray100}` }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: p.source === 'stripe' ? '#635BFF18' : '#12866E18', color: p.source === 'stripe' ? '#635BFF' : '#12866E', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{p.source === 'stripe' ? 'S' : 'M'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: NW.black, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.description}</div>
                <div style={{ fontSize: 11.5, color: NW.gray500 }}>{p.date} · {p.source === 'stripe' ? 'Stripe' : 'Mercury'}{p.externalId ? ' · ' + p.externalId : ''}</div>
              </div>
              <span style={{ fontSize: 13, color: NW.black }}>{fmtMoney(p.amount)}</span>
              <DocStatusPill status={p.status} />
            </div>
          ))}
        </>) : <EngEmpty icon="credit-card" title="No payments yet" sub="Invoices appear here once Stripe or Mercury records activity for this deal." />}
      </Card>

      {modal === 'edit' && <EngagementModal eng={eng} orgId={org.id} orgName={org.name} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'upload' && <UploadDocModal engagementId={eng.id} orgId={org.id} openings={linked} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'openings' && <LinkOpeningsModal engagement={eng} orgOpenings={openings} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'msa' && <MsaModal org={org} msa={msa} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
    </div>
  );
}

// ── The tab: list + detail router ─────────────────────────────────────────────
export function EngagementsTab({ org, openings }: { org: Organization; openings: Opening[] }) {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [docs, setDocs] = useState<EngagementDocument[]>([]);
  const [msa, setMsa] = useState<OrgDocument | null>(null);
  const [payments, setPayments] = useState<EngagementPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'new' | 'msa'>(null);

  const reload = useCallback(async () => {
    async function safe<T>(p: Promise<T>, fallback: T): Promise<T> { try { return await p; } catch (e) { console.error('[engagements] query failed', e); return fallback; } }
    const [engSnap, docSnap, msaSnap, paySnap] = await Promise.all([
      safe(getDocs(query(collection(db, 'engagements'), where('orgId', '==', org.id))), null),
      safe(getDocs(query(collection(db, 'engagementDocuments'), where('orgId', '==', org.id))), null),
      safe(getDocs(query(collection(db, 'organizationDocuments'), where('orgId', '==', org.id))), null),
      safe(getDocs(query(collection(db, 'engagementPayments'), where('orgId', '==', org.id))), null),
    ]);
    setEngagements(engSnap ? engSnap.docs.map(d => ({ ...d.data(), id: d.id }) as Engagement) : []);
    setDocs(docSnap ? docSnap.docs.map(d => ({ ...d.data(), id: d.id }) as EngagementDocument) : []);
    const msaDoc = msaSnap?.docs.find(d => (d.data() as OrgDocument).type === 'MSA');
    setMsa(msaDoc ? ({ ...msaDoc.data(), id: msaDoc.id } as OrgDocument) : null);
    setPayments(paySnap ? paySnap.docs.map(d => ({ ...d.data(), id: d.id }) as EngagementPayment) : []);
    setLoading(false);
  }, [org.id]);

  useEffect(() => { setLoading(true); reload(); }, [reload]);

  const open = openId ? engagements.find(e => e.id === openId) : null;

  if (open) {
    return (
      <div style={{ marginTop: 20 }}>
        <EngagementDetail
          eng={open} org={org} openings={openings}
          docs={docs.filter(d => d.engagementId === open.id)}
          msa={msa}
          payments={payments.filter(p => p.engagementId === open.id)}
          onBack={() => setOpenId(null)} reload={reload}
        />
      </div>
    );
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: NW.gray500 }}>{engagements.length} {engagements.length === 1 ? 'engagement' : 'engagements'} — each one deal: contracts, the roles it covers, and its money.</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" size="sm" icon="file-text" onClick={() => setModal('msa')}>{msa ? 'Account MSA' : 'Upload MSA'}</Button>
          <Button size="sm" icon="plus" onClick={() => setModal('new')}>New engagement</Button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 13, color: NW.gray400 }}>Loading engagements…</div>
      ) : engagements.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {engagements.map(e => {
            const eDocs = docs.filter(d => d.engagementId === e.id);
            const unsigned = eDocs.filter(d => d.status !== 'Signed').length;
            const pays = payments.filter(p => p.engagementId === e.id);
            const outstanding = pays.filter(p => p.status !== 'Paid').reduce((s, p) => s + p.amount, 0);
            const primary = e.deals?.[0];
            return (
              <Card key={e.id} pad={17} hover onClick={() => setOpenId(e.id)}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: NW.black, letterSpacing: '-0.02em' }}>{e.title}</span>
                      {e.deals?.length ? <HubspotBadge>{e.deals.length === 1 ? 'HubSpot' : `${e.deals.length} deals`}</HubspotBadge> : null}
                    </div>
                    <div style={{ fontSize: 12, color: NW.gray500, marginTop: 4 }}>{fmtMoney(e.value)}{e.deals?.length ? ` · ${e.deals.length} deal${e.deals.length === 1 ? '' : 's'}` : (e.ownerName ? ' · ' + e.ownerName : '')}{!e.deals?.length && e.closeDate ? ' · closes ' + e.closeDate : ''}</div>
                  </div>
                  {primary ? <StagePill label={primary.stageLabel} type={primary.stageType} /> : <StagePill label={e.stage} type={manualStageType(e.stage)} />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 14, paddingTop: 13, borderTop: `1px solid ${NW.gray100}`, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: NW.gray600 }}><Icon name="file-text" size={13} color={NW.gray400} />{eDocs.length + (msa ? 1 : 0)} docs{unsigned ? <span style={{ color: '#A16207', fontWeight: 600 }}> · {unsigned} unsigned</span> : null}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: NW.gray600 }}><Icon name="briefcase" size={13} color={NW.gray400} />{(e.openingCodes || []).length} openings</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: NW.gray600 }}><Icon name="credit-card" size={13} color={NW.gray400} />{pays.length} payments{outstanding ? <span style={{ color: '#A16207', fontWeight: 600 }}> · {fmtMoney(outstanding)} out</span> : null}</span>
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, color: NW.teal600 }}>Open <Icon name="arrow-right" size={14} color={NW.teal600} /></span>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EngEmpty icon="folder-open" title="No engagements yet" sub={`Create one per deal with ${org.name} — it holds the contracts, the roles and the invoices in one place.`} action={<Button size="sm" icon="plus" onClick={() => setModal('new')}>New engagement</Button>} />
      )}

      {modal === 'new' && <EngagementModal orgId={org.id} orgName={org.name} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'msa' && <MsaModal org={org} msa={msa} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
    </div>
  );
}
