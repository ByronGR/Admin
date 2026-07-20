// ─── Pipeline stage models ────────────────────────────────────────────────────
// Two engagement types, two stage sets. Everything that renders or moves a
// candidate should read the stages from here via stagesFor(pipelineType), so the
// board, candidate detail, the stage-email route and the client portal stay in
// lockstep.
//
//   full     — Nearwork runs the whole process (the original 8-stage flow).
//   sourcing — Nearwork sources + screens + submits; the client runs their own
//              interviews/assessment/hiring and marks the outcome.

export type PipelineType = 'full' | 'sourcing';

export interface StageDef {
  key: string;
  label: string;
  /** Client-facing label (what the partner sees in their portal). */
  clientLabel?: string;
  /** Client can move a candidate INTO this stage from their portal. */
  clientMovable?: boolean;
  /** Nearwork-only stage — the client can view candidates here but never move them. */
  nearworkOnly?: boolean;
  /** End state (Hired / Not Selected). */
  terminal?: boolean;
  /** The "win" end state — stamps a hire for per-hire billing. */
  success?: boolean;
}

// Full recruitment — mirrors the original PIPELINE_STAGES in pipeline-page.tsx.
export const FULL_STAGES: StageDef[] = [
  { key: 'applied', label: 'Applied' },
  { key: 'background-check', label: 'Background Check' },
  { key: 'interview', label: 'Interview' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'partner-review', label: 'Partner Review' },
  { key: 'partner-interview', label: 'Partner Interview' },
  { key: 'hired', label: 'Hired', terminal: true, success: true },
  { key: 'not-selected', label: 'Not Selected', terminal: true },
];

// Sourcing only. Nearwork moves sourced → screening → submitted; the client
// moves submitted → in-progress / hired / not-selected. The candidate email
// fires on 'submitted' and nowhere else.
export const SOURCING_STAGES: StageDef[] = [
  { key: 'sourced', label: 'Sourced', nearworkOnly: true },
  { key: 'screening', label: 'Screening', nearworkOnly: true },
  { key: 'submitted', label: 'Submitted', clientLabel: 'New candidate' },
  { key: 'in-progress', label: 'In Progress', clientLabel: 'In progress', clientMovable: true },
  { key: 'hired', label: 'Hired', clientMovable: true, terminal: true, success: true },
  { key: 'not-selected', label: 'Not Selected', clientLabel: 'Not a fit', clientMovable: true, terminal: true },
];

export function isSourcing(pipelineType?: string | null): boolean {
  return pipelineType === 'sourcing';
}

export function stagesFor(pipelineType?: string | null): StageDef[] {
  return isSourcing(pipelineType) ? SOURCING_STAGES : FULL_STAGES;
}

export function stageDef(pipelineType: string | null | undefined, key: string): StageDef | undefined {
  return stagesFor(pipelineType).find((s) => s.key === key);
}

export function stageLabel(pipelineType: string | null | undefined, key: string): string {
  return stageDef(pipelineType, key)?.label ?? key;
}

// Stages the CLIENT can move a candidate into (portal drag targets). Empty for
// full recruitment — there the client requests moves, never performs them.
export function clientMovableStages(pipelineType?: string | null): string[] {
  if (!isSourcing(pipelineType)) return [];
  return SOURCING_STAGES.filter((s) => s.clientMovable).map((s) => s.key);
}

// The only stage transitions the client is allowed to make in a sourcing
// pipeline: from 'submitted' or 'in-progress' → in-progress / hired / not-selected.
// Mirrored in the Firestore rules (App/firestore.rules).
export function clientCanMove(pipelineType: string | null | undefined, from: string, to: string): boolean {
  if (!isSourcing(pipelineType)) return false;
  const fromOk = from === 'submitted' || from === 'in-progress';
  const toOk = clientMovableStages(pipelineType).includes(to);
  return fromOk && toOk;
}

// Sourcing stage-name normalization. 'screening' is a real distinct stage here
// (in full recruitment the board folds it into 'applied'), so sourcing rendering
// must use this, not the full normalizeStage.
export function normalizeSourcingStage(stage: string): string {
  const s = String(stage || '').trim().toLowerCase();
  if (SOURCING_STAGES.some((st) => st.key === s)) return s;
  if (['applied', 'new'].includes(s)) return 'sourced';
  if (['rejected', 'declined', 'withdrawn'].includes(s)) return 'not-selected';
  if (['in_progress', 'inprogress', 'interviewing'].includes(s)) return 'in-progress';
  return 'sourced';
}
