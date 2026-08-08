// ── Approving / rejecting an applicant ───────────────────────────────────────
// Extracted so the pipeline board and the opening's Pipeline tab share ONE
// implementation. Approving is not a single write — it adds the candidate to the
// pipeline, marks the application, mirrors the stage onto the candidate doc, and
// triggers the stage email. A second copy of that would drift, and the drift
// would be silent: the candidate would look approved in one place and never
// receive the email.

import { db, doc, getDoc, updateDoc, arrayUnion, serverTimestamp } from '@/lib/firebase';
import { clientCandidateSnapshot } from '@/lib/client-candidate-snapshot';
import type { Candidate } from '@/lib/types';

export interface ApplicantDoc {
  id: string;
  candidateId: string;
  candidateCode?: string;
  candidateName: string;
  candidateEmail: string;
  cvUrl?: string | null;
  skills?: string[];
  expectedSalary?: string;
}

export interface ApprovePipeline {
  id: string;
  code: string;
  title?: string;
  orgName?: string;
}

/**
 * Approve an applicant into the pipeline's first stage.
 * Returns the candidate id so the caller can refresh its own view.
 * Throws on failure — callers surface the message.
 */
export async function approveApplicant(
  app: ApplicantDoc,
  pipeline: ApprovePipeline,
): Promise<{ candidateId: string; entry: Record<string, unknown> }> {
  const candId = app.candidateCode || app.candidateId;

  // Pull the full profile so the client portal gets the same sourcing-safe
  // snapshot a manual add would produce (work history, resume, etc.).
  const candSnap = await getDoc(doc(db, 'candidates', candId)).catch(() => null);
  const cand = candSnap?.exists() ? ({ id: candId, ...candSnap.data() } as Candidate) : undefined;

  const entry = {
    candidateId: candId,
    candidateCode: candId,
    name: app.candidateName || '',
    email: app.candidateEmail || '',
    stage: 'applied',
    addedAt: new Date().toISOString(),
    source: 'jobs.nearwork.co',
    cvUrl: app.cvUrl ?? null,
    skills: app.skills ?? [],
    expectedSalary: app.expectedSalary ?? '',
    ...(cand ? clientCandidateSnapshot(cand) : {}),
  };

  await Promise.all([
    updateDoc(doc(db, 'pipelines', pipeline.id), {
      candidates: arrayUnion(entry),
      updatedAt: serverTimestamp(),
    }),
    updateDoc(doc(db, 'applications', app.id), {
      status: 'approved',
      inPipeline: true,
      pipelineStage: 'applied',
    }),
    // Mirror onto the candidate so the Candidates list shows progress at once.
    // Best-effort: a failure here must not leave the approval half-done.
    updateDoc(doc(db, 'candidates', candId), {
      activePipelineCode: pipeline.code,
      activePipelineStage: 'applied',
      updatedAt: serverTimestamp(),
    }).catch(() => null),
  ]);

  return { candidateId: candId, entry };
}

/** Reject an applicant. They stay in `applications`, marked and timestamped. */
export async function rejectApplicant(app: ApplicantDoc, reason?: string): Promise<void> {
  await updateDoc(doc(db, 'applications', app.id), {
    status: 'rejected',
    rejectedAt: new Date().toISOString(),
    ...(reason ? { rejectReason: reason } : {}),
  });
}
