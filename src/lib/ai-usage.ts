// ── AI usage: one key and one meter per feature ──────────────────────────────
// Every Claude call in Admin belongs to exactly one feature, and each feature
// gets its own API key so spend can be read per feature in the Anthropic console
// without guessing. This module is the only place that decides which key a call
// uses and the only place usage is recorded, so a new feature can't quietly
// inherit another one's budget.
//
// The reason this exists before the features do: cost isn't the risk here — a
// month of vetting is about a dollar. The risk is a call wired to the wrong
// trigger, firing on every candidate instead of the three you interview. That
// shows up immediately as a call count, and not at all on an invoice this small.

import { adminDb, GCFieldValue } from './firebase-admin';

export type AIFeature = 'cv' | 'sourcing' | 'vetting';

const KEY_ENV: Record<AIFeature, string> = {
  cv: 'ANTHROPIC_CV_API_KEY',
  sourcing: 'ANTHROPIC_SOURCING_API_KEY',
  vetting: 'ANTHROPIC_VETTING_API_KEY',
};

// Per-feature daily ceilings. Deliberately generous — they exist to catch a
// misfiring trigger, not to ration normal use. Vetting's is low on purpose:
// at ~2 calls per interviewed candidate, 200 in a day means something is
// firing on the whole pipeline.
const DEFAULT_CAPS: Record<AIFeature, number> = {
  cv: 500,
  sourcing: 150,
  vetting: 200,
};

/**
 * The API key for a feature, falling back to the shared key.
 * A missing per-feature key is not an error — it just means that feature's
 * spend lands in the shared bucket until one is set.
 */
export function aiKey(feature: AIFeature): string {
  return (process.env[KEY_ENV[feature]] || process.env.ANTHROPIC_API_KEY || '').trim();
}

/** True when the feature is on its own key (so its spend is separable). */
export function hasOwnKey(feature: AIFeature): boolean {
  return !!(process.env[KEY_ENV[feature]] || '').trim();
}

export function aiDailyCap(feature: AIFeature): number {
  const n = Number(process.env[`AI_CAP_${feature.toUpperCase()}`]);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAPS[feature];
}

const day = () => new Date().toISOString().slice(0, 10);
const month = () => new Date().toISOString().slice(0, 7);

/**
 * Reserve one call against the feature's daily cap.
 * Counts BEFORE the call rather than after, so a call that fails still consumes
 * its slot — a feature failing in a loop is exactly the case a cap must stop,
 * and only counting successes would let it run forever.
 */
export async function reserveAiCall(feature: AIFeature): Promise<{ ok: boolean; used: number; cap: number }> {
  const cap = aiDailyCap(feature);
  const ref = adminDb().collection('aiUsage').doc(day());
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = (snap.exists ? snap.data() : {}) as Record<string, number>;
    const used = Number(d[`${feature}_calls`] || 0);
    if (used >= cap) return { ok: false, used, cap };
    tx.set(ref, {
      [`${feature}_calls`]: used + 1,
      updatedAt: GCFieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, used: used + 1, cap };
  });
}

/**
 * Record what a completed call actually cost.
 * Best-effort: a metering failure must never fail the work it was measuring.
 */
export async function recordAiUsage(
  feature: AIFeature,
  costUsd: number,
  meta: { model?: string; inputTokens?: number; outputTokens?: number; action?: string } = {},
): Promise<void> {
  const cents = Math.round((costUsd || 0) * 1e6);   // micro-dollars, kept as an integer
  try {
    await Promise.all([
      adminDb().collection('aiUsage').doc(day()).set({
        [`${feature}_microUsd`]: GCFieldValue.increment(cents),
        [`${feature}_inputTokens`]: GCFieldValue.increment(meta.inputTokens || 0),
        [`${feature}_outputTokens`]: GCFieldValue.increment(meta.outputTokens || 0),
        updatedAt: GCFieldValue.serverTimestamp(),
      }, { merge: true }),
      // A monthly roll-up as well, so the usage page doesn't read 30 documents
      // to answer "what did this cost this month".
      adminDb().collection('aiUsageMonthly').doc(month()).set({
        [`${feature}_calls`]: GCFieldValue.increment(1),
        [`${feature}_microUsd`]: GCFieldValue.increment(cents),
        updatedAt: GCFieldValue.serverTimestamp(),
      }, { merge: true }),
    ]);
  } catch (e) {
    console.warn('[ai-usage] could not record usage:', e instanceof Error ? e.message : e);
  }
}

/** Sonnet 5 pricing, $/MTok. Kept here so every feature costs the same way. */
export const PRICE = { in: 2, out: 10 };

export function costOf(usage: { input_tokens?: number; output_tokens?: number } | undefined): number {
  if (!usage) return 0;
  return ((usage.input_tokens || 0) * PRICE.in + (usage.output_tokens || 0) * PRICE.out) / 1e6;
}
