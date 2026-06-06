'use client';

import {
  useEffect, useState, useRef, useCallback, useMemo, Suspense,
  type ReactNode, type Dispatch, type SetStateAction,
} from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  auth, db, onAuthStateChanged, isNearworkEmail,
  doc, getDoc, updateDoc, collection, query, where, getDocs, onSnapshot,
  serverTimestamp,
} from '@/lib/firebase';
import type { User } from '@/lib/firebase';
import type { Organization } from '@/lib/types';
import { useStaff, type StaffOption } from '@/components/ui/staff-picker';
import type { AirtableRole } from '@/app/api/airtable-roles/route';

// ─── Types ────────────────────────────────────────────────────────────────────

type BriefStatus = 'draft' | 'submitted' | 'changes_requested' | 'approved';

interface AuditEntry {
  action: string;
  by: string;
  byRole: 'nearwork' | 'client';
  timestamp: string;
  note?: string;
}

interface BriefData {
  id: string;
  status?: BriefStatus;
  history?: AuditEntry[];
  nearworkApprovedBy?: string;
  clientApprovedBy?: string;
  [key: string]: unknown;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// ─── Section definitions (S6 Interview Process removed) ───────────────────────

const SECTIONS = [
  { id: 's1',    num: 1,  icon: '🎯', label: 'Role Overview' },
  { id: 's2',    num: 2,  icon: '💰', label: 'Compensation' },
  { id: 's3',    num: 3,  icon: '📋', label: 'Role Description' },
  { id: 's4',    num: 4,  icon: '🎓', label: 'Requirements' },
  { id: 's5',    num: 5,  icon: '🤝', label: 'Team & Culture' },
  { id: 's7',    num: 6,  icon: '🛠️', label: 'Tools & Tech' },
  { id: 's8',    num: 7,  icon: '🏢', label: 'NW Assignment' },
  { id: 's9',    num: 8,  icon: '📄', label: 'Administrative' },
  { id: 's10',   num: 9,  icon: '📝', label: 'Additional Notes' },
  { id: 'audit', num: 0,  icon: '📋', label: 'Audit Trail' },
] as const;

// ─── Kickoff inner component ──────────────────────────────────────────────────

function KickoffInner() {
  const params = useSearchParams();
  const pipelineCode = params?.get('code') ?? '';
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'auth-error' | 'error' | 'ready'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [openingData, setOpeningData] = useState<Record<string, unknown> | null>(null);
  const [_briefData, setBriefData] = useState<BriefData | null>(null);
  const [status, setStatus] = useState<BriefStatus>('draft');
  const [auditHistory, setAuditHistory] = useState<AuditEntry[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [changesBannerNote, setChangesBannerNote] = useState('');
  const [approvedMeta, setApprovedMeta] = useState('');

  // Opening metadata (editable inline on this page)
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [editingMeta, setEditingMeta] = useState(false);

  // Submission validation error
  const [submitError, setSubmitError] = useState('');

  // Confirm modal
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'submit' | 'reopen' | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [confirmLoading, setConfirmLoading] = useState(false);

  // Dynamic lists
  const [keyResponsibilities, setKeyResponsibilities] = useState<string[]>(['']);
  const [mustHaveSkills, setMustHaveSkills] = useState<string[]>(['']);
  const [niceToHaveSkills, setNiceToHaveSkills] = useState<string[]>(['']);
  const [requiredCertifications, setRequiredCertifications] = useState<string[]>([]);
  const [requiredTools, setRequiredTools] = useState<string[]>(['']);
  const [techStack, setTechStack] = useState<string[]>(['']);
  const [sourcingChannels, setSourcingChannels] = useState<string[]>(['']);

  // Recruiter (controlled — also stores email)
  const [assignedRecruiter, setAssignedRecruiter] = useState('');
  const [assignedRecruiterEmail, setAssignedRecruiterEmail] = useState('');

  // Account Manager (controlled — also stores email)
  const [accountManager, setAccountManager] = useState('');
  const [accountManagerEmail, setAccountManagerEmail] = useState('');

  // Airtable roles
  const [airtableRoles, setAirtableRoles] = useState<AirtableRole[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError, setRolesError] = useState('');

  // Nearwork staff (for recruiter picker)
  const staff = useStaff();

  // Anchored Rail: active section tracker
  const [activeSection, setActiveSection] = useState('s1');

  const formRef = useRef<HTMLFormElement>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jobTitleInputRef = useRef<HTMLInputElement>(null);

  // Computed selected role (for suggested rates in S2)
  const selectedRole = useMemo(
    () => airtableRoles.find((r) => r.id === selectedRoleId) ?? null,
    [airtableRoles, selectedRoleId],
  );

  // Timeline entries for Item 9 — who submitted, when partner reviewed, decision
  const timelineSubmitted = useMemo(
    () => auditHistory.find((h) => h.action === 'submitted') ?? null,
    [auditHistory],
  );
  const timelineDecision = useMemo(
    () => [...auditHistory].reverse().find((h) => h.action === 'approved' || h.action === 'changes_requested') ?? null,
    [auditHistory],
  );

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      if (!u) { setLoadState('auth-error'); return; }
      if (!isNearworkEmail(u.email ?? '')) { setLoadState('auth-error'); return; }
      setUser(u);
    });
  }, []);

  // ── Load Airtable roles ───────────────────────────────────────────────────
  // rolesLoading / rolesError are already initialised to true / '' in useState —
  // no need to reset them synchronously at the top of the effect.
  useEffect(() => {
    fetch('/api/airtable-roles')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && Array.isArray(d.roles) && d.roles.length > 0) {
          setAirtableRoles(d.roles);
        } else if (d.ok && Array.isArray(d.roles) && d.roles.length === 0) {
          setRolesError('No roles found — check that AIRTABLE_BASE and AIRTABLE_KEY are set in Vercel, and that your table is named "Roles", "Job Roles", or "Positions".');
        } else {
          setRolesError(d.error || 'Airtable not configured (AIRTABLE_BASE / AIRTABLE_KEY missing in Vercel).');
        }
      })
      .catch(() => setRolesError('Could not reach /api/airtable-roles — check Vercel logs.'))
      .finally(() => setRolesLoading(false));
  }, []);

  // ── Load orgs ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    getDocs(collection(db, 'organizations'))
      .then((snap) => setOrgs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Organization))))
      .catch(() => {/* non-critical */});
  }, [user]);

  // ── Load pipeline + brief ─────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !pipelineCode) return;

    let unsubBrief: (() => void) | null = null;

    async function load() {
      try {
        // Try pipelines collection first, then openings
        const pSnap = await getDoc(doc(db, 'pipelines', pipelineCode));
        let opening: Record<string, unknown> | null = null;
        if (pSnap.exists()) {
          opening = { id: pSnap.id, ...pSnap.data() };
        } else {
          const oQuery = query(collection(db, 'openings'), where('code', '==', pipelineCode));
          const oDocs = await getDocs(oQuery);
          if (!oDocs.empty) {
            opening = { id: oDocs.docs[0].id, ...oDocs.docs[0].data() };
          }
        }

        // Also load the opening doc directly for metadata (title, orgId, etc.)
        const openingSnap = await getDoc(doc(db, 'openings', pipelineCode));
        if (openingSnap.exists()) {
          opening = { ...(opening ?? {}), ...openingSnap.data(), id: pipelineCode };
        }

        if (!opening) {
          setErrorMsg(`No opening found with code "${pipelineCode}"`);
          setLoadState('error');
          return;
        }

        setOpeningData(opening);
        setSelectedOrgId(String(opening.orgId ?? ''));

        // Subscribe to brief
        unsubBrief = onSnapshot(doc(db, 'kickoffBriefs', pipelineCode), (snap) => {
          if (snap.exists()) {
            const brief = { id: snap.id, ...snap.data() } as BriefData;
            setBriefData(brief);
            // eslint-disable-next-line react-hooks/immutability
            applyBriefToForm(brief, opening!);
            const s = (brief.status ?? 'draft') as BriefStatus;
            setStatus(s);
            setAuditHistory(brief.history ?? []);
            const ro = s === 'approved' || s === 'submitted';
            setIsReadOnly(ro);
            if (s === 'changes_requested') {
              const last = [...(brief.history ?? [])].reverse().find((h) => h.action === 'changes_requested');
              setChangesBannerNote(last ? `"${last.note}" — ${last.by}, ${formatDate(last.timestamp)}` : '');
            }
            if (s === 'approved') {
              setApprovedMeta(`Nearwork: ${brief.nearworkApprovedBy ?? '—'} · Client: ${brief.clientApprovedBy ?? '—'}`);
            }
          } else {
            // New brief — pre-fill S1 job title from the opening's title
             
            applyBriefToForm({} as BriefData, opening!);
          }
        });

        setLoadState('ready');
      } catch (e: unknown) {
        setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
        setLoadState('error');
      }
    }

    load();
    return () => { unsubBrief?.(); };
  }, [user, pipelineCode]);

  // ── IntersectionObserver — Anchored Rail active section ───────────────────
  useEffect(() => {
    if (loadState !== 'ready') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActiveSection(visible[0].target.id);
      },
      { threshold: 0.15 },
    );
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [loadState]);

  // ── Apply brief + opening data to form ────────────────────────────────────
  function applyBriefToForm(brief: BriefData, opening: Record<string, unknown>) {
    const simpleFields = [
      'jobTitle', 'department', 'locationPolicy', 'employmentType', 'numberOfPositions',
      'targetStartDate', 'urgency', 'colombiaViable', 'locationNotes',
      'salaryMin', 'salaryMax', 'currency', 'payFrequency', 'signOnBonus', 'variablePay',
      'equity', 'benefitsPackage', 'additionalPerks', 'roleSummary', 'dayToDay',
      'success30', 'success60', 'success90', 'yearsOfExperience', 'educationLevel',
      'fieldOfStudy', 'englishLevel', 'otherLanguages', 'backgroundCheck', 'industryExperience',
      'teamSize', 'reportsToTitle', 'reportsToName', 'directReports', 'workingStyle',
      'worksCloselyWith', 'workingHours', 'timezoneRequirements', 'remotePolicyDetails',
      'teamCultureNotes', 'internalSystems', 'trainingProvided', 'trainingDetails',
      'sourcingStartDate', 'candidateDeadline', 'targetCandidateVolume',
      'reportingCadence', 'reportingFormat', 'searchStrategyNotes', 'internalNotes',
      'contractType', 'probationPeriod', 'noticePeriod', 'workAuthRequired', 'nonCompeteNda',
      'equipmentProvidedBy', 'additionalNotes', 'otherDiscussed',
    ];
    if (formRef.current) {
      simpleFields.forEach((k) => {
        const el = formRef.current?.elements.namedItem(k) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
        const val = brief[k] ?? (k === 'jobTitle' ? opening.title : undefined);
        if (el && val != null) el.value = String(val);
      });
    }

    if (Array.isArray(brief.keyResponsibilities)) setKeyResponsibilities(brief.keyResponsibilities as string[]);
    if (Array.isArray(brief.mustHaveSkills)) setMustHaveSkills(brief.mustHaveSkills as string[]);
    if (Array.isArray(brief.niceToHaveSkills)) setNiceToHaveSkills(brief.niceToHaveSkills as string[]);
    if (Array.isArray(brief.requiredCertifications)) setRequiredCertifications(brief.requiredCertifications as string[]);
    if (Array.isArray(brief.requiredTools)) setRequiredTools(brief.requiredTools as string[]);
    if (Array.isArray(brief.techStack)) setTechStack(brief.techStack as string[]);
    if (Array.isArray(brief.sourcingChannels)) setSourcingChannels(brief.sourcingChannels as string[]);

    // Controlled fields
    if (brief.assignedRecruiter) setAssignedRecruiter(String(brief.assignedRecruiter));
    else if (opening.recruiter) setAssignedRecruiter(String(opening.recruiter));
    if (brief.assignedRecruiterEmail) setAssignedRecruiterEmail(String(brief.assignedRecruiterEmail));
    if (brief.accountManager) setAccountManager(String(brief.accountManager));
    if (brief.accountManagerEmail) setAccountManagerEmail(String(brief.accountManagerEmail));
    if (brief.airtableRoleId) setSelectedRoleId(String(brief.airtableRoleId));
  }

  // ── Collect form data ─────────────────────────────────────────────────────
  function collectFormData() {
    if (!formRef.current) return {};
    const fd = new FormData(formRef.current);
    const data: Record<string, unknown> = {};
    fd.forEach((v, k) => {
      const s = String(v).trim();
      if (s) data[k] = s;
    });
    // Send empty strings as-is so Firestore drafts preserve in-progress empty items.
    // The server strips empties only on 'submit' (see sanitizeBriefFields in api/kickoff/route.ts).
    data.keyResponsibilities = keyResponsibilities;
    data.mustHaveSkills = mustHaveSkills;
    data.niceToHaveSkills = niceToHaveSkills;
    data.requiredCertifications = requiredCertifications;
    data.requiredTools = requiredTools;
    data.techStack = techStack;
    data.sourcingChannels = sourcingChannels;
    // Controlled fields not in the DOM form
    if (assignedRecruiter) data.assignedRecruiter = assignedRecruiter;
    if (assignedRecruiterEmail) data.assignedRecruiterEmail = assignedRecruiterEmail;
    if (accountManager) data.accountManager = accountManager;
    if (accountManagerEmail) data.accountManagerEmail = accountManagerEmail;
    if (selectedRoleId) {
      data.airtableRoleId = selectedRoleId;
      // When a catalog role is selected, the jobTitle input is disabled so FormData
      // skips it — pull the title from the roles list (or the DOM node as fallback).
      if (!data.jobTitle) {
        const role = airtableRoles.find((r) => r.id === selectedRoleId);
        if (role?.name) data.jobTitle = role.name;
        else if (jobTitleInputRef.current?.value) data.jobTitle = jobTitleInputRef.current.value;
      }
    }
    return data;
  }

  // ── Sync metadata back to the opening doc ────────────────────────────────
  async function syncOpeningMeta() {
    if (!pipelineCode) return;
    try {
      const formData = collectFormData();
      const jobTitle = String(formData.jobTitle ?? '').trim();
      const org = orgs.find((o) => o.id === selectedOrgId);
      const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (jobTitle) updates.title = jobTitle;
      if (selectedOrgId) { updates.orgId = selectedOrgId; updates.orgName = org?.name ?? ''; }
      await Promise.all([
        updateDoc(doc(db, 'openings', pipelineCode), updates),
        updateDoc(doc(db, 'pipelines', pipelineCode), updates),
      ]);
    } catch {
      // Non-critical
    }
  }

  // ── API call ──────────────────────────────────────────────────────────────
  async function callAPI(action: string, extraData: Record<string, unknown> = {}) {
    if (!user) throw new Error('Not authenticated');
    const org = orgs.find((o) => o.id === selectedOrgId);
    const token = await user.getIdToken();
    const res = await fetch('/api/kickoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action,
        code: pipelineCode,
        orgId: (selectedOrgId || (openingData?.orgId as string)) ?? '',
        orgName: org?.name ?? (openingData?.orgName as string) ?? '',
        ...collectFormData(),
        ...extraData,
      }),
    });
    let data: { ok: boolean; error?: string };
    try {
      data = await res.json();
    } catch {
      throw new Error(`Server error (${res.status}). Check Vercel logs.`);
    }
    if (!data.ok) throw new Error(data.error ?? 'API error');
    return data;
  }

  // ── Auto-save ─────────────────────────────────────────────────────────────
  const saveDraft = useCallback(async () => {
    if (isReadOnly) return;
    try {
      setSaveState('saving');
      await Promise.all([callAPI('save'), syncOpeningMeta()]);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 3000);
    } catch (e) {
      setSaveState('error');
      console.error('Auto-save failed:', e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReadOnly, user, pipelineCode, openingData, selectedOrgId, orgs,
      keyResponsibilities, mustHaveSkills, niceToHaveSkills, requiredCertifications,
      requiredTools, techStack, sourcingChannels, assignedRecruiter,
      assignedRecruiterEmail, accountManager, accountManagerEmail, selectedRoleId]);

  function scheduleAutoSave() {
    if (isReadOnly) return;
    setSaveState('saving');
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(saveDraft, 2500);
  }

  // Cancels any pending auto-save — passed to DynamicList so clicking
  // "+ Add item" can't race with an in-flight save timer.
  const cancelAutoSave = useCallback(() => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
      setSaveState('idle');
    }
  }, []);

  // ── Submit validation ─────────────────────────────────────────────────────
  function validateBeforeSubmit(): string | null {
    if (!selectedOrgId) {
      return 'Please select an organization before submitting. Click the title/pencil icon at the top to assign one.';
    }
    const jobTitleEl = formRef.current?.elements.namedItem('jobTitle') as HTMLInputElement | null;
    const title = (jobTitleEl?.value ?? '').trim() || openingTitle;
    if (!title) {
      return 'Please fill in the Job Title (Section 1) before submitting.';
    }
    return null;
  }

  // ── Confirm modal ─────────────────────────────────────────────────────────
  function openConfirm(action: 'submit' | 'reopen') {
    if (action === 'submit') {
      const err = validateBeforeSubmit();
      if (err) { setSubmitError(err); return; }
      setSubmitError('');
    }
    setPendingAction(action);
    setConfirmInput('');
    setConfirmOpen(true);
  }

  async function executeAction() {
    if (!pendingAction) return;
    const action = pendingAction;
    setConfirmLoading(true);
    try {
      await callAPI(action);
      if (action !== 'reopen') await syncOpeningMeta();
      setConfirmOpen(false);
      setPendingAction(null);
      // After submitting, go straight to the Opening Sheet so the team can
      // fill it out while the client reviews the brief.
      if (action === 'submit' && pipelineCode) {
        router.push(`/openings/${pipelineCode}`);
      }
    } catch (e) {
      alert('Error: ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally {
      setConfirmLoading(false);
    }
  }

  // ── Copy client link ──────────────────────────────────────────────────────
  const [copyLabel, setCopyLabel] = useState('Copy client link');
  function copyClientLink() {
    navigator.clipboard.writeText(`https://app.nearwork.co/pipeline/${pipelineCode}/kickoff`).then(() => {
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy client link'), 2000);
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const openingTitle = String((openingData?.title ?? openingData?.openingTitle ?? '').toString().trim() || '');
  const openingOrg = String((openingData?.orgName ?? '').toString().trim() || '');
  const displayTitle = openingTitle || 'Untitled opening';

  const statusBadge = {
    draft:             { cls: 'bg-[#F5F4F0] text-[#777] border border-[#E5E4E0]', label: 'Draft' },
    submitted:         { cls: 'bg-blue-50 text-blue-600 border border-blue-200',   label: 'Pending review' },
    changes_requested: { cls: 'bg-amber-50 text-amber-800 border border-amber-200', label: 'Changes requested' },
    approved:          { cls: 'bg-emerald-50 text-emerald-800 border border-emerald-200', label: 'Approved' },
  }[status];

  const saveIndicatorCls = saveState === 'saving' ? 'text-amber-400' : saveState === 'saved' ? 'text-teal-400' : 'text-white/25';
  const confirmExpected = pendingAction === 'submit' ? 'SUBMIT' : 'REOPEN';
  const confirmReady = confirmInput.trim().toUpperCase() === confirmExpected;

  // ── Loading / error states ────────────────────────────────────────────────
  if (loadState === 'loading') {
    return (
      <div className="min-h-screen bg-[#F5F4F0] flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-[#E5E4E0] border-t-[#16A085] rounded-full animate-spin" />
        <p className="text-[#9E9E9E] text-sm">Loading brief…</p>
      </div>
    );
  }
  if (loadState === 'auth-error') {
    return (
      <div className="min-h-screen bg-[#F5F4F0] flex flex-col items-center justify-center gap-3 text-center px-4">
        <div className="text-5xl">🔒</div>
        <p className="text-base font-bold">Access restricted</p>
        <p className="text-[#9E9E9E] text-sm">Only Nearwork staff can access this page.</p>
        <a href="/login" className="mt-2 px-4 py-2 bg-[#16A085] text-white text-xs font-semibold rounded-lg">Sign in</a>
      </div>
    );
  }
  if (loadState === 'error') {
    return (
      <div className="min-h-screen bg-[#F5F4F0] flex flex-col items-center justify-center gap-3 text-center px-4">
        <div className="text-4xl">⚠️</div>
        <p className="text-base font-bold">Error</p>
        <p className="text-[#9E9E9E] text-sm">{errorMsg}</p>
      </div>
    );
  }

  // ── Full page ─────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Top nav ─────────────────────────────────────────────────────── */}
      <nav className="h-13 bg-[#111] flex items-center px-5 gap-3 sticky top-0 z-50 border-b border-white/8">
        <a href="/dashboard" className="text-[15px] font-black text-white tracking-tight">Near<span className="text-[#16A085]">work</span></a>
        <div className="w-px h-4 bg-white/15" />
        <button onClick={() => history.back()} className="text-white/55 text-xs hover:text-white/90 flex items-center gap-1 transition-colors">
          ← Back
        </button>
        <div className="w-px h-4 bg-white/15" />
        <span className="text-white/80 text-xs font-semibold">Kick-off Brief</span>
        <span className="ml-0.5 text-[10px] text-white/35 font-mono">{pipelineCode}</span>
        <div className="flex-1" />
        <span className={`text-[10px] transition-colors flex items-center gap-1.5 ${saveIndicatorCls}`}>
          {saveState === 'saving' && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
          {saveState === 'saved' && <span className="w-2 h-2 rounded-full bg-teal-400" />}
          {saveState === 'error' && <span className="w-2 h-2 rounded-full bg-red-400" />}
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Save failed' : ''}
        </span>
        <span className="text-white/40 text-[11px] ml-1">{user?.email}</span>
      </nav>

      {/* ── Sub-header: opening identity + action bar ───────────────────── */}
      <div className="bg-white border-b border-[#E5E4E0] px-5 py-3 flex items-center gap-3 flex-wrap sticky top-13 z-40">
        {/* Identity */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="min-w-0">
            {editingMeta ? (
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  autoFocus
                  defaultValue={openingTitle}
                  onBlur={(e) => {
                    const newTitle = e.target.value.trim();
                    if (newTitle && newTitle !== openingTitle) {
                      setOpeningData((d) => d ? { ...d, title: newTitle } : d);
                      updateDoc(doc(db, 'openings', pipelineCode), { title: newTitle, updatedAt: serverTimestamp() }).catch(() => null);
                      updateDoc(doc(db, 'pipelines', pipelineCode), { title: newTitle, openingTitle: newTitle, updatedAt: serverTimestamp() }).catch(() => null);
                      const el = formRef.current?.elements.namedItem('jobTitle') as HTMLInputElement | null;
                      if (el) el.value = newTitle;
                    }
                    setEditingMeta(false);
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingMeta(false); }}
                  className="text-sm font-bold text-[#111] border-b-2 border-[#16A085] bg-transparent outline-none w-64 pb-0.5"
                  placeholder="e.g. Senior Software Engineer"
                />
                <select
                  value={selectedOrgId}
                  onChange={(e) => {
                    const newOrgId = e.target.value;
                    setSelectedOrgId(newOrgId);
                    const org = orgs.find((o) => o.id === newOrgId);
                    setOpeningData((d) => d ? { ...d, orgId: newOrgId, orgName: org?.name ?? '' } : d);
                    updateDoc(doc(db, 'openings', pipelineCode), { orgId: newOrgId, orgName: org?.name ?? '', updatedAt: serverTimestamp() }).catch(() => null);
                    updateDoc(doc(db, 'pipelines', pipelineCode), { orgId: newOrgId, orgName: org?.name ?? '', updatedAt: serverTimestamp() }).catch(() => null);
                    if (submitError) setSubmitError('');
                  }}
                  className="text-xs border border-[#E5E4E0] rounded-md px-2 py-1 bg-white outline-none focus:border-[#16A085]"
                >
                  <option value="">No organization</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <button onClick={() => setEditingMeta(false)} className="text-[11px] text-[#9E9E9E] hover:text-[#16A085]">Done</button>
              </div>
            ) : (
              <button
                onClick={() => setEditingMeta(true)}
                className="group text-left"
                title="Click to edit opening name and organization"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm text-[#111] group-hover:text-[#16A085] transition-colors">{displayTitle}</span>
                  <span className="text-[10px] text-[#C5C4C0] group-hover:text-[#16A085] transition-colors">✏</span>
                </div>
                <div className="text-[11px] text-[#9E9E9E] mt-0.5">
                  {openingOrg
                    ? <>{openingOrg} · {pipelineCode}</>
                    : <><span className="text-amber-600 font-semibold">⚠ No organization — click to set</span> · {pipelineCode}</>
                  }
                </div>
              </button>
            )}
          </div>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusBadge.cls}`}>
            {statusBadge.label}
          </span>
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end gap-1.5 ml-auto">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={copyClientLink}
              className="px-3 py-1.5 bg-white border border-[#E5E4E0] text-[11px] font-semibold rounded-lg hover:border-[#16A085] hover:text-[#16A085] transition-colors"
            >
              {copyLabel}
            </button>
            {(status === 'submitted' || status === 'approved') && (
              <button onClick={() => openConfirm('reopen')} className="px-3 py-1.5 bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-semibold rounded-lg hover:bg-amber-100 transition-colors">
                ↩ Reopen
              </button>
            )}
            {!isReadOnly && (
              <button onClick={saveDraft} className="px-3 py-1.5 bg-white border border-[#E5E4E0] text-[11px] font-semibold rounded-lg hover:border-[#16A085] hover:text-[#16A085] transition-colors">
                Save draft
              </button>
            )}
            {status !== 'approved' && status !== 'submitted' && (
              <button onClick={() => openConfirm('submit')} className="px-3 py-1.5 bg-[#16A085] text-white text-[11px] font-semibold rounded-lg hover:bg-[#12866E] transition-colors">
                Submit for client review →
              </button>
            )}
          </div>
          {/* Validation error shown below buttons */}
          {submitError && (
            <p className="text-[11px] text-red-600 font-semibold max-w-sm text-right">{submitError}</p>
          )}
        </div>
      </div>

      {/* ── Body: Rail + Content ─────────────────────────────────────────── */}
      <div className="flex min-h-[calc(100vh-105px)] bg-[#F5F4F0]">

        {/* ── Anchored Rail ─────────────────────────────────────────────── */}
        <aside className="hidden md:flex flex-col w-[200px] flex-shrink-0 sticky top-[105px] h-[calc(100vh-105px)] bg-white border-r border-[#E5E4E0] overflow-y-auto">
          <div className="px-4 pt-4 pb-3 border-b border-[#F0EFEB]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#9E9E9E]">Progress</span>
              <span className="text-[11px] font-semibold text-[#16A085]">9 sections</span>
            </div>
            <div className="h-1 bg-[#F0EFEB] rounded-full overflow-hidden">
              <div className="h-full bg-[#16A085] rounded-full transition-all" style={{ width: '11%' }} />
            </div>
          </div>

          <nav className="flex flex-col py-2 flex-1">
            {SECTIONS.map(({ id, num, icon, label }) => {
              const isActive = activeSection === id;
              return (
                <a
                  key={id}
                  href={`#${id}`}
                  className={`flex items-center gap-2.5 px-3 py-2 mx-2 rounded-lg text-[12px] font-medium transition-all ${
                    isActive
                      ? 'bg-[#EEF9F6] text-[#16A085] font-semibold'
                      : 'text-[#666] hover:bg-[#F8F7F3] hover:text-[#111]'
                  }`}
                >
                  {num > 0 ? (
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 transition-all ${
                      isActive ? 'bg-[#16A085] text-white' : 'bg-[#F0EFEB] text-[#999]'
                    }`}>
                      {num}
                    </span>
                  ) : (
                    <span className="w-5 h-5 flex items-center justify-center text-sm flex-shrink-0">{icon}</span>
                  )}
                  <span className="truncate leading-snug">{label}</span>
                </a>
              );
            })}
          </nav>
        </aside>

        {/* ── Main content ───────────────────────────────────────────────── */}
        <main className="flex-1 px-6 py-6 max-w-[860px]">

          {/* ── Submission timeline (Item 9) ───────────────────────────────── */}
          {(timelineSubmitted || auditHistory.length > 0) && (
            <div className="bg-white border border-[#E5E4E0] rounded-xl px-5 py-3 mb-5 flex items-center gap-4 flex-wrap text-[11px]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#9E9E9E] flex-shrink-0">Timeline</span>
              {timelineSubmitted ? (
                <span className="flex items-center gap-1.5 text-[#555]">
                  <span className="text-base">📤</span>
                  Submitted by <strong className="text-[#111] font-semibold">{timelineSubmitted.by}</strong>
                  <span className="text-[#9E9E9E]">· {formatDate(timelineSubmitted.timestamp)}</span>
                </span>
              ) : (
                <span className="text-[#9E9E9E] italic">Not yet submitted</span>
              )}
              {timelineSubmitted && !timelineDecision && (
                <span className="flex items-center gap-1.5 text-amber-700">
                  <span className="text-base">⏳</span>
                  Awaiting client review
                </span>
              )}
              {timelineDecision && (
                <span className="flex items-center gap-1.5 text-[#555]">
                  <span className="text-base">{timelineDecision.action === 'approved' ? '✅' : '⚠️'}</span>
                  {timelineDecision.action === 'approved' ? 'Approved' : 'Changes requested'} by{' '}
                  <strong className="text-[#111] font-semibold">{timelineDecision.by}</strong>
                  <span className="text-[#9E9E9E]">· {formatDate(timelineDecision.timestamp)}</span>
                </span>
              )}
            </div>
          )}

          {/* Banners */}
          {status === 'changes_requested' && changesBannerNote && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 flex gap-3">
              <span className="text-lg flex-shrink-0">⚠️</span>
              <div>
                <div className="text-sm font-bold text-amber-800">Client requested changes</div>
                <div className="text-xs text-amber-800 mt-1">{changesBannerNote}</div>
              </div>
            </div>
          )}
          {status === 'approved' && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-5 flex gap-3">
              <span className="text-xl flex-shrink-0">✅</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-emerald-800">Both parties have approved this brief</div>
                <div className="text-xs text-emerald-700 mt-0.5">{approvedMeta}</div>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-emerald-800 font-semibold">Next step:</span>
                  <span className="text-xs text-emerald-700">The role is live on jobs.nearwork.co — edit or pause it from the Opening Sheet.</span>
                  <a
                    href={`/openings/${pipelineCode}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 text-white text-[11px] font-semibold rounded-lg hover:bg-emerald-800 transition-colors"
                  >
                    Go to Opening Sheet →
                  </a>
                </div>
              </div>
            </div>
          )}

          <form ref={formRef} onInput={scheduleAutoSave} className="space-y-5">

            {/* ── S1 Role Overview ──────────────────────────────────────── */}
            <Section id="s1" num={1} icon="🎯" title="Role Overview" desc="Core information about the position and engagement" partnerVisible>

              {/* Organization — required, always visible */}
              <div className={`mb-5 p-4 rounded-xl border-2 ${selectedOrgId ? 'border-[#E5E4E0] bg-white' : 'border-amber-300 bg-amber-50'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#555]">🏢 Organization</span>
                  <span className="text-[10px] font-semibold text-red-500 uppercase tracking-wider">Required</span>
                  {!selectedOrgId && <span className="text-[11px] text-amber-700 font-medium ml-auto">⚠ Must be set before submitting</span>}
                </div>
                <select
                  disabled={isReadOnly}
                  value={selectedOrgId}
                  onChange={(e) => {
                    const newOrgId = e.target.value;
                    setSelectedOrgId(newOrgId);
                    const org = orgs.find((o) => o.id === newOrgId);
                    setOpeningData((d) => d ? { ...d, orgId: newOrgId, orgName: org?.name ?? '' } : d);
                    updateDoc(doc(db, 'openings', pipelineCode), { orgId: newOrgId, orgName: org?.name ?? '', updatedAt: serverTimestamp() }).catch(() => null);
                    updateDoc(doc(db, 'pipelines', pipelineCode), { orgId: newOrgId, orgName: org?.name ?? '', updatedAt: serverTimestamp() }).catch(() => null);
                    if (submitError) setSubmitError('');
                  }}
                  className={`w-full text-sm border rounded-lg px-3 py-2 outline-none transition-colors ${
                    selectedOrgId
                      ? 'border-[#E5E4E0] bg-white focus:border-[#16A085]'
                      : 'border-amber-300 bg-amber-50 focus:border-amber-500 text-amber-900 font-medium'
                  } ${isReadOnly ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <option value="">— Select the client organization —</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                {selectedOrgId && (
                  <div className="text-[11px] text-[#9E9E9E] mt-1.5">
                    Linked to <span className="font-semibold text-[#16A085]">{orgs.find(o => o.id === selectedOrgId)?.name}</span>
                    {' · '}also editable via the pencil icon in the header
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                {/* Job Title — unified Airtable dropdown + custom text input (Item 5) */}
                <Field label="Job Title" required>
                  {rolesLoading ? (
                    <input ref={jobTitleInputRef} name="jobTitle" disabled={isReadOnly} className={inp} placeholder="Loading roles from Airtable…" />
                  ) : rolesError ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">⚠ {rolesError}</div>
                      <input ref={jobTitleInputRef} name="jobTitle" disabled={isReadOnly} className={inp} placeholder="e.g. Senior Software Engineer" />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <select
                        disabled={isReadOnly}
                        value={selectedRoleId || '_custom'}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '_custom') {
                            setSelectedRoleId('');
                            if (jobTitleInputRef.current) jobTitleInputRef.current.value = '';
                          } else {
                            const role = airtableRoles.find((r) => r.id === val);
                            setSelectedRoleId(val);
                            if (role && jobTitleInputRef.current) jobTitleInputRef.current.value = role.name;
                          }
                          scheduleAutoSave();
                        }}
                        className={`${inp} cursor-pointer`}
                      >
                        <option value="_custom">✏ Enter custom title…</option>
                        {airtableRoles.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      <input
                        ref={jobTitleInputRef}
                        name="jobTitle"
                        disabled={isReadOnly || !!selectedRoleId}
                        className={`${inp} ${selectedRoleId ? 'bg-[#F0FAF7] text-[#16A085] font-semibold border-[rgba(22,160,133,.35)]' : ''}`}
                        placeholder={selectedRoleId ? '' : 'e.g. Senior Software Engineer'}
                      />
                      {selectedRoleId && (
                        <span className="text-[11px] text-[#16A085] font-medium">✓ Rates pre-filled in Section 2</span>
                      )}
                    </div>
                  )}
                </Field>
                <Field label="Department / Team" optional><input name="department" disabled={isReadOnly} className={inp} placeholder="e.g. Engineering, Sales" /></Field>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <Field label="Location Policy"><Select name="locationPolicy" disabled={isReadOnly} options={['Remote','Hybrid','On-site','Flexible']} /></Field>
                <Field label="Employment Type"><Select name="employmentType" disabled={isReadOnly} options={['Full-time','Part-time','Contractor','Freelance']} /></Field>
                <Field label="Number of Positions"><input type="number" name="numberOfPositions" disabled={isReadOnly} className={inp} placeholder="1" min={1} /></Field>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <Field label="Target Start Date"><input type="date" name="targetStartDate" disabled={isReadOnly} className={inp} /></Field>
                <Field label="Urgency Level"><Select name="urgency" disabled={isReadOnly} options={['Standard','High','Urgent','Critical']} /></Field>
                <Field label="Viable in Colombia?"><Select name="colombiaViable" disabled={isReadOnly} options={['Yes','Potentially','Needs Discussion','No']} /></Field>
              </div>
              <Field label="Location / Colombia Viability Notes" optional><textarea name="locationNotes" disabled={isReadOnly} className={ta} placeholder="Notes on remote policies, timezone requirements, or Colombia viability…" /></Field>
            </Section>

            {/* ── S2 Compensation ───────────────────────────────────────── */}
            <Section id="s2" num={2} icon="💰" title="Compensation & Benefits" desc="Salary range, pay frequency, and what the role includes" partnerVisible>

              {/* Nearwork suggested rate (from Airtable) */}
              {selectedRole && (selectedRole.suggestedMin || selectedRole.suggestedMax) && (
                <div className="mb-4 bg-[#E8F8F5] border border-[rgba(22,160,133,.25)] rounded-lg px-4 py-3">
                  <div className="text-[10px] font-bold text-[#16A085] uppercase tracking-wider mb-0.5">💡 Nearwork suggested range — {selectedRole.name}</div>
                  <div className="text-base font-bold text-[#111]">
                    {selectedRole.suggestedMin ? `$${selectedRole.suggestedMin.toLocaleString()}` : '—'}
                    {' – '}
                    {selectedRole.suggestedMax ? `$${selectedRole.suggestedMax.toLocaleString()}` : '—'}
                    {' / mo USD'}
                  </div>
                  {selectedRole.notes && <div className="text-[11px] text-[#16A085] mt-1">{selectedRole.notes}</div>}
                </div>
              )}

              <div className="grid grid-cols-3 gap-4 mb-4">
                <Field label="Client Budget Min"><input type="number" name="salaryMin" disabled={isReadOnly} className={inp} placeholder="e.g. 3000" /></Field>
                <Field label="Client Budget Max"><input type="number" name="salaryMax" disabled={isReadOnly} className={inp} placeholder="e.g. 5000" /></Field>
                <Field label="Currency"><Select name="currency" disabled={isReadOnly} options={['USD','COP','EUR']} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <Field label="Pay Frequency"><Select name="payFrequency" disabled={isReadOnly} options={['Monthly','Biweekly','Weekly','Hourly']} /></Field>
                <Field label="Sign-on Bonus" optional><input name="signOnBonus" disabled={isReadOnly} className={inp} placeholder="e.g. USD 2,000 after 3 months" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <Field label="Variable Pay / Commission" optional><textarea name="variablePay" disabled={isReadOnly} className={ta} placeholder="Bonuses, OTE, commission structure…" style={{minHeight:72}} /></Field>
                <Field label="Equity / Stock Options" optional><textarea name="equity" disabled={isReadOnly} className={ta} placeholder="Vesting schedule, grant size…" style={{minHeight:72}} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Benefits Package"><textarea name="benefitsPackage" disabled={isReadOnly} className={ta} placeholder="Health insurance, PTO, sick leave…" /></Field>
                <Field label="Additional Perks" optional><textarea name="additionalPerks" disabled={isReadOnly} className={ta} placeholder="Remote stipend, training budget, equipment…" /></Field>
              </div>
            </Section>

            {/* ── S3 Role Description ───────────────────────────────────── */}
            <Section id="s3" num={3} icon="📋" title="Role Description" desc="What this person will actually do and what success looks like" partnerVisible>
              <Field label="Role Summary / Elevator Pitch" required><textarea name="roleSummary" disabled={isReadOnly} className={ta} style={{minHeight:100}} placeholder="2–4 sentences describing the role, its purpose, and why it matters…" /></Field>
              <div className="mt-4">
                <Field label="Key Responsibilities">
                  <DynamicList items={keyResponsibilities} setItems={setKeyResponsibilities} disabled={isReadOnly} placeholder="e.g. Lead backend architecture decisions…" onAdd={scheduleAutoSave} cancelSave={cancelAutoSave} />
                </Field>
              </div>
              <div className="mt-4">
                <Field label="Day-to-day Activities" optional><textarea name="dayToDay" disabled={isReadOnly} className={ta} placeholder="What will a typical week look like?" /></Field>
              </div>
              <div className="mt-4 border border-[#E5E4E0] rounded-xl overflow-hidden">
                <div className="bg-[#FAFAF9] px-4 py-2.5 text-[11px] font-bold text-[#555] border-b border-[#E5E4E0] uppercase tracking-wide">Success Milestones</div>
                <div className="p-4 grid grid-cols-3 gap-4">
                  <Field label="✅ 30 Days"><textarea name="success30" disabled={isReadOnly} className={ta} style={{minHeight:90}} placeholder="What should they accomplish in 30 days?" /></Field>
                  <Field label="🚀 60 Days"><textarea name="success60" disabled={isReadOnly} className={ta} style={{minHeight:90}} placeholder="By 60 days, what does good look like?" /></Field>
                  <Field label="🏆 90 Days"><textarea name="success90" disabled={isReadOnly} className={ta} style={{minHeight:90}} placeholder="Fully ramped — what does top performance look like?" /></Field>
                </div>
              </div>
            </Section>

            {/* ── S4 Requirements ───────────────────────────────────────── */}
            <Section id="s4" num={4} icon="🎓" title="Candidate Requirements" desc="Must-haves, nice-to-haves, experience, and qualifications" partnerVisible>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <Field label="Must-Have Skills / Experience">
                  <DynamicList items={mustHaveSkills} setItems={setMustHaveSkills} disabled={isReadOnly} placeholder="e.g. 5+ years Python, REST API design…" onAdd={scheduleAutoSave} cancelSave={cancelAutoSave} />
                </Field>
                <Field label="Nice-to-Have Skills">
                  <DynamicList items={niceToHaveSkills} setItems={setNiceToHaveSkills} disabled={isReadOnly} placeholder="e.g. Experience with Kubernetes…" onAdd={scheduleAutoSave} cancelSave={cancelAutoSave} />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <Field label="Years of Experience">
                  <Select name="yearsOfExperience" disabled={isReadOnly} options={['< 1 year','1–3 years','3–5 years','5–8 years','8–10 years','10+ years']} />
                </Field>
                <Field label="Education Level">
                  <Select name="educationLevel" disabled={isReadOnly} options={["No formal requirement","High School","Associate's","Bachelor's","Master's","PhD"]} />
                </Field>
                <Field label="Field of Study" optional><input name="fieldOfStudy" disabled={isReadOnly} className={inp} placeholder="e.g. Computer Science, Business…" /></Field>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <Field label="English Level Required">
                  <Select name="englishLevel" disabled={isReadOnly} options={['Basic (A1–A2)','Intermediate (B1)','Advanced (B2)','Fluent (C1)','Native (C2)']} />
                </Field>
                <Field label="Other Languages" optional><input name="otherLanguages" disabled={isReadOnly} className={inp} placeholder="e.g. Spanish C1, French B1…" /></Field>
                <Field label="Background Check Required">
                  <Select name="backgroundCheck" disabled={isReadOnly} options={['Yes','No']} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Required Certifications" optional>
                  <DynamicList items={requiredCertifications} setItems={setRequiredCertifications} disabled={isReadOnly} placeholder="e.g. AWS Solutions Architect…" onAdd={scheduleAutoSave} cancelSave={cancelAutoSave} />
                </Field>
                <Field label="Industry Experience" optional><textarea name="industryExperience" disabled={isReadOnly} className={ta} style={{minHeight:72}} placeholder="Any specific industry experience required? e.g. fintech, healthcare…" /></Field>
              </div>
            </Section>

            {/* ── S5 Team & Culture ─────────────────────────────────────── */}
            <Section id="s5" num={5} icon="🤝" title="Team & Reporting Structure" desc="Who they'll work with, report to, and the working environment" partnerVisible>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <Field label="Team Size"><input type="number" name="teamSize" disabled={isReadOnly} className={inp} placeholder="e.g. 8" /></Field>
                <Field label="Reports To (Title)"><input name="reportsToTitle" disabled={isReadOnly} className={inp} placeholder="e.g. VP of Engineering" /></Field>
                <Field label="Reports To (Person)" optional><input name="reportsToName" disabled={isReadOnly} className={inp} placeholder="e.g. John Smith" /></Field>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <Field label="Direct Reports"><input type="number" name="directReports" disabled={isReadOnly} className={inp} placeholder="0 (individual contributor)" /></Field>
                <Field label="Working Style">
                  <Select name="workingStyle" disabled={isReadOnly} options={['Highly collaborative','Mostly independent','Mixed','Cross-functional']} />
                </Field>
                <Field label="Works Closely With"><input name="worksCloselyWith" disabled={isReadOnly} className={inp} placeholder="e.g. Product, Design, QA teams" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <Field label="Working Hours"><input name="workingHours" disabled={isReadOnly} className={inp} placeholder="e.g. 9 AM – 6 PM ET, flexible core hours" /></Field>
                <Field label="Timezone Overlap Required"><input name="timezoneRequirements" disabled={isReadOnly} className={inp} placeholder="e.g. Must overlap 4h with US-Eastern" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Remote / Hybrid Policy Details" optional><textarea name="remotePolicyDetails" disabled={isReadOnly} className={ta} placeholder="Specific policy, office days, async-first culture…" /></Field>
                <Field label="Team Culture Notes" optional><textarea name="teamCultureNotes" disabled={isReadOnly} className={ta} placeholder="How the team communicates, values, pace, management style…" /></Field>
              </div>
            </Section>

            {/* ── S7 Tools & Tech (now section 6 in the UI) ────────────── */}
            <Section id="s7" num={6} icon="🛠️" title="Tools & Technology" desc="Required stack, software, and internal systems" partnerVisible>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <Field label="Required Tools / Software">
                  <DynamicList items={requiredTools} setItems={setRequiredTools} disabled={isReadOnly} placeholder="e.g. Jira, Slack, Figma…" onAdd={scheduleAutoSave} cancelSave={cancelAutoSave} />
                </Field>
                <Field label="Tech Stack">
                  <DynamicList items={techStack} setItems={setTechStack} disabled={isReadOnly} placeholder="e.g. React, Node.js, PostgreSQL…" onAdd={scheduleAutoSave} cancelSave={cancelAutoSave} />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Internal Systems Candidate Must Know"><input name="internalSystems" disabled={isReadOnly} className={inp} placeholder="e.g. Salesforce, SAP, HubSpot…" /></Field>
                <Field label="Training Provided">
                  <Select name="trainingProvided" disabled={isReadOnly} options={['Yes — full onboarding','Partial — some training','No — must hit the ground running']} />
                </Field>
                <Field label="Training Details" optional><input name="trainingDetails" disabled={isReadOnly} className={inp} placeholder="Duration, format, buddy system…" /></Field>
              </div>
            </Section>

            {/* ── S8 Nearwork Assignment (now section 7) ────────────────── */}
            <Section id="s8" num={7} icon="🏢" title="Nearwork Team Assignment" desc="Who's on the search, timelines, and strategy — internal use">
              <div className="grid grid-cols-2 gap-4 mb-4">

                {/* Recruiter picker — uses Nearwork staff directory */}
                <Field label="Assigned Recruiter">
                  <RecruiterPicker
                    staff={staff}
                    value={assignedRecruiter}
                    valueEmail={assignedRecruiterEmail}
                    disabled={isReadOnly}
                    onChange={(name, email) => {
                      setAssignedRecruiter(name);
                      setAssignedRecruiterEmail(email);
                      scheduleAutoSave();
                    }}
                  />
                </Field>

                <Field label="Account Manager">
                  <RecruiterPicker
                    staff={staff}
                    value={accountManager}
                    valueEmail={accountManagerEmail}
                    disabled={isReadOnly}
                    onChange={(name, email) => {
                      setAccountManager(name);
                      setAccountManagerEmail(email);
                      scheduleAutoSave();
                    }}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <Field label="Sourcing Start Date"><input type="date" name="sourcingStartDate" disabled={isReadOnly} className={inp} /></Field>
                <Field label="Candidate Submission Deadline"><input type="date" name="candidateDeadline" disabled={isReadOnly} className={inp} /></Field>
                <Field label="Target Candidate Volume"><input type="number" name="targetCandidateVolume" disabled={isReadOnly} className={inp} placeholder="e.g. 5" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <Field label="Reporting Cadence">
                  <Select name="reportingCadence" disabled={isReadOnly} options={['Daily','Weekly','Biweekly','Monthly','As Needed']} />
                </Field>
                <Field label="Reporting Format"><input name="reportingFormat" disabled={isReadOnly} className={inp} placeholder="e.g. Email update, weekly call, portal only" /></Field>
              </div>
              <div className="mb-4">
                <Field label="Sourcing Channels">
                  <DynamicList items={sourcingChannels} setItems={setSourcingChannels} disabled={isReadOnly} placeholder="e.g. LinkedIn, referrals, job boards…" onAdd={scheduleAutoSave} cancelSave={cancelAutoSave} />
                </Field>
              </div>
              <div className="mb-4">
                <Field label="Search Strategy Notes" optional><textarea name="searchStrategyNotes" disabled={isReadOnly} className={ta} placeholder="Key angles, comparable companies to target, red flags to watch for…" /></Field>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-3">
                <div className="text-[10px] font-bold text-purple-700 uppercase tracking-wider mb-1">🔒 Internal only</div>
                <div className="text-xs text-purple-600">This field is visible to Nearwork staff only. It will never be shown to the client.</div>
              </div>
              <Field label="Internal Notes (hidden from client)"><textarea name="internalNotes" disabled={isReadOnly} className={ta} placeholder="Recruiter strategy notes, candidate red flags, negotiation context…" /></Field>
            </Section>

            {/* ── S9 Administrative (now section 8) ────────────────────── */}
            <Section id="s9" num={8} icon="📄" title="Administrative Details" desc="Contract, equipment, compliance, and legal considerations" partnerVisible>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <Field label="Contract Type">
                  <Select name="contractType" disabled={isReadOnly} options={['Employment (Payroll)','B2B Contractor','Freelance','Internship','Part-time Employment']} />
                </Field>
                <Field label="Probation Period"><input name="probationPeriod" disabled={isReadOnly} className={inp} placeholder="e.g. 3 months, No probation" /></Field>
                <Field label="Notice Period Required"><input name="noticePeriod" disabled={isReadOnly} className={inp} placeholder="e.g. 2 weeks, 1 month" /></Field>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Work Authorization Required">
                  <Select name="workAuthRequired" disabled={isReadOnly} options={['Yes','No']} />
                </Field>
                <Field label="Non-Compete / NDA Required">
                  <Select name="nonCompeteNda" disabled={isReadOnly} options={['Yes','No','NDA only','Non-compete only']} />
                </Field>
                <Field label="Equipment Provided By">
                  <Select name="equipmentProvidedBy" disabled={isReadOnly} options={['Client','Candidate (BYOD)','Nearwork','Stipend provided']} />
                </Field>
              </div>
            </Section>

            {/* ── S10 Additional Notes (now section 9) ─────────────────── */}
            <Section id="s10" num={9} icon="📝" title="Additional Notes" desc="Anything discussed that doesn't fit above" partnerVisible>
              <div className="mb-4">
                <Field label="Additional Notes / Special Instructions"><textarea name="additionalNotes" disabled={isReadOnly} className={ta} style={{minHeight:100}} placeholder="Client preferences, special considerations, context for this search…" /></Field>
              </div>
              <Field label="Other Items Discussed"><textarea name="otherDiscussed" disabled={isReadOnly} className={ta} style={{minHeight:80}} placeholder="Anything else from the kick-off call that should be documented…" /></Field>
            </Section>

          </form>

          {/* Audit Trail */}
          <div id="audit" className="bg-white border border-[#E5E4E0] rounded-xl mt-5 overflow-hidden scroll-mt-28">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-[#E5E4E0] bg-[#FAFAF9]">
              <span className="text-lg">📋</span>
              <div>
                <div className="text-sm font-bold">Audit Trail</div>
                <div className="text-xs text-[#9E9E9E]">Full history of every action taken on this brief</div>
              </div>
            </div>
            <div className="p-5">
              {auditHistory.length === 0 ? (
                <p className="text-xs text-[#9E9E9E]">No activity yet. Save or submit the brief to start the audit trail.</p>
              ) : (
                <div className="divide-y divide-[#E5E4E0]">
                  {[...auditHistory].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map((h, i) => (
                    <div key={i} className="flex gap-3 py-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0 mt-0.5 ${h.byRole === 'nearwork' ? 'bg-[#E8F8F5]' : 'bg-blue-50'}`}>
                        {({saved:'💾',submitted:'📤',approved:'✅',changes_requested:'⚠️',reopened:'↩️',created:'🆕'} as Record<string,string>)[h.action] ?? '●'}
                      </div>
                      <div className="flex-1">
                        <div className="text-xs font-semibold">
                          {({saved:'Draft saved',submitted:'Submitted for client review',approved:'Approved',changes_requested:'Changes requested',reopened:'Reopened for editing',created:'Brief created'} as Record<string,string>)[h.action] ?? h.action}
                        </div>
                        <div className="text-[11px] text-[#9E9E9E] mt-0.5">{h.by} · {h.byRole === 'nearwork' ? 'Nearwork' : 'Client'} · {formatDate(h.timestamp)}</div>
                        {h.note && h.action !== 'saved' && h.action !== 'submitted' && (
                          <div className="text-xs text-[#555] mt-1.5 bg-[#F5F4F0] rounded-lg px-2.5 py-2 border-l-2 border-[#D0CFC9]">{h.note}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* ── Confirm Modal ────────────────────────────────────────────────── */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-[999] backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-7 max-w-[440px] w-[90%] shadow-2xl">
            <div className="text-4xl mb-3">{pendingAction === 'submit' ? '📤' : '↩️'}</div>
            <div className="text-lg font-bold mb-2">{pendingAction === 'submit' ? 'Submit for Client Review?' : 'Reopen for Editing?'}</div>
            <div className="text-sm text-[#555] mb-4 leading-relaxed">
              {pendingAction === 'submit'
                ? 'By submitting, Nearwork confirms this brief is accurate and ready for client review. The client will see a "Pending Review" link in their portal.'
                : 'This will move the brief back to Draft status. If it was already approved, both parties will need to approve it again.'}
            </div>
            <div className="text-[11px] font-bold text-[#555] uppercase tracking-wider mb-1.5">Type {confirmExpected} to confirm</div>
            <input
              autoFocus
              className="w-full px-3.5 py-2.5 border-2 border-[#E5E4E0] rounded-xl text-sm font-bold tracking-widest text-center focus:border-[#16A085] outline-none transition-colors"
              placeholder={confirmExpected}
              value={confirmInput}
              onChange={e => setConfirmInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmReady && !confirmLoading && executeAction()}
            />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmOpen(false)} className="flex-1 py-2 bg-white border border-[#E5E4E0] text-sm font-semibold rounded-xl hover:border-[#16A085] hover:text-[#16A085] transition-colors">Cancel</button>
              <button disabled={!confirmReady || confirmLoading} onClick={executeAction} className="flex-1 py-2 bg-[#16A085] text-white text-sm font-semibold rounded-xl hover:bg-[#12866E] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors">
                {confirmLoading ? 'Processing…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Shared style constants ────────────────────────────────────────────────────

const inp = 'w-full px-3 py-2 border border-[#E5E4E0] rounded-lg text-xs text-[#111] bg-white focus:border-[#16A085] focus:outline-none transition-colors disabled:bg-[#FAFAF9] disabled:text-[#9E9E9E] disabled:cursor-not-allowed';
const ta = `${inp} resize-y min-h-[80px] leading-relaxed`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ id, num, icon, title, desc, partnerVisible, children }: { id: string; num: number; icon: string; title: string; desc: string; partnerVisible?: boolean; children: ReactNode }) {
  return (
    <div id={id} className="bg-white border border-[#E5E4E0] rounded-xl overflow-hidden scroll-mt-28">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[#E5E4E0] bg-[#FAFAF9]">
        <div className="w-7 h-7 rounded-full bg-[#111] flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">{num}</div>
        <div>
          <div className="text-sm font-bold">{title}</div>
          <div className="text-xs text-[#9E9E9E] mt-0.5">{desc}</div>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {partnerVisible && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#16A085] bg-[#E8F8F5] border border-[rgba(22,160,133,.25)] rounded-full px-2 py-0.5">
              👁 Partner can see this
            </span>
          )}
          <span className="text-base">{icon}</span>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, required, optional, children }: { label: string; required?: boolean; optional?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold text-[#555] tracking-[0.02em]">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
        {optional && <span className="text-[#9E9E9E] font-normal ml-1">(optional)</span>}
      </label>
      {children}
    </div>
  );
}

function Select({ name, options, disabled }: { name: string; options: string[]; disabled?: boolean }) {
  return (
    <select name={name} disabled={disabled} className={`${inp} cursor-pointer`}>
      <option value="">Select…</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// ─── DynamicList — fixed: no auto-save on add-item, auto-focus new inputs ─────

function DynamicList({ items, setItems, disabled, placeholder, onAdd, cancelSave }: {
  items: string[];
  setItems: Dispatch<SetStateAction<string[]>>;
  disabled?: boolean;
  placeholder?: string;
  onAdd?: () => void;
  cancelSave?: () => void;
}) {
  const prevLenRef = useRef(items.length);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  // Auto-focus the newly added input
  useEffect(() => {
    if (items.length > prevLenRef.current) {
      const newInput = inputsRef.current[items.length - 1];
      if (newInput) newInput.focus();
    }
    prevLenRef.current = items.length;
  });

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            ref={(el) => { inputsRef.current[i] = el; }}
            className={`${inp} flex-1`}
            value={item}
            disabled={disabled}
            placeholder={placeholder}
            onChange={e => { setItems(s => s.map((x, j) => j === i ? e.target.value : x)); onAdd?.(); }}
          />
          {!disabled && (
            <button
              type="button"
              onClick={() => { setItems(s => s.filter((_, j) => j !== i)); onAdd?.(); }}
              className="w-7 h-7 rounded-md border border-[#E5E4E0] bg-[#F5F4F0] text-[#9E9E9E] text-base flex items-center justify-center hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0"
            >
              ×
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        // IMPORTANT: do NOT call onAdd() here.
        // Also cancel any pending auto-save so it can't race and filter the
        // empty field out of state before the user has a chance to type.
        <button
          type="button"
          onClick={() => { cancelSave?.(); setItems(s => [...s, '']); }}
          className="mt-1 py-1.5 px-3 border-2 border-dashed border-[#D0CFC9] rounded-lg text-[11px] font-semibold text-[#9E9E9E] hover:border-[#16A085] hover:text-[#16A085] hover:bg-[#F0FAF7] transition-all"
        >
          + Add item
        </button>
      )}
    </div>
  );
}

// ─── RecruiterPicker — inline staff autocomplete for the kickoff page ──────────

function RecruiterPicker({
  staff,
  value,
  valueEmail,
  disabled,
  onChange,
}: {
  staff: StaffOption[];
  value: string;
  valueEmail: string;
  disabled?: boolean;
  onChange: (name: string, email: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? staff.filter(s => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)) : staff).slice(0, 8);
  }, [staff, query]);

  if (disabled) {
    return (
      <div>
        <div className={`${inp} text-[#111]`}>{value || <span className="text-[#9E9E9E]">Not assigned</span>}</div>
        {valueEmail && <div className="text-[10px] text-[#9E9E9E] mt-1">{valueEmail}</div>}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        className={inp}
        value={open ? query : value}
        placeholder={value || 'Search Nearwork team…'}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onBlur={(e) => {
          if (!wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
        }}
        onChange={(e) => { setQuery(e.target.value); }}
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-[#E5E4E0] rounded-lg shadow-lg max-h-[220px] overflow-y-auto py-1">
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[#9E9E9E]">No team members found</p>
          ) : (
            matches.map((s) => (
              <button
                key={s.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(s.name, s.email);
                  setOpen(false);
                  setQuery('');
                }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-[#F5F4F0]"
              >
                <span className="w-7 h-7 rounded-full bg-[#16A085] flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                  {s.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-[#111] truncate">{s.name}</span>
                  <span className="block text-[10px] text-[#9E9E9E] truncate capitalize">{s.role || s.email}</span>
                </span>
                {s.name === value && <span className="text-[#16A085] text-xs flex-shrink-0">✓</span>}
              </button>
            ))
          )}
        </div>
      )}
      {valueEmail && !open && (
        <div className="text-[10px] text-[#9E9E9E] mt-1">{valueEmail}</div>
      )}
    </div>
  );
}

function formatDate(ts: string | { toDate?: () => Date } | undefined): string {
  if (!ts) return '—';
  try {
    const d = typeof ts === 'object' && ts.toDate ? ts.toDate() : new Date(ts as string);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return String(ts);
  }
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function KickoffPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#F5F4F0] flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-[#E5E4E0] border-t-[#16A085] rounded-full animate-spin" />
        <p className="text-[#9E9E9E] text-sm">Loading…</p>
      </div>
    }>
      <KickoffInner />
    </Suspense>
  );
}
