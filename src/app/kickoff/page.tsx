'use client';

import { useEffect, useState, useRef, useCallback, Suspense, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  auth, db, onAuthStateChanged, isNearworkEmail,
  doc, getDoc, setDoc, collection, query, where, getDocs, onSnapshot,
  serverTimestamp,
} from '@/lib/firebase';
import type { User } from '@/lib/firebase';

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

interface InterviewStage {
  name: string;
  format: string;
  interviewer: string;
  duration: string;
}

// ─── Save indicator ────────────────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// ─── Kickoff page (inner — needs useSearchParams) ─────────────────────────────

function KickoffInner() {
  const params = useSearchParams();
  const pipelineCode = params.get('code') ?? '';

  const [user, setUser] = useState<User | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'auth-error' | 'error' | 'ready'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [openingData, setOpeningData] = useState<Record<string, unknown> | null>(null);
  const [briefData, setBriefData] = useState<BriefData | null>(null);
  const [status, setStatus] = useState<BriefStatus>('draft');
  const [auditHistory, setAuditHistory] = useState<AuditEntry[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [changesBannerNote, setChangesBannerNote] = useState('');
  const [approvedMeta, setApprovedMeta] = useState('');

  // ── Confirm modal state ──
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'submit' | 'reopen' | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [confirmLoading, setConfirmLoading] = useState(false);

  // ── Dynamic lists ──
  const [keyResponsibilities, setKeyResponsibilities] = useState<string[]>(['']);
  const [mustHaveSkills, setMustHaveSkills] = useState<string[]>(['']);
  const [niceToHaveSkills, setNiceToHaveSkills] = useState<string[]>(['']);
  const [requiredCertifications, setRequiredCertifications] = useState<string[]>([]);
  const [requiredTools, setRequiredTools] = useState<string[]>(['']);
  const [techStack, setTechStack] = useState<string[]>(['']);
  const [sourcingChannels, setSourcingChannels] = useState<string[]>(['']);
  const [interviewStages, setInterviewStages] = useState<InterviewStage[]>([]);

  // ── Simple form fields (using refs for performance) ──
  const formRef = useRef<HTMLFormElement>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      if (!u) { setLoadState('auth-error'); return; }
      if (!isNearworkEmail(u.email ?? '')) { setLoadState('auth-error'); return; }
      setUser(u);
    });
  }, []);

  // ── Load pipeline + brief ─────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !pipelineCode) return;

    let unsubBrief: (() => void) | null = null;

    async function load() {
      try {
        // Try pipelines collection first
        const pSnap = await getDoc(doc(db, 'pipelines', pipelineCode));
        let opening: Record<string, unknown> | null = null;
        if (pSnap.exists()) {
          opening = { id: pSnap.id, ...pSnap.data() };
        } else {
          const oQuery = query(collection(db, 'openings'), where('code', '==', pipelineCode));
          const oDocs = await getDocs(oQuery);
          if (oDocs.empty) {
            setErrorMsg(`No pipeline or opening found with code "${pipelineCode}"`);
            setLoadState('error');
            return;
          }
          opening = { id: oDocs.docs[0].id, ...oDocs.docs[0].data() };
        }
        setOpeningData(opening);

        // Subscribe to brief
        unsubBrief = onSnapshot(doc(db, 'kickoffBriefs', pipelineCode), (snap) => {
          if (snap.exists()) {
            const brief = { id: snap.id, ...snap.data() } as BriefData;
            setBriefData(brief);
            applyBriefToForm(brief);
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

  // ── Apply brief data to form ──────────────────────────────────────────────
  function applyBriefToForm(brief: BriefData) {
    // Simple fields
    const simpleFields = [
      'jobTitle','department','locationPolicy','employmentType','numberOfPositions',
      'targetStartDate','urgency','colombiaViable','locationNotes',
      'salaryMin','salaryMax','currency','payFrequency','signOnBonus','variablePay',
      'equity','benefitsPackage','additionalPerks','roleSummary','dayToDay',
      'success30','success60','success90','yearsOfExperience','educationLevel',
      'fieldOfStudy','englishLevel','otherLanguages','backgroundCheck','industryExperience',
      'teamSize','reportsToTitle','reportsToName','directReports','workingStyle',
      'worksCloselyWith','workingHours','timezoneRequirements','remotePolicyDetails',
      'teamCultureNotes','totalInterviewStages','interviewLanguage','timeToOffer',
      'assessmentRequired','assessmentDetails','rejectionCriteria','internalSystems',
      'trainingProvided','trainingDetails','assignedRecruiter','accountManager',
      'sourcingStartDate','candidateDeadline','targetCandidateVolume','reportingCadence',
      'reportingFormat','searchStrategyNotes','internalNotes','contractType',
      'probationPeriod','noticePeriod','workAuthRequired','nonCompeteNda',
      'equipmentProvidedBy','additionalNotes','otherDiscussed',
    ];
    if (formRef.current) {
      simpleFields.forEach((k) => {
        const el = formRef.current?.elements.namedItem(k) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
        if (el && brief[k] != null) el.value = String(brief[k]);
      });
    }

    // Dynamic lists
    if (Array.isArray(brief.keyResponsibilities)) setKeyResponsibilities(brief.keyResponsibilities as string[]);
    if (Array.isArray(brief.mustHaveSkills)) setMustHaveSkills(brief.mustHaveSkills as string[]);
    if (Array.isArray(brief.niceToHaveSkills)) setNiceToHaveSkills(brief.niceToHaveSkills as string[]);
    if (Array.isArray(brief.requiredCertifications)) setRequiredCertifications(brief.requiredCertifications as string[]);
    if (Array.isArray(brief.requiredTools)) setRequiredTools(brief.requiredTools as string[]);
    if (Array.isArray(brief.techStack)) setTechStack(brief.techStack as string[]);
    if (Array.isArray(brief.sourcingChannels)) setSourcingChannels(brief.sourcingChannels as string[]);
    if (Array.isArray(brief.interviewStages)) setInterviewStages(brief.interviewStages as InterviewStage[]);
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
    // Dynamic lists
    data.keyResponsibilities = keyResponsibilities.filter(Boolean);
    data.mustHaveSkills = mustHaveSkills.filter(Boolean);
    data.niceToHaveSkills = niceToHaveSkills.filter(Boolean);
    data.requiredCertifications = requiredCertifications.filter(Boolean);
    data.requiredTools = requiredTools.filter(Boolean);
    data.techStack = techStack.filter(Boolean);
    data.sourcingChannels = sourcingChannels.filter(Boolean);
    data.interviewStages = interviewStages.filter((s) => s.name);
    return data;
  }

  // ── API call ──────────────────────────────────────────────────────────────
  async function callAPI(action: string, extraData: Record<string, unknown> = {}) {
    if (!user) throw new Error('Not authenticated');
    const token = await user.getIdToken();
    const res = await fetch('/api/kickoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action,
        code: pipelineCode,
        orgId: (openingData?.orgId as string) ?? (openingData?.org as string) ?? '',
        ...collectFormData(),
        ...extraData,
      }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error ?? 'API error');
    return data;
  }

  // ── Auto-save ─────────────────────────────────────────────────────────────
  const saveDraft = useCallback(async () => {
    if (isReadOnly) return;
    try {
      setSaveState('saving');
      await callAPI('save');
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 3000);
    } catch (e) {
      setSaveState('error');
      console.error('Auto-save failed:', e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReadOnly, user, pipelineCode, openingData, keyResponsibilities, mustHaveSkills, niceToHaveSkills, requiredCertifications, requiredTools, techStack, sourcingChannels, interviewStages]);

  function scheduleAutoSave() {
    if (isReadOnly) return;
    setSaveState('saving');
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(saveDraft, 2500);
  }

  // ── Confirm modal ─────────────────────────────────────────────────────────
  function openConfirm(action: 'submit' | 'reopen') {
    setPendingAction(action);
    setConfirmInput('');
    setConfirmOpen(true);
  }

  async function executeAction() {
    if (!pendingAction) return;
    setConfirmLoading(true);
    try {
      await callAPI(pendingAction);
      setConfirmOpen(false);
      setPendingAction(null);
    } catch (e) {
      alert('Error: ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally {
      setConfirmLoading(false);
    }
  }

  // ── Copy client link ──────────────────────────────────────────────────────
  const [copyLabel, setCopyLabel] = useState('📋 Copy client link');
  function copyClientLink() {
    navigator.clipboard.writeText(`https://app.nearwork.co/pipeline/${pipelineCode}/kickoff`).then(() => {
      setCopyLabel('✅ Copied!');
      setTimeout(() => setCopyLabel('📋 Copy client link'), 2000);
    });
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  const openingTitle = String((openingData?.openingTitle ?? openingData?.title ?? pipelineCode) || pipelineCode);
  const openingMeta = [openingData?.orgName, pipelineCode, openingData?.recruiter].filter(Boolean).join(' · ');

  const statusBadge = {
    draft: { cls: 'bg-[#F5F4F0] text-[#9E9E9E] border border-[#E5E4E0]', label: '● Draft' },
    submitted: { cls: 'bg-blue-50 text-blue-600 border border-blue-200', label: '⏳ Pending Review' },
    changes_requested: { cls: 'bg-amber-50 text-amber-800 border border-amber-200', label: '⚠️ Changes Requested' },
    approved: { cls: 'bg-emerald-50 text-emerald-800 border border-emerald-200', label: '✅ Approved' },
  }[status];

  const saveIndicatorCls = saveState === 'saving' ? 'text-amber-400' : saveState === 'saved' ? 'text-teal-300' : 'text-white/30';

  const confirmExpected = pendingAction === 'submit' ? 'SUBMIT' : 'REOPEN';
  const confirmReady = confirmInput.trim().toUpperCase() === confirmExpected;

  // ── States ────────────────────────────────────────────────────────────────
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
      <div className="min-h-screen bg-[#F5F4F0] flex flex-col items-center justify-center gap-3 text-center">
        <div className="text-5xl">🔒</div>
        <p className="text-base font-bold">Access restricted</p>
        <p className="text-[#9E9E9E] text-sm">Only Nearwork staff can access this page.</p>
        <a href="/login" className="mt-2 px-4 py-2 bg-[#16A085] text-white text-xs font-semibold rounded-lg">Sign in</a>
      </div>
    );
  }
  if (loadState === 'error') {
    return (
      <div className="min-h-screen bg-[#F5F4F0] flex flex-col items-center justify-center gap-3 text-center">
        <div className="text-4xl">⚠️</div>
        <p className="text-base font-bold">Error</p>
        <p className="text-[#9E9E9E] text-sm">{errorMsg}</p>
      </div>
    );
  }

  // ── Full page ─────────────────────────────────────────────────────────────
  return (
    <>
      {/* Nav */}
      <nav className="h-14 bg-[#111111] flex items-center px-5 gap-4 sticky top-0 z-50">
        <a href="/dashboard" className="text-lg font-black text-white tracking-tight">Near<span className="text-[#16A085]">work</span></a>
        <div className="w-px h-4 bg-white/15" />
        <button onClick={() => history.back()} className="text-white/60 text-xs hover:text-white flex items-center gap-1">← Back</button>
        <div className="w-px h-4 bg-white/15" />
        <span className="text-white/85 text-sm font-semibold">Kick-off Brief</span>
        <div className="flex-1" />
        <span className={`text-xs transition-colors ${saveIndicatorCls}`} title={saveState}>●</span>
        <span className="text-white/50 text-xs">{user?.email}</span>
      </nav>

      {/* Status bar */}
      <div className="bg-white border-b border-[#E5E4E0] px-5 py-3 flex items-center gap-3 flex-wrap">
        <div>
          <div className="font-bold text-[15px]">{openingTitle}</div>
          <div className="text-xs text-[#9E9E9E]">{openingMeta}</div>
        </div>
        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${statusBadge.cls}`}>{statusBadge.label}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={copyClientLink} className="px-3 py-1.5 bg-white border border-[#E5E4E0] text-xs font-semibold rounded-lg hover:border-[#16A085] hover:text-[#16A085] transition-colors">{copyLabel}</button>
          {(status === 'submitted' || status === 'approved') && (
            <button onClick={() => openConfirm('reopen')} className="px-3 py-1.5 bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold rounded-lg hover:bg-amber-100 transition-colors">↩ Reopen for editing</button>
          )}
          {!isReadOnly && (
            <button onClick={saveDraft} className="px-3 py-1.5 bg-white border border-[#E5E4E0] text-xs font-semibold rounded-lg hover:border-[#16A085] hover:text-[#16A085] transition-colors">Save draft</button>
          )}
          {status !== 'approved' && status !== 'submitted' && (
            <button onClick={() => openConfirm('submit')} className="px-3 py-1.5 bg-[#16A085] text-white text-xs font-semibold rounded-lg hover:bg-[#12866E] transition-colors">Submit for client review →</button>
          )}
        </div>
      </div>

      <div className="flex min-h-[calc(100vh-113px)]">
        {/* Sidebar */}
        <aside className="w-[220px] flex-shrink-0 bg-white border-r border-[#E5E4E0] sticky top-[113px] h-[calc(100vh-113px)] overflow-y-auto py-4 hidden md:block">
          <nav className="flex flex-col">
            {[
              ['#s1','1','Role Overview'],['#s2','2','Compensation'],['#s3','3','Role Description'],
              ['#s4','4','Requirements'],['#s5','5','Team & Culture'],['#s6','6','Interview Process'],
              ['#s7','7','Tools & Tech'],['#s8','8','NW Assignment'],['#s9','9','Administrative'],
              ['#s10','10','Additional Notes'],['#audit','📋','Audit Trail'],
            ].map(([href, num, label]) => (
              <a key={href} href={href} className="flex items-center gap-2 px-4 py-2 text-xs text-[#555555] hover:bg-[#F0FAF7] hover:text-[#16A085] border-l-2 border-transparent hover:border-[#16A085] transition-all">
                <span className="text-[10px] text-[#9E9E9E] w-4">{num}</span>{label}
              </a>
            ))}
          </nav>
        </aside>

        {/* Main */}
        <main className="flex-1 p-6 max-w-[860px]">
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
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-5 flex gap-3 items-center">
              <span className="text-xl">✅</span>
              <div>
                <div className="text-sm font-bold text-emerald-800">Both parties have approved this brief</div>
                <div className="text-xs text-emerald-700 mt-0.5">{approvedMeta}</div>
              </div>
            </div>
          )}

          <form ref={formRef} onInput={scheduleAutoSave} className="space-y-5">

            {/* S1 Role Overview */}
            <Section id="s1" icon="🎯" title="Role Overview" desc="Core information about the position and engagement">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <Field label="Job Title" required><input name="jobTitle" disabled={isReadOnly} className={inp} placeholder="e.g. Senior Software Engineer" /></Field>
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

            {/* S2 Compensation */}
            <Section id="s2" icon="💰" title="Compensation & Benefits" desc="Salary range, pay frequency, and what the role includes">
              <div className="grid grid-cols-3 gap-4 mb-4">
                <Field label="Salary Min"><input type="number" name="salaryMin" disabled={isReadOnly} className={inp} placeholder="e.g. 3000" /></Field>
                <Field label="Salary Max"><input type="number" name="salaryMax" disabled={isReadOnly} className={inp} placeholder="e.g. 5000" /></Field>
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

            {/* S3 Role Description */}
            <Section id="s3" icon="📋" title="Role Description" desc="What this person will actually do and what success looks like">
              <Field label="Role Summary / Elevator Pitch" required><textarea name="roleSummary" disabled={isReadOnly} className={ta} style={{minHeight:100}} placeholder="2–4 sentences describing the role, its purpose, and why it matters…" /></Field>
              <div className="mt-4">
                <Field label="Key Responsibilities">
                  <DynamicList items={keyResponsibilities} setItems={setKeyResponsibilities} disabled={isReadOnly} placeholder="e.g. Lead backend architecture decisions…" onAdd={scheduleAutoSave} />
                </Field>
              </div>
              <div className="mt-4">
                <Field label="Day-to-day Activities" optional><textarea name="dayToDay" disabled={isReadOnly} className={ta} placeholder="What will a typical week look like?" /></Field>
              </div>
              <div className="mt-4 border border-[#E5E4E0] rounded-xl overflow-hidden">
                <div className="bg-[#FAFAF9] px-4 py-2.5 text-[11px] font-bold text-[#555555] border-b border-[#E5E4E0] uppercase tracking-wide">Success Milestones</div>
                <div className="p-4 grid grid-cols-3 gap-4">
                  <Field label="✅ 30 Days"><textarea name="success30" disabled={isReadOnly} className={ta} style={{minHeight:90}} placeholder="What should they accomplish in 30 days?" /></Field>
                  <Field label="🚀 60 Days"><textarea name="success60" disabled={isReadOnly} className={ta} style={{minHeight:90}} placeholder="By 60 days, what does good look like?" /></Field>
                  <Field label="🏆 90 Days"><textarea name="success90" disabled={isReadOnly} className={ta} style={{minHeight:90}} placeholder="Fully ramped — what does top performance look like?" /></Field>
                </div>
              </div>
            </Section>

            {/* S4 Requirements */}
            <Section id="s4" icon="🎓" title="Candidate Requirements" desc="Must-haves, nice-to-haves, experience, and qualifications">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <Field label="Must-Have Skills / Experience">
                  <DynamicList items={mustHaveSkills} setItems={setMustHaveSkills} disabled={isReadOnly} placeholder="e.g. 5+ years Python, REST API design…" onAdd={scheduleAutoSave} />
                </Field>
                <Field label="Nice-to-Have Skills">
                  <DynamicList items={niceToHaveSkills} setItems={setNiceToHaveSkills} disabled={isReadOnly} placeholder="e.g. Experience with Kubernetes…" onAdd={scheduleAutoSave} />
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
                  <DynamicList items={requiredCertifications} setItems={setRequiredCertifications} disabled={isReadOnly} placeholder="e.g. AWS Solutions Architect…" onAdd={scheduleAutoSave} />
                </Field>
                <Field label="Industry Experience" optional><textarea name="industryExperience" disabled={isReadOnly} className={ta} style={{minHeight:72}} placeholder="Any specific industry experience required? e.g. fintech, healthcare…" /></Field>
              </div>
            </Section>

            {/* S5 Team & Culture */}
            <Section id="s5" icon="🤝" title="Team & Reporting Structure" desc="Who they'll work with, report to, and the working environment">
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

            {/* S6 Interview Process */}
            <Section id="s6" icon="💬" title="Interview Process" desc="Stage-by-stage breakdown, timeline, and decision criteria">
              <div className="grid grid-cols-3 gap-4 mb-4">
                <Field label="Total Interview Stages"><input type="number" name="totalInterviewStages" disabled={isReadOnly} className={inp} placeholder="e.g. 3" /></Field>
                <Field label="Interview Language">
                  <Select name="interviewLanguage" disabled={isReadOnly} options={['English only','Spanish only','Both English & Spanish']} />
                </Field>
                <Field label="Time from 1st Interview to Offer"><input name="timeToOffer" disabled={isReadOnly} className={inp} placeholder="e.g. 2–3 weeks" /></Field>
              </div>
              <div className="mb-4">
                <label className="block text-[11px] font-semibold text-[#555555] mb-2">Interview Stages (define each stage)</label>
                <div className="space-y-2">
                  {interviewStages.map((stage, i) => (
                    <div key={i} className="bg-[#F5F4F0] border border-[#E5E4E0] rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[11px] font-bold text-[#555555]">Stage {i + 1}</span>
                        {!isReadOnly && (
                          <button type="button" onClick={() => { setInterviewStages(s => s.filter((_, j) => j !== i)); scheduleAutoSave(); }} className="text-xs px-2 py-1 bg-white border border-[#E5E4E0] rounded-lg text-[#555555] hover:text-red-500 hover:border-red-300">Remove</button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {(['name','format','interviewer','duration'] as const).map((field, fi) => (
                          <Field key={fi} label={['Stage Name','Format & Duration','Conducted By','Focus / Notes'][fi]}>
                            <input disabled={isReadOnly} className={inp} value={stage[field]} onChange={e => { setInterviewStages(s => s.map((x, j) => j === i ? {...x, [field]: e.target.value} : x)); scheduleAutoSave(); }} placeholder={['e.g. Technical Interview','e.g. Video call, 60 min','e.g. CTO + HR Manager','e.g. System design, behavioral'][fi]} />
                          </Field>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {!isReadOnly && (
                  <button type="button" onClick={() => { setInterviewStages(s => [...s, {name:'',format:'',interviewer:'',duration:''}]); scheduleAutoSave(); }} className="mt-2 w-full py-2 border-2 border-dashed border-[#D0CFC9] rounded-lg text-xs font-semibold text-[#9E9E9E] hover:border-[#16A085] hover:text-[#16A085] hover:bg-[#F0FAF7] transition-all">+ Add interview stage</button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <Field label="Assessment / Technical Test Required">
                  <Select name="assessmentRequired" disabled={isReadOnly} options={['Yes','No','To be decided']} />
                </Field>
                <Field label="Assessment Details" optional><textarea name="assessmentDetails" disabled={isReadOnly} className={ta} style={{minHeight:72}} placeholder="Type of test, duration, tool used (e.g. HackerRank, take-home project)…" /></Field>
              </div>
              <Field label="Rejection / Disqualifying Criteria"><textarea name="rejectionCriteria" disabled={isReadOnly} className={ta} placeholder="What are the automatic disqualifiers?" /></Field>
            </Section>

            {/* S7 Tools & Tech */}
            <Section id="s7" icon="🛠️" title="Tools & Technology" desc="Required stack, software, and internal systems">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <Field label="Required Tools / Software">
                  <DynamicList items={requiredTools} setItems={setRequiredTools} disabled={isReadOnly} placeholder="e.g. Jira, Slack, Figma…" onAdd={scheduleAutoSave} />
                </Field>
                <Field label="Tech Stack">
                  <DynamicList items={techStack} setItems={setTechStack} disabled={isReadOnly} placeholder="e.g. React, Node.js, PostgreSQL…" onAdd={scheduleAutoSave} />
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

            {/* S8 Nearwork Assignment */}
            <Section id="s8" icon="🏢" title="Nearwork Team Assignment" desc="Who's on the search, timelines, and strategy — internal use">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <Field label="Assigned Recruiter"><input name="assignedRecruiter" disabled={isReadOnly} className={inp} placeholder="Full name" /></Field>
                <Field label="Account Manager"><input name="accountManager" disabled={isReadOnly} className={inp} placeholder="Full name" /></Field>
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
                  <DynamicList items={sourcingChannels} setItems={setSourcingChannels} disabled={isReadOnly} placeholder="e.g. LinkedIn, referrals, job boards…" onAdd={scheduleAutoSave} />
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

            {/* S9 Administrative */}
            <Section id="s9" icon="📄" title="Administrative Details" desc="Contract, equipment, compliance, and legal considerations">
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

            {/* S10 Additional Notes */}
            <Section id="s10" icon="📝" title="Additional Notes" desc="Anything discussed that doesn't fit above">
              <div className="mb-4">
                <Field label="Additional Notes / Special Instructions"><textarea name="additionalNotes" disabled={isReadOnly} className={ta} style={{minHeight:100}} placeholder="Client preferences, special considerations, context for this search…" /></Field>
              </div>
              <Field label="Other Items Discussed (not covered above)"><textarea name="otherDiscussed" disabled={isReadOnly} className={ta} style={{minHeight:80}} placeholder="Anything else from the kick-off call that should be documented…" /></Field>
            </Section>

          </form>{/* end form */}

          {/* Audit Trail */}
          <div id="audit" className="bg-white border border-[#E5E4E0] rounded-xl mt-5 overflow-hidden">
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
                          <div className="text-xs text-[#555555] mt-1.5 bg-[#F5F4F0] rounded-lg px-2.5 py-2 border-l-2 border-[#D0CFC9]">{h.note}</div>
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

      {/* Confirm Modal */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-[999] backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-7 max-w-[440px] w-[90%] shadow-2xl">
            <div className="text-4xl mb-3">{pendingAction === 'submit' ? '📤' : '↩️'}</div>
            <div className="text-lg font-bold mb-2">{pendingAction === 'submit' ? 'Submit for Client Review?' : 'Reopen for Editing?'}</div>
            <div className="text-sm text-[#555555] mb-4 leading-relaxed">
              {pendingAction === 'submit'
                ? 'By submitting, Nearwork confirms this brief is accurate and ready for client review. The client will see a "Pending Review" link in their portal.'
                : 'This will move the brief back to Draft status. If it was already approved, both parties will need to approve it again.'}
            </div>
            <div className="text-[11px] font-bold text-[#555555] uppercase tracking-wider mb-1.5">Type {confirmExpected} to confirm</div>
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

const inp = 'w-full px-3 py-2 border border-[#E5E4E0] rounded-lg text-xs text-[#111111] bg-white focus:border-[#16A085] focus:outline-none transition-colors disabled:bg-[#FAFAF9] disabled:text-[#9E9E9E] disabled:cursor-not-allowed';
const ta = `${inp} resize-y min-h-[80px] leading-relaxed`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ id, icon, title, desc, children }: { id: string; icon: string; title: string; desc: string; children: ReactNode }) {
  return (
    <div id={id} className="bg-white border border-[#E5E4E0] rounded-xl overflow-hidden scroll-mt-28">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-[#E5E4E0] bg-[#FAFAF9]">
        <span className="text-lg">{icon}</span>
        <div>
          <div className="text-sm font-bold">{title}</div>
          <div className="text-xs text-[#9E9E9E] mt-0.5">{desc}</div>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, required, optional, children }: { label: string; required?: boolean; optional?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold text-[#555555] tracking-[0.02em]">
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

function DynamicList({ items, setItems, disabled, placeholder, onAdd }: {
  items: string[];
  setItems: Dispatch<SetStateAction<string[]>>;
  disabled?: boolean;
  placeholder?: string;
  onAdd?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            className={`${inp} flex-1`}
            value={item}
            disabled={disabled}
            placeholder={placeholder}
            onChange={e => { setItems(s => s.map((x, j) => j === i ? e.target.value : x)); onAdd?.(); }}
          />
          {!disabled && (
            <button type="button" onClick={() => { setItems(s => s.filter((_, j) => j !== i)); onAdd?.(); }} className="w-7 h-7 rounded-md border border-[#E5E4E0] bg-[#F5F4F0] text-[#9E9E9E] text-base flex items-center justify-center hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0">×</button>
          )}
        </div>
      ))}
      {!disabled && (
        <button type="button" onClick={() => { setItems(s => [...s, '']); onAdd?.(); }} className="mt-1 py-1.5 px-3 border-2 border-dashed border-[#D0CFC9] rounded-lg text-[11px] font-semibold text-[#9E9E9E] hover:border-[#16A085] hover:text-[#16A085] hover:bg-[#F0FAF7] transition-all">+ Add item</button>
      )}
    </div>
  );
}

// ─── Date formatter ────────────────────────────────────────────────────────────

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

// ─── Page export (Suspense boundary for useSearchParams) ──────────────────────

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
