import { auth } from '@/lib/firebase';

// Notify the stage-email service about a stage change (fire-and-forget). The
// server debounces: it schedules the stage's email for +5 minutes and cancels
// it if the candidate moves again. Shared by the pipeline board and the
// candidate profile so both trigger emails identically. A failure here must
// NEVER block the actual stage change.
export interface StageEmailPayload {
  action: 'stage-moved' | 'cancel';
  pipelineCode: string;
  candidateId: string;
  fromStage?: string;
  toStage?: string;
  candidateName?: string;
  candidateEmail?: string;
  roleTitle?: string;
  orgName?: string;
  dropOffReason?: string;
}

export async function notifyStageEmail(payload: StageEmailPayload): Promise<void> {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    await fetch('/api/stage-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch {
    /* never block the stage change */
  }
}
