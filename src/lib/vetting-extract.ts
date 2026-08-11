// ── Interview notes → a structured record ────────────────────────────────────
// The reason this exists: a form with eight fields gets skipped by a busy
// recruiter, and an interview record nobody fills in is worth nothing. Pasting
// whatever you actually wrote removes the work entirely.
//
// It is also more honest than a form. People write what happened in notes; they
// write what the form asked for in a form.

import { aiKey, recordAiUsage, reserveAiCall, costOf } from './ai-usage';
import type { InterviewRatings, VettingRecommendation, Attendance } from './types';

const MODEL = 'claude-sonnet-5';
const API = 'https://api.anthropic.com/v1/messages';

export interface ExtractedInterview {
  summary: string;
  strengths: string[];
  concerns: string[];
  ratings: InterviewRatings;
  attendance: Attendance;
  recommendation: VettingRecommendation;
  recommendationReason: string;
  fitOverride: number | null;
  fitOverrideReason: string;
  unanswered: string[];
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary', 'strengths', 'concerns', 'ratings', 'attendance',
    'recommendation', 'recommendationReason', 'fitOverride', 'fitOverrideReason', 'unanswered',
  ],
  properties: {
    summary: { type: 'string', description: 'Two or three sentences: what happened and what you now know that you did not before.' },
    strengths: { type: 'array', items: { type: 'string' }, description: 'Specific, evidenced by something said in the interview. Not adjectives.' },
    concerns: { type: 'array', items: { type: 'string' }, description: 'Specific. Empty is a valid answer — do not invent balance.' },
    ratings: {
      type: 'object',
      additionalProperties: false,
      required: ['communication', 'depth', 'english'],
      properties: {
        communication: { type: ['number', 'null'], description: '1–5. null when the notes give no basis — never guess a middle value.' },
        depth: { type: ['number', 'null'], description: '1–5, depth of role knowledge. null when not evidenced.' },
        english: { type: ['number', 'null'], description: '1–5, English as actually spoken. null when not mentioned.' },
      },
    },
    attendance: { type: 'string', enum: ['showed', 'late', 'no_show'], description: 'Default to showed unless the notes say otherwise.' },
    recommendation: { type: 'string', enum: ['present', 'hold', 'reject'] },
    recommendationReason: { type: 'string', description: 'One line, in the interviewer’s own terms.' },
    fitOverride: { type: ['number', 'null'], description: '0–100, the interviewer’s own read on fit for THIS role, only when the notes support one. null otherwise.' },
    fitOverrideReason: { type: 'string' },
    unanswered: { type: 'array', items: { type: 'string' }, description: 'Questions that were asked but not really answered, or that the notes show were never asked.' },
  },
};

const SYSTEM = `You turn a recruiter's interview notes into a structured record for a LATAM nearshore staffing company.

The notes are raw — fragments, shorthand, half sentences, sometimes a mix of English and Spanish. Read them as evidence of what happened, not as prose to be tidied.

Rules:
- Record only what the notes support. If they say nothing about the candidate's English, english is null. A guessed middle rating is worse than an absent one, because it looks like a measurement.
- strengths and concerns must be specific and traceable to something in the notes. "Good communicator" is useless; "walked through the Braze migration unprompted, including what went wrong" is not.
- An empty concerns list is a legitimate outcome. Do not manufacture a concern for balance.
- recommendation reflects what the interviewer clearly thinks. If the notes are genuinely ambivalent, use hold.
- fitOverride only when the notes justify it — an interviewer saying someone is stronger or weaker than their CV suggested. Otherwise null. This value overrides a CV-derived score, so inventing one does real damage.
- unanswered is what a follow-up should cover. Leave it empty rather than padding it.
- Write output in English even when the notes are in Spanish.`;

export async function extractInterviewNotes(
  notes: string,
  context: { role?: string; mustHaves?: string[]; candidateName?: string } = {},
): Promise<{ data: ExtractedInterview; costUsd: number; model: string }> {
  const key = aiKey('vetting');
  if (!key) throw new Error('No vetting API key configured (ANTHROPIC_VETTING_API_KEY)');
  if (!notes.trim()) throw new Error('No notes to read');

  const slot = await reserveAiCall('vetting');
  if (!slot.ok) throw new Error(`Daily vetting limit reached (${slot.used}/${slot.cap})`);

  const brief = [
    context.candidateName && `Candidate: ${context.candidateName}`,
    context.role && `Role: ${context.role}`,
    context.mustHaves?.length && `The role must-haves: ${context.mustHaves.join(', ')}`,
  ].filter(Boolean).join('\n');

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2500,
      system: SYSTEM,
      thinking: { type: 'disabled' },
      messages: [{
        role: 'user',
        content: `${brief ? brief + '\n\n' : ''}<notes>\n${notes.trim()}\n</notes>\n\nTurn these notes into the record.`,
      }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    }),
  });

  if (!res.ok) throw new Error(`Reading the notes failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const block = (json.content as { type: string; text?: string }[]).find((b) => b.type === 'text');
  if (!block?.text) throw new Error('The notes reader returned nothing');

  const costUsd = costOf(json.usage);
  await recordAiUsage('vetting', costUsd, {
    model: MODEL,
    inputTokens: json.usage?.input_tokens,
    outputTokens: json.usage?.output_tokens,
    action: 'interview-notes',
  });

  return { data: JSON.parse(block.text) as ExtractedInterview, costUsd, model: MODEL };
}

// ── Interview questions ──────────────────────────────────────────────────────
// Fired only when a candidate is moved TO Interview. On application it would run
// for everyone — 14 people to prepare for 3 conversations.
//
// The point is not generic role questions. It is to turn the internal signals
// into questions: the must-have their CV never evidenced, the eleven-month
// average tenure, the salary expectation above the band. Those flags are never
// shown to a client and never used as verdicts — this is what they are for.

const Q_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'why'],
        properties: {
          question: { type: 'string', description: 'Ask it the way a person would say it out loud.' },
          why: { type: 'string', description: 'What this resolves — the gap, flag or claim it tests.' },
        },
      },
    },
  },
};

const Q_SYSTEM = `You write interview questions for a recruiter at a LATAM nearshore staffing company, about one candidate for one role.

Write 6 to 8 questions. Every one must earn its place by resolving something specific and unresolved — a must-have their CV never evidences, a short or unexplained tenure, a salary expectation above the band, a claim worth testing.

Rules:
- Never ask what the CV already answers. If it says four years of email marketing, do not ask how long they have done email marketing.
- Open questions about real situations, not yes/no and not hypotheticals. "Tell me about a campaign where…" rather than "Are you comfortable with…".
- Tenure and salary are asked neutrally, as things to understand, never as accusations. A short stint usually has an ordinary explanation.
- Say plainly in "why" what each question is for, so the recruiter can drop the ones they do not need.
- English.`;

export async function generateInterviewQuestions(context: {
  role: string;
  roleSummary?: string;
  mustHaves?: string[];
  missingMustHaves?: string[];
  candidateName?: string;
  candidateSummary?: string;
  workHistory?: { title?: string; company?: string; from?: string; to?: string }[];
  flags?: string[];
}): Promise<{ questions: { question: string; why: string }[]; costUsd: number }> {
  const key = aiKey('vetting');
  if (!key) throw new Error('No vetting API key configured (ANTHROPIC_VETTING_API_KEY)');

  const slot = await reserveAiCall('vetting');
  if (!slot.ok) throw new Error(`Daily vetting limit reached (${slot.used}/${slot.cap})`);

  const body = [
    `ROLE: ${context.role}`,
    context.roleSummary && `What the role is: ${context.roleSummary}`,
    context.mustHaves?.length && `Must-haves: ${context.mustHaves.join(', ')}`,
    context.missingMustHaves?.length && `NOT evidenced by their CV: ${context.missingMustHaves.join(', ')}`,
    context.candidateName && `\nCANDIDATE: ${context.candidateName}`,
    context.candidateSummary && context.candidateSummary,
    context.workHistory?.length && 'Work history:\n' + context.workHistory
      .map((w) => `- ${w.title || '?'} at ${w.company || '?'} (${w.from || '?'} – ${w.to || 'present'})`).join('\n'),
    context.flags?.length && `\nWORTH PROBING: ${context.flags.join(' · ')}`,
  ].filter(Boolean).join('\n');

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: Q_SYSTEM,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: body }],
      output_config: { format: { type: 'json_schema', schema: Q_SCHEMA } },
    }),
  });

  if (!res.ok) throw new Error(`Could not write the questions (${res.status})`);
  const json = await res.json();
  const block = (json.content as { type: string; text?: string }[]).find((b) => b.type === 'text');
  if (!block?.text) throw new Error('The question writer returned nothing');

  const costUsd = costOf(json.usage);
  await recordAiUsage('vetting', costUsd, {
    model: MODEL,
    inputTokens: json.usage?.input_tokens,
    outputTokens: json.usage?.output_tokens,
    action: 'interview-questions',
  });

  return { questions: JSON.parse(block.text).questions, costUsd };
}
