// ── Opening requirements → the matching vocabulary ───────────────────────────
// The other half of candidate↔opening matching. Candidates are classified by
// cv-ai-extract; this does the same for a job opening, using the SAME controlled
// lists — if the two sides don't share a vocabulary, matching silently fails.
//
// Openings already carry free text (requirements, content_qualifications,
// niceToHave, skills). This turns that into comparable values, and splits the
// requirements into must-have vs nice-to-have.

import { FUNCTIONS, SENIORITY, cvApiKey, type CVFunction, type CVSeniority } from './cv-ai-extract';
import type { Opening } from './types';

const MODEL = 'claude-sonnet-5';
const API = 'https://api.anthropic.com/v1/messages';
const PRICE_IN = 2;
const PRICE_OUT = 10;

export const OPENING_SCHEMA_VERSION = 1;

/** Beyond ~5 mandatory skills nothing matches, so the split is capped. */
export const MAX_MUST_HAVE = 5;

export interface OpeningRequirements {
  function: CVFunction;
  subFunction: string;
  seniority: CVSeniority;
  yearsRequired: number | null;
  englishRequired: string;      // CEFR where stated, else ''
  mustHaveSkills: string[];     // at most MAX_MUST_HAVE
  niceToHaveSkills: string[];
  tools: string[];
  industries: string[];
  summary: string;              // one line, what this role actually is
  notes: string[];              // anything ambiguous a human should confirm
}

export interface OpeningExtractResult {
  requirements: OpeningRequirements;
  usage: { input_tokens: number; output_tokens: number };
  costUsd: number;
  model: string;
  schemaVersion: number;
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'function', 'subFunction', 'seniority', 'yearsRequired', 'englishRequired',
    'mustHaveSkills', 'niceToHaveSkills', 'tools', 'industries', 'summary', 'notes',
  ],
  properties: {
    function: { type: 'string', enum: FUNCTIONS as unknown as string[] },
    subFunction: { type: 'string', description: 'lowercase_snake, e.g. lifecycle_email, account_management, data_analysis, financial_reporting' },
    seniority: { type: 'string', enum: SENIORITY as unknown as string[] },
    yearsRequired: { type: ['number', 'null'], description: 'Years of experience asked for. null when not stated — never invent a number.' },
    englishRequired: { type: 'string', description: 'CEFR level (B2, C1) when stated, otherwise empty' },
    mustHaveSkills: { type: 'array', items: { type: 'string' }, description: `At most ${MAX_MUST_HAVE}. The capabilities without which someone genuinely cannot do this job.` },
    niceToHaveSkills: { type: 'array', items: { type: 'string' }, description: 'Everything else that would help' },
    tools: { type: 'array', items: { type: 'string' }, description: 'Named platforms the role requires' },
    industries: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', description: 'One line: what this role actually does' },
    notes: { type: 'array', items: { type: 'string' }, description: 'Anything ambiguous a recruiter should confirm' },
  },
};

const SYSTEM = `You turn a job opening into structured requirements for a LATAM nearshore staffing company, so candidates can be matched against it.

Roles span every business function — operations, finance, HR, engineering, design, data, customer success, sales, admin and marketing. Read this role on its own terms; never default to marketing framing.

Rules:
- function/subFunction is the role's actual discipline, which matters more than its title. An "Account Manager" running campaigns is marketing; one running logistics is operations. This is the single field that decides which candidates are even considered, so get it right.
- mustHaveSkills: at most ${MAX_MUST_HAVE}, and only capabilities without which someone genuinely could not do the job. Clients list far more than they mean; everything else goes to niceToHaveSkills. A long must-have list matches nobody, which helps no one.
- Name skills the way a CV would ("email marketing", "financial reporting", "process improvement"), not as job titles or sentences. Keep them lowercase.
- yearsRequired: only when stated. Never infer a number from seniority.
- Put anything genuinely ambiguous in notes for a recruiter to confirm — do not guess in the fields themselves.`;

/** Everything on the opening that describes what the role needs. */
function openingText(o: Partial<Opening>): string {
  const list = (v: unknown) => (Array.isArray(v) ? (v as string[]).join('\n- ') : '');
  return [
    o.title && `Title: ${o.title}`,
    o.department && `Department: ${o.department}`,
    o.seniority && `Seniority: ${o.seniority}`,
    o.exp && `Experience: ${o.exp}`,
    o.industry && `Industry: ${o.industry}`,
    o.content_about && `About the role:\n${o.content_about}`,
    o.description && `Description:\n${o.description}`,
    list(o.content_responsibilities) && `Responsibilities:\n- ${list(o.content_responsibilities)}`,
    list(o.responsibilities) && `Responsibilities:\n- ${list(o.responsibilities)}`,
    list(o.content_qualifications) && `Qualifications:\n- ${list(o.content_qualifications)}`,
    list(o.requirements) && `Requirements:\n- ${list(o.requirements)}`,
    list(o.niceToHave) && `Nice to have:\n- ${list(o.niceToHave)}`,
    Array.isArray(o.skills) ? `Skills listed: ${(o.skills as string[]).join(', ')}` : (o.skills ? `Skills listed: ${o.skills}` : ''),
  ].filter(Boolean).join('\n\n');
}

export async function extractOpeningRequirements(
  opening: Partial<Opening>,
  apiKey = cvApiKey(),
): Promise<OpeningExtractResult> {
  if (!apiKey) throw new Error('No API key configured for requirement extraction');
  const text = openingText(opening);
  if (text.trim().length < 40) {
    throw new Error('This opening has too little detail to extract requirements from');
  }

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      system: SYSTEM,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: `<opening>\n${text}\n</opening>\n\nExtract the requirements.` }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    }),
  });

  if (!res.ok) {
    throw new Error(`Requirement extraction failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const json = await res.json();
  const block = (json.content as { type: string; text?: string }[]).find((b) => b.type === 'text');
  if (!block?.text) throw new Error('Requirement extraction returned no content');

  const requirements = JSON.parse(block.text) as OpeningRequirements;
  // Enforce the cap even if the model over-produces; the overflow is still
  // useful, so it moves to nice-to-have rather than being dropped.
  if (requirements.mustHaveSkills.length > MAX_MUST_HAVE) {
    const overflow = requirements.mustHaveSkills.slice(MAX_MUST_HAVE);
    requirements.mustHaveSkills = requirements.mustHaveSkills.slice(0, MAX_MUST_HAVE);
    requirements.niceToHaveSkills = [...requirements.niceToHaveSkills, ...overflow];
  }

  return {
    requirements,
    usage: json.usage,
    costUsd: (json.usage.input_tokens * PRICE_IN + json.usage.output_tokens * PRICE_OUT) / 1e6,
    model: MODEL,
    schemaVersion: OPENING_SCHEMA_VERSION,
  };
}
