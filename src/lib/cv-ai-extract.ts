// ── AI CV extraction ─────────────────────────────────────────────────────────
// One Claude call turns an uploaded CV into a structured candidate profile.
// Replaces the paid Affinda parser (~$0.20-0.30/CV) at ~$0.033/CV measured.
//
// Why we send BOTH the PDF and the extracted text:
//   - The PDF preserves visual layout. Two-column CVs put a company in one column
//     and its dates in another; text extraction reads column-by-column and pairs
//     them wrongly. Measured: text-only produced a completely wrong work history
//     on a real two-column CV, PDF-only got it right.
//   - The extracted text preserves hyperlink URLs. A PDF shows only the anchor
//     text, so PDF-only returns "LinkedIn" instead of the profile URL.
// Together they cover each other's blind spot. .docx has no visual layout to
// lose, so text alone is correct there.

import { extractCVText, detectKind, type CVFileKind } from './cv-extract-text';

const MODEL = 'claude-sonnet-5';
const API = 'https://api.anthropic.com/v1/messages';

// ─── Controlled vocabulary ───────────────────────────────────────────────────
// Matching compares these values, never free text. Both candidates AND openings
// must classify into the same lists or nothing lines up. 'unknown' rather than
// empty: matching needs a definite bucket, not a hole.

export const FUNCTIONS = [
  'marketing', 'sales', 'operations', 'finance', 'hr', 'engineering',
  'design', 'data', 'customer_success', 'admin', 'other', 'unknown',
] as const;

export const SENIORITY = [
  'intern', 'junior', 'mid', 'senior', 'lead', 'manager',
  'director', 'vp', 'c_level', 'unknown',
] as const;

export type CVFunction = (typeof FUNCTIONS)[number];
export type CVSeniority = (typeof SENIORITY)[number];

export interface AIWorkEntry {
  company: string;
  title: string;
  startDate: string;          // YYYY-MM when determinable
  endDate: string;            // '' means current
  isCurrent: boolean;
  location: string;
  industry: string;
  responsibilities: string[]; // duties
  accomplishments: string[];  // quantified outcomes only — kept separate on purpose
}

export interface AIExtractedCV {
  fullName: string;
  email: string;
  phone: string;
  city: string;
  countryCode: string;
  linkedin: string;
  portfolio: string;
  github: string;
  headline: string;
  summary: string;
  function: CVFunction;
  subFunction: string;
  seniority: CVSeniority;
  yearsExperience: number | null;
  yearsInFunction: number | null;
  currentEmployer: string;
  skills: string[];           // capabilities
  tools: string[];            // named platforms — Salesforce, Klaviyo, Power BI
  industries: string[];
  workHistory: AIWorkEntry[];
  education: { institution: string; degree: string; field: string; endYear: number | null }[];
  certifications: { name: string; issuer: string; year: number | null }[];
  languages: { language: string; claimedLevel: string }[];
  englishClaimed: string;     // self-reported — never treated as an assessed score
  salaryExpectation: string;
  availability: string;
  lowConfidence: string[];    // drives the staff review queue
}

export interface AIExtractResult {
  profile: AIExtractedCV;
  rawText: string;            // stored so re-parsing the whole DB costs ~$2
  usage: { input_tokens: number; output_tokens: number };
  costUsd: number;
  model: string;
  schemaVersion: number;
}

export const SCHEMA_VERSION = 1;

// Sonnet 5 intro pricing per 1M tokens (standard: 3 / 15).
const PRICE_IN = 2;
const PRICE_OUT = 10;

// Structured outputs cap union-typed (nullable) fields at 16. Text fields use ''
// for "not stated" so only genuine numbers stay nullable.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'fullName', 'email', 'phone', 'city', 'countryCode', 'linkedin', 'portfolio', 'github',
    'headline', 'summary', 'function', 'subFunction', 'seniority',
    'yearsExperience', 'yearsInFunction', 'currentEmployer',
    'skills', 'tools', 'industries', 'workHistory', 'education', 'certifications',
    'languages', 'englishClaimed', 'salaryExpectation', 'availability', 'lowConfidence',
  ],
  properties: {
    fullName: { type: 'string' },
    email: { type: 'string' },
    phone: { type: 'string' },
    city: { type: 'string' },
    countryCode: { type: 'string', description: 'ISO-2 country code, e.g. CO, VE, AR, MX' },
    linkedin: { type: 'string', description: 'Full URL. Prefer a URL from the text block over anchor text.' },
    portfolio: { type: 'string', description: 'Full URL' },
    github: { type: 'string', description: 'Full URL' },
    headline: { type: 'string', description: 'One line: discipline, years, industry' },
    summary: { type: 'string', description: '2-3 factual sentences drawn from the CV only' },
    function: { type: 'string', enum: FUNCTIONS as unknown as string[] },
    subFunction: { type: 'string', description: 'lowercase_snake, e.g. lifecycle_email, paid_performance, account_management, data_analysis' },
    seniority: { type: 'string', enum: SENIORITY as unknown as string[] },
    yearsExperience: { type: ['number', 'null'], description: 'Computed from employment dates. null if not determinable — never estimate.' },
    yearsInFunction: { type: ['number', 'null'], description: 'Years within `function` specifically' },
    currentEmployer: { type: 'string' },
    skills: { type: 'array', items: { type: 'string' }, description: 'Capabilities, not platforms' },
    tools: { type: 'array', items: { type: 'string' }, description: 'Named platforms/software' },
    industries: { type: 'array', items: { type: 'string' } },
    workHistory: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['company', 'title', 'startDate', 'endDate', 'isCurrent', 'location', 'industry', 'responsibilities', 'accomplishments'],
        properties: {
          company: { type: 'string' },
          title: { type: 'string' },
          startDate: { type: 'string', description: 'YYYY-MM when determinable' },
          endDate: { type: 'string', description: 'Empty when current' },
          isCurrent: { type: 'boolean' },
          location: { type: 'string' },
          industry: { type: 'string' },
          responsibilities: { type: 'array', items: { type: 'string' } },
          accomplishments: { type: 'array', items: { type: 'string' }, description: 'Quantified outcomes ONLY' },
        },
      },
    },
    education: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['institution', 'degree', 'field', 'endYear'],
        properties: {
          institution: { type: 'string' },
          degree: { type: 'string' },
          field: { type: 'string' },
          endYear: { type: ['number', 'null'] },
        },
      },
    },
    certifications: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'issuer', 'year'],
        properties: {
          name: { type: 'string' },
          issuer: { type: 'string', description: 'DataCamp, Google, AWS — the body, never a university' },
          year: { type: ['number', 'null'] },
        },
      },
    },
    languages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['language', 'claimedLevel'],
        properties: {
          language: { type: 'string' },
          claimedLevel: { type: 'string', description: 'As written by the candidate' },
        },
      },
    },
    englishClaimed: { type: 'string', description: 'Self-reported English level, empty if not stated' },
    salaryExpectation: { type: 'string' },
    availability: { type: 'string' },
    lowConfidence: { type: 'array', items: { type: 'string' }, description: 'Fields you were unsure about, and why' },
  },
};

const SYSTEM = `You extract structured candidate profiles from CVs for a LATAM nearshore staffing company.

You may receive the CV as a document (use its VISUAL LAYOUT — columns and alignment tell you which dates belong to which employer) and/or as extracted text (use it for exact URLs, which the document view does not expose). When they disagree, trust the document for structure and the text for URLs.

Rules:
- Never invent. Empty string for unknown text, null for unknown numbers, "unknown" for function/seniority when the CV genuinely does not say.
- yearsExperience: compute from employment dates. If dates are missing or contradictory, return null rather than estimating.
- accomplishments = quantified outcomes ("cut churn 18%", "led a team of 22"). responsibilities = duties. Never put a duty in accomplishments.
- Education is schools and degrees. A Google, DataCamp or AWS certificate is a CERTIFICATION with that body as issuer — never an institution under education.
- Never list an education entry as employment.
- englishClaimed and languages record what the candidate claims. This is self-reported and is not a verified score.
- function/subFunction is the candidate's actual discipline, which matters more than their job title: an "Account Manager" doing marketing is function=marketing; an "Account Manager" doing logistics is function=operations.
- skills are capabilities; tools are named platforms. Keep them separate.
- Put anything you were unsure about in lowConfidence, with a short reason.`;

function costOf(usage: { input_tokens: number; output_tokens: number }): number {
  return (usage.input_tokens * PRICE_IN + usage.output_tokens * PRICE_OUT) / 1e6;
}

/**
 * Extract a structured profile from a CV buffer.
 * Throws on API/auth failure so the caller can fall back to the code parser.
 */
export async function extractCVWithAI(
  buffer: Buffer,
  filename: string,
  apiKey: string,
  mime?: string,
): Promise<AIExtractResult> {
  const kind: CVFileKind | null = detectKind(filename, mime);
  if (!kind) throw new Error(`Unsupported CV type: ${filename}`);

  // Text extraction is a BONUS for PDFs, never a requirement. Claude reads the
  // PDF itself, so the parse must not depend on pdf.js — which works locally but
  // can fail in the serverless runtime. We only lose exact hyperlink URLs.
  // For .docx there is no document block to send, so text is mandatory there.
  let rawText = '';
  let textError = '';
  try {
    rawText = await extractCVText(buffer, kind);
  } catch (e) {
    textError = e instanceof Error ? e.message : String(e);
    if (kind === 'docx') {
      throw new Error(`Could not read the Word document: ${textError}`);
    }
    console.warn('[cv-ai-extract] text extraction failed, continuing with the PDF alone:', textError);
  }

  const content: Record<string, unknown>[] = [];
  if (kind === 'pdf') {
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
    });
  }
  content.push({
    type: 'text',
    text: kind === 'pdf'
      ? (rawText
          ? `Extracted text from the same CV — use it for exact URLs:\n<text>\n${rawText}\n</text>\n\nExtract the profile.`
          : 'Extract the profile from the attached document.')
      : `<cv>\n${rawText}\n</cv>\n\nExtract the profile.`,
  });

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      thinking: { type: 'disabled' },   // extraction is recall, not reasoning
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CV extraction failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  const textBlock = (json.content as { type: string; text?: string }[]).find((b) => b.type === 'text');
  if (!textBlock?.text) throw new Error('CV extraction returned no content');

  return {
    profile: JSON.parse(textBlock.text) as AIExtractedCV,
    rawText,
    usage: json.usage,
    costUsd: costOf(json.usage),
    model: MODEL,
    schemaVersion: SCHEMA_VERSION,
  };
}
