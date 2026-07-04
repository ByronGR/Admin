'use client';

// Two upload slots on the candidate profile: the Proba assessment/English PDF and
// the DISC PDF. Each posts to /api/assessment-upload, which parses it in memory,
// stores the structured result, discards the file, and recomputes the Nearwork
// Score. Staff-only; the parsed report then shows on the candidate page (Admin +
// client portal).

import { useRef, useState } from 'react';
import { auth } from '@/lib/firebase';
import { useToast } from '@/components/ui/toast';

type SlotState = 'idle' | 'busy' | 'done' | 'error';

function Slot({
  title, hint, state, onFile,
}: {
  title: string;
  hint: string;
  state: SlotState;
  onFile: (f: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const border =
    state === 'done' ? 'border-emerald-300 bg-emerald-50'
    : state === 'error' ? 'border-red-300 bg-red-50'
    : 'border-gray-200 hover:border-gray-300 bg-white';
  return (
    <div className={`flex-1 rounded-xl border ${border} p-4 transition-colors`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          <div className="text-xs text-gray-500 mt-0.5">{hint}</div>
        </div>
        {state === 'done' && <span className="text-xs font-semibold text-emerald-700 whitespace-nowrap">✓ Parsed</span>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={state === 'busy'}
        onClick={() => inputRef.current?.click()}
        className="mt-3 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
      >
        {state === 'busy' ? 'Reading…' : state === 'done' ? 'Replace PDF' : 'Choose PDF'}
      </button>
    </div>
  );
}

export function AssessmentUploader({
  candidateId, orgId, onComplete,
}: {
  candidateId: string;
  orgId?: string | null;
  onComplete?: () => void;
}) {
  const { showToast } = useToast();
  const [state, setState] = useState<{ assessment: SlotState; disc: SlotState }>({ assessment: 'idle', disc: 'idle' });
  const [nwScore, setNwScore] = useState<number | null>(null);

  async function upload(kind: 'assessment' | 'disc', file: File) {
    setState((s) => ({ ...s, [kind]: 'busy' }));
    try {
      const token = await auth.currentUser?.getIdToken();
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      fd.append('candidateId', candidateId);
      if (orgId) fd.append('orgId', orgId);
      const res = await fetch('/api/assessment-upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setState((s) => ({ ...s, [kind]: 'done' }));
        if (typeof data.nearworkScore === 'number') setNwScore(data.nearworkScore);
        showToast(kind === 'assessment' ? 'Assessment & English parsed' : 'DISC parsed', 'success');
        onComplete?.();
      } else {
        setState((s) => ({ ...s, [kind]: 'error' }));
        showToast(data.error || 'Could not read that PDF', 'error');
      }
    } catch {
      setState((s) => ({ ...s, [kind]: 'error' }));
      showToast('Upload failed — please try again', 'error');
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">Upload assessment reports</div>
          <div className="text-xs text-gray-500 mt-0.5">PDFs are read on the server and then discarded — nothing is stored.</div>
        </div>
        {nwScore != null && (
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Nearwork Score</div>
            <div className="text-2xl font-bold text-gray-900 leading-none">{nwScore}</div>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Slot title="Assessment & English" hint="The Proba assessment report PDF" state={state.assessment} onFile={(f) => upload('assessment', f)} />
        <Slot title="DISC" hint="The DISC / psychometric PDF" state={state.disc} onFile={(f) => upload('disc', f)} />
      </div>
    </div>
  );
}
