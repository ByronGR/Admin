// ── One reading of an opening, shared by everything that needs it ────────────
// Sourcing (X-ray, finding people we don't have) and matching (finding people we
// do) were each interpreting the raw job text separately, which meant two AI
// calls and two vocabularies for one job post. Both now read the same extracted
// requirements.
//
// Extraction is lazy rather than on-create: openings get drafted and abandoned,
// and there's no reason to spend a cent on one nobody ever sources for. The
// first thing that needs requirements pays for them, once, and everything after
// that reads the saved copy.

import { adminDb, GCFieldValue } from './firebase-admin';
import { extractOpeningRequirements } from './opening-ai-extract';
import { aiKey, recordAiUsage, reserveAiCall } from './ai-usage';
import type { Opening, OpeningReqs } from './types';

export interface EnsureResult {
  reqs?: OpeningReqs;
  extracted: boolean;      // true when this call paid for the extraction
  costUsd?: number;
  error?: string;
}

/**
 * The opening's requirements, extracting them first if they don't exist yet.
 * Never throws — sourcing and matching both have useful fallbacks, so a failure
 * here should degrade them, not break them.
 */
export async function ensureOpeningReqs(
  openingId: string,
  opening?: Opening,
  opts: { force?: boolean } = {},
): Promise<EnsureResult> {
  const db = adminDb();
  const ref = db.collection('openings').doc(openingId);

  let op = opening;
  if (!op) {
    const snap = await ref.get();
    if (!snap.exists) return { extracted: false, error: 'Opening not found' };
    op = snap.data() as Opening;
  }

  if (op.reqs && !opts.force) return { reqs: op.reqs, extracted: false };
  // A recruiter's edits outrank a re-read, always.
  if (op.reqs?.editedBy && opts.force) return { reqs: op.reqs, extracted: false };

  // Requirements describe the ROLE, not a CV — it belongs to the vetting budget.
  const key = aiKey('vetting');
  if (!key) return { extracted: false, error: 'No API key configured' };

  // One shared meter rather than borrowing the CV parser's counter, which was
  // making requirement extractions look like CV parses in the numbers.
  const slot = await reserveAiCall('vetting');
  if (!slot.ok) {
    return { extracted: false, error: `Daily vetting limit reached (${slot.used}/${slot.cap})` };
  }

  try {
    const r = await extractOpeningRequirements(op, key);
    await recordAiUsage('vetting', r.costUsd, { model: r.model, action: 'opening-reqs' });
    const reqs: OpeningReqs = {
      ...r.requirements,
      extractedAt: new Date().toISOString(),
      model: r.model,
      schemaVersion: r.schemaVersion,
    };
    await ref.set({ reqs, updatedAt: GCFieldValue.serverTimestamp() }, { merge: true });
    return { reqs, extracted: true, costUsd: r.costUsd };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[opening-reqs] extraction failed:', e);
    return { extracted: false, error };
  }
}

/**
 * Requirements rendered for the X-ray plan writer.
 * The plan prompt spends most of its reasoning working out the role's domain and
 * its real-world equivalent titles; handing it the already-resolved discipline
 * and must-haves means it anchors on exactly what the matcher will score
 * against, so sourced people and internal matches are judged the same way.
 */
export function reqsAsPlanBrief(reqs: OpeningReqs | undefined): string {
  if (!reqs) return '';
  const lines = [
    reqs.function && reqs.function !== 'unknown' && `DOMAIN (already determined): ${reqs.function.replace(/_/g, ' ')}`,
    reqs.subFunction && `SPECIALISM: ${reqs.subFunction.replace(/_/g, ' ')}`,
    reqs.seniority && reqs.seniority !== 'unknown' && `SENIORITY: ${reqs.seniority.replace(/_/g, ' ')}`,
    reqs.mustHaveSkills?.length && `MUST HAVE: ${reqs.mustHaveSkills.join(', ')}`,
    reqs.niceToHaveSkills?.length && `NICE TO HAVE: ${reqs.niceToHaveSkills.slice(0, 8).join(', ')}`,
    reqs.tools?.length && `TOOLS: ${reqs.tools.join(', ')}`,
    reqs.summary && `IN SHORT: ${reqs.summary}`,
  ].filter(Boolean);
  return lines.length ? `${lines.join('\n')}\n\n--- original job post below ---\n` : '';
}
