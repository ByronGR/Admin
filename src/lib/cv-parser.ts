// ── CV / résumé parser (pure code, no AI, zero per-parse cost) ────────────────
// Turns the plain text of a candidate's CV (PDF or Word) into structured fields
// that map onto our Candidate model. Replaces the paid Affinda parser.
//
// Design notes:
//  • Deterministic heuristics, English + Spanish (many candidates are Colombian).
//  • Every field is best-effort. Contact details (email/phone/URLs) are highly
//    reliable; work history / education are layout-dependent and meant to be
//    reviewed by a recruiter before saving. We NEVER silently discard text —
//    unclaimed section text is surfaced so we can see what we missed and tune.
//  • This file is the thing we iterate on. Add headings/patterns as real CVs
//    reveal formats we don't yet handle.

// ─── Output shape ─────────────────────────────────────────────────────────────

export interface ParsedWorkEntry {
  company?: string;
  title?: string;
  from?: string;      // raw text as found, e.g. "Jan 2020"
  to?: string;        // raw text as found, e.g. "Present"
  location?: string;
  description?: string;
}

export interface ParsedEducationEntry {
  institution?: string;
  degree?: string;
  field?: string;
  location?: string;
  from?: string;
  to?: string;
}

export interface ParsedCertification {
  name: string;
  issuer?: string;
  date?: string;
}

export interface ParsedLanguage {
  language: string;      // canonical English name, e.g. "English"
  proficiency?: string;  // single normalized level, e.g. "Native", "C1", "Fluent"
}

export interface ParsedCV {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedIn: string | null;
  portfolio: string | null;          // github / personal site / behance etc.
  headline: string | null;           // role/title line near the top
  summary: string | null;
  skills: string[];
  languages: ParsedLanguage[];
  workHistory: ParsedWorkEntry[];
  education: ParsedEducationEntry[];
  certifications: ParsedCertification[];
  experienceYears: number | null;    // estimated from work-history date span
  // Diagnostics — not for storage; help us see coverage while tuning.
  _meta: {
    sectionsFound: string[];
    warnings: string[];
    unparsedSections: Record<string, string>;
  };
}

// ─── Section vocabulary (extend as CVs reveal new headings) ───────────────────

type SectionKey =
  | 'summary'
  | 'experience'
  | 'education'
  | 'skills'
  | 'certifications'
  | 'languages';

const SECTION_HEADINGS: Record<SectionKey, string[]> = {
  summary: [
    'summary', 'professional summary', 'profile', 'professional profile',
    'about', 'about me', 'objective', 'career objective',
    'perfil', 'perfil profesional', 'resumen', 'acerca de', 'objetivo',
  ],
  experience: [
    'experience', 'work experience', 'professional experience', 'employment',
    'employment history', 'work history', 'career history', 'career',
    'experiencia', 'experiencia laboral', 'experiencia profesional', 'empleo',
    'historial laboral', 'trayectoria',
  ],
  education: [
    'education', 'academic background', 'academic', 'qualifications',
    'educación', 'educacion', 'formación', 'formacion', 'formación académica',
    'estudios', 'formación académica',
  ],
  skills: [
    'skills', 'technical skills', 'core skills', 'key skills', 'competencies',
    'core competencies', 'areas of expertise', 'technical expertise',
    'technologies', 'tech stack', 'expertise', 'tools', 'skills & tools',
    'habilidades', 'competencias', 'competencias clave', 'aptitudes',
    'conocimientos', 'tecnologías', 'áreas de experiencia',
  ],
  certifications: [
    'certifications', 'certificates', 'certification', 'courses',
    'courses & certifications', 'courses and certifications',
    'certifications & specialization', 'certifications specialization',
    'certifications and specialization', 'specialization', 'specializations',
    'licenses', 'licenses & certifications', 'licenses and certifications',
    'certificaciones', 'certificados', 'cursos', 'diplomados', 'especializaciones',
  ],
  languages: [
    'languages', 'language', 'idiomas', 'lenguajes',
  ],
};

// Build a lookup that, given a normalized heading line, returns its SectionKey.
// We also keep a space-stripped variant so letter-spaced headings that some
// templates use ("E X P E R I E N C E") still match.
const HEADING_LOOKUP = new Map<string, SectionKey>();
const HEADING_DESPACED = new Map<string, SectionKey>();
for (const [key, names] of Object.entries(SECTION_HEADINGS) as [SectionKey, string[]][]) {
  for (const n of names) {
    HEADING_LOOKUP.set(n, key);
    HEADING_DESPACED.set(n.replace(/\s+/g, ''), key);
  }
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const normalize = (s: string) =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();

const stripHeading = (line: string) =>
  normalize(line)
    .toLowerCase()
    .replace(/[:•\-–—|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Is this line a section heading? Returns the SectionKey or null. */
function headingKey(line: string): SectionKey | null {
  const raw = normalize(line);
  if (!raw || raw.length > 40) return null;         // headings are short
  const cleaned = stripHeading(raw);
  if (HEADING_LOOKUP.has(cleaned)) return HEADING_LOOKUP.get(cleaned)!;
  // Allow a heading with a trailing count or year, e.g. "EXPERIENCE (2020)".
  const firstWords = cleaned.split(' ').slice(0, 3).join(' ');
  if (HEADING_LOOKUP.has(firstWords)) return HEADING_LOOKUP.get(firstWords)!;
  // Letter-spaced heading, e.g. "E X P E R I E N C E" → "experience".
  const despaced = cleaned.replace(/\s+/g, '');
  if (HEADING_DESPACED.has(despaced)) return HEADING_DESPACED.get(despaced)!;
  return null;
}

// ─── Contact extractors (high reliability) ────────────────────────────────────

function extractEmail(text: string): string | null {
  const m = text.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}

function extractPhone(text: string): string | null {
  // Prefer numbers near a phone-ish label, else the first plausible sequence.
  const candidates = text.match(
    /(?:\+?\d[\d\s().\-]{7,}\d)/g,
  );
  if (!candidates) return null;
  // Filter out things that are clearly dates/years or too short once digits counted.
  const cleaned = candidates
    .map((c) => c.trim())
    .filter((c) => {
      const digits = c.replace(/\D/g, '');
      return digits.length >= 9 && digits.length <= 15;
    });
  return cleaned[0] || null;
}

function extractUrls(text: string): string[] {
  const urls = text.match(/\b(?:https?:\/\/|www\.)[^\s|,)]+/gi) || [];
  // Also catch bare linkedin.com/in/... without a scheme.
  const bare = text.match(/\b(?:linkedin\.com|github\.com|behance\.net|gitlab\.com)\/[^\s|,)]+/gi) || [];
  return [...new Set([...urls, ...bare].map((u) => u.replace(/[.,)]+$/, '')))];
}

function classifyUrls(urls: string[]): { linkedIn: string | null; portfolio: string | null } {
  let linkedIn: string | null = null;
  let portfolio: string | null = null;
  for (const u of urls) {
    const low = u.toLowerCase();
    if (!linkedIn && low.includes('linkedin.com')) linkedIn = u;
    else if (!portfolio && /(github|gitlab|behance|dribbble|portfolio|\.dev|\.me|\.io)/.test(low)) portfolio = u;
  }
  return { linkedIn, portfolio };
}

// ─── Name / headline (medium reliability) ─────────────────────────────────────

function looksLikeName(line: string): boolean {
  const t = normalize(line);
  if (!t || t.length > 50) return false;
  if (/[@\d]/.test(t)) return false;                       // no email/phone/digits
  if (/https?:|www\.|\.com/i.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 1 || words.length > 4) return false;
  // Mostly alphabetic, capitalized-ish words.
  const alpha = words.filter((w) => /^[A-Za-zÀ-ÿ'.\-]+$/.test(w));
  return alpha.length === words.length;
}

function splitName(name: string): { firstName: string | null; lastName: string | null } {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// ─── Skills / languages ───────────────────────────────────────────────────────

const KNOWN_LANGUAGES = [
  'english', 'spanish', 'portuguese', 'french', 'german', 'italian', 'mandarin',
  'chinese', 'japanese', 'korean', 'dutch', 'russian', 'arabic', 'hindi',
  'inglés', 'ingles', 'español', 'espanol', 'portugués', 'portugues', 'francés',
  'frances', 'alemán', 'aleman', 'italiano', 'mandarín', 'chino',
];

function splitList(lines: string[]): string[] {
  const joined = lines.join('\n');
  // Split on commas, bullets (incl. ● ▪ ◦ ‣ ○ ·), pipes, semicolons, slashes,
  // newlines and wide gaps (multi-column layouts).
  return [...new Set(
    joined
      .split(/[,•·●▪◦‣○|;\n]+|\s{3,}|\s\/\s/)
      .map((s) => normalize(s).replace(/^[-–—*•·●▪◦‣○\s]+/, '').replace(/[&+]$/, '').trim())
      .filter((s) => s.length >= 2 && s.length <= 40 && !/^(and|y|or|the)$/i.test(s)),
  )];
}

const LANG_CANONICAL: Record<string, string> = {
  'inglés': 'English', 'ingles': 'English',
  'español': 'Spanish', 'espanol': 'Spanish',
  'portugués': 'Portuguese', 'portugues': 'Portuguese',
  'francés': 'French', 'frances': 'French',
  'alemán': 'German', 'aleman': 'German',
  'italiano': 'Italian', 'mandarín': 'Mandarin', 'chino': 'Chinese',
};

// Proficiency vocabulary, ranked so that when a CV lists conflicting levels for
// the SAME language we keep one — the most specific / highest. (This is the fix
// for parsers that emit "English: Fluent" AND "English: B2" as two entries.)
const PROFICIENCY: Array<{ re: RegExp; label: string; rank: number }> = [
  { re: /\b(native|mother tongue|nativo|lengua materna)\b/i, label: 'Native', rank: 7 },
  { re: /\b(bilingual|bilingüe|bilingue)\b/i, label: 'Bilingual', rank: 7 },
  { re: /\bc2\b/i, label: 'C2', rank: 6 },
  { re: /\b(fluent|fluid|fluidez|fluido)\b/i, label: 'Fluent', rank: 5 },
  { re: /\bc1\b/i, label: 'C1', rank: 5 },
  { re: /\b(full professional|professional working|professional|proficient)\b/i, label: 'Professional', rank: 4 },
  { re: /\b(advanced|avanzado)\b/i, label: 'Advanced', rank: 4 },
  { re: /\bb2\b/i, label: 'B2', rank: 3 },
  { re: /\b(upper[- ]?intermediate)\b/i, label: 'Upper intermediate', rank: 3 },
  { re: /\bb1\b/i, label: 'B1', rank: 3 },
  { re: /\b(intermediate|intermedio|conversational|conversacional)\b/i, label: 'Intermediate', rank: 3 },
  { re: /\ba2\b/i, label: 'A2', rank: 2 },
  { re: /\ba1\b/i, label: 'A1', rank: 1 },
  { re: /\b(elementary|basic|básico|basico|beginner|principiante)\b/i, label: 'Basic', rank: 1 },
];

function detectProficiency(context: string): { label: string; rank: number } | null {
  for (const p of PROFICIENCY) if (p.re.test(context)) return { label: p.label, rank: p.rank };
  return null;
}

// One clean entry per language, with a single proficiency. Prefer the languages
// section (proficiency sits on the same line as the language); fall back to a
// full-text scan for names only.
function extractLanguages(sectionLines: string[] | undefined, fullText: string): ParsedLanguage[] {
  const best = new Map<string, { proficiency?: string; rank: number }>();

  const consider = (canonical: string, context: string) => {
    const prof = detectProficiency(context);
    const prev = best.get(canonical);
    if (!prev) best.set(canonical, { proficiency: prof?.label, rank: prof?.rank ?? 0 });
    else if (prof && prof.rank > prev.rank) best.set(canonical, { proficiency: prof.label, rank: prof.rank });
  };

  // Source lines: the dedicated section if any, plus any inline "Languages: …"
  // line elsewhere (some CVs list them under Skills, e.g. "Languages: Spanish
  // (Native), English (B1)"). Both carry same-line proficiency context.
  const contextLines = [...(sectionLines || [])];
  const inline = fullText.split('\n').filter((l) => /^\s*(languages|idiomas|lenguajes)\s*[:：]/i.test(l));
  contextLines.push(...inline);

  if (contextLines.length) {
    for (const line of contextLines) {
      // Find each language's position, then bind it to the proficiency in the
      // window from that language up to the next one — so "Spanish (Native),
      // English (B1)" gives Spanish→Native and English→B1, not both→Native.
      const hits: Array<{ canonical: string; idx: number }> = [];
      for (const lang of KNOWN_LANGUAGES) {
        const m = new RegExp(`\\b${lang}\\b`, 'i').exec(line);
        if (m) hits.push({ canonical: LANG_CANONICAL[lang] || (lang[0].toUpperCase() + lang.slice(1)), idx: m.index });
      }
      hits.sort((a, b) => a.idx - b.idx);
      for (let i = 0; i < hits.length; i++) {
        const end = i + 1 < hits.length ? hits[i + 1].idx : undefined;
        consider(hits[i].canonical, line.slice(hits[i].idx, end));
      }
    }
  } else {
    // No section and no inline line — names only, no reliable proficiency.
    for (const lang of KNOWN_LANGUAGES) {
      if (new RegExp(`\\b${lang}\\b`, 'i').test(fullText)) {
        consider(LANG_CANONICAL[lang] || (lang[0].toUpperCase() + lang.slice(1)), '');
      }
    }
  }
  return [...best.entries()].map(([language, v]) => ({ language, proficiency: v.proficiency }));
}

// ─── Dates / experience estimation ────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, ene: 1, enero: 1,
  feb: 2, february: 2, febrero: 2,
  mar: 3, march: 3, marzo: 3,
  apr: 4, april: 4, abr: 4, abril: 4,
  may: 5, mayo: 5,
  jun: 6, june: 6, junio: 6,
  jul: 7, july: 7, julio: 7,
  aug: 8, august: 8, ago: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, septiembre: 9,
  oct: 10, october: 10, octubre: 10,
  nov: 11, november: 11, noviembre: 11,
  dec: 12, december: 12, dic: 12, diciembre: 12,
};

const PRESENT_WORDS = 'present|current|ongoing|now|to date|actual|actualidad|presente|hoy';
const PRESENT = new RegExp(`\\b(${PRESENT_WORDS})\\b`, 'i');
// A single date, built from the known month vocabulary so an arbitrary word
// (e.g. "Colombia 2013") can't masquerade as "Month Year".
const MONTH_NAMES = Object.keys(MONTHS).join('|');
const YEAR = '(?:19|20)\\d{2}';
const ONE_DATE = `(?:(?:${MONTH_NAMES})\\.?\\s+)?${YEAR}|\\d{1,2}[\\/.]${YEAR}`;
const DATE_TOKEN = new RegExp(ONE_DATE, 'i');
// A date RANGE on one line: "<date> [-–—/ to/ a] <date|present>".
const DATE_RANGE = new RegExp(
  `(${ONE_DATE})\\s*(?:[-–—]|to|a)\\s*(${ONE_DATE}|${PRESENT_WORDS})`,
  'i',
);

function yearFrom(token: string): number | null {
  const m = token.match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
}

/** Rough total years of experience from the spread of work-history dates. */
function estimateExperienceYears(entries: ParsedWorkEntry[]): number | null {
  const years: number[] = [];
  let sawPresent = false;
  for (const e of entries) {
    if (e.from) { const y = yearFrom(e.from); if (y) years.push(y); }
    if (e.to) {
      if (PRESENT.test(e.to)) sawPresent = true;
      else { const y = yearFrom(e.to); if (y) years.push(y); }
    }
  }
  if (!years.length) return null;
  const min = Math.min(...years);
  const max = sawPresent ? new Date().getFullYear() : Math.max(...years);
  const span = max - min;
  return span > 0 && span < 60 ? span : null;
}

// ─── Section segmentation ─────────────────────────────────────────────────────

interface Segmented {
  header: string[];                       // lines before the first section
  sections: Partial<Record<SectionKey, string[]>>;
  order: string[];
}

function segment(lines: string[]): Segmented {
  const header: string[] = [];
  const sections: Partial<Record<SectionKey, string[]>> = {};
  const order: string[] = [];
  let current: SectionKey | null = null;
  let sawAnySection = false;

  for (const line of lines) {
    const key = headingKey(line);
    if (key) {
      current = key;
      sawAnySection = true;
      if (!sections[key]) { sections[key] = []; order.push(key); }
      continue;
    }
    if (!sawAnySection) header.push(line);
    else if (current) sections[current]!.push(line);
  }
  return { header, sections, order };
}

// ─── Work history (best-effort, layout-dependent) ─────────────────────────────

// A work-mode marker strongly signals a company/location header line.
const WORK_MODE = /\((?:on[- ]?site|remote|hybrid|presencial|remoto|h[íi]brido)\)/i;
const BULLET_LINE = /^\s*[●•·▪◦‣○*-]/;

// Does this line introduce an employer (company + location), as opposed to a
// specific role? Headers carry a work-mode tag or a "Company, City, Country"
// shape; role lines carry a "Title | dates" shape.
function isCompanyHeader(line: string): boolean {
  if (line.includes('|')) return false;                 // "Title | dates" is a role
  if (WORK_MODE.test(line)) return true;
  const noDates = line.replace(DATE_RANGE, '').trim();
  const commas = (noDates.match(/,/g) || []).length;
  return commas >= 2 && noDates.length <= 90;
}

function parseCompanyHeader(line: string): { company?: string; location?: string; from?: string; to?: string } {
  const range = line.match(DATE_RANGE);
  const from = range?.[1]?.trim();
  const to = range?.[2]?.trim();
  const clean = (s: string) => s.replace(WORK_MODE, '').replace(/\s{2,}/g, ' ').replace(/^[,\s|·]+|[,\s|·]+$/g, '').trim();

  // Dates in the MIDDLE ("Company  Jan2020-Mar2021  City, Country") — text
  // before the range is the company, text after is the location.
  if (range && range.index !== undefined) {
    const before = clean(line.slice(0, range.index));
    const after = clean(line.slice(range.index + range[0].length));
    if (after && /[a-zA-Z]/.test(after)) {
      const bparts = before.split(',').map((s) => s.trim()).filter(Boolean);
      return { company: bparts[0] || undefined, location: (bparts.slice(1).join(', ') || after) || undefined, from, to };
    }
    // Dates at the END — everything before them holds company + location.
    const parts = before.split(',').map((s) => s.trim()).filter(Boolean);
    return { company: parts[0] || undefined, location: parts.slice(1).join(', ') || undefined, from, to };
  }

  const parts = clean(line).split(',').map((s) => s.trim()).filter(Boolean);
  return { company: parts[0] || undefined, location: parts.slice(1).join(', ') || undefined, from, to };
}

// Does a standalone line look like a job title (vs a description sentence)?
function looksLikeTitle(line: string): boolean {
  const t = normalize(line);
  if (!t || t.length > 60) return false;
  if (/[.]$/.test(t)) return false;                     // descriptions end in a period
  if (/^[a-z]/.test(t)) return false;                   // titles are capitalized
  if (BULLET_LINE.test(t)) return false;
  return true;
}

// A "Company · Location" / "Company, Location" line that follows a title+dates
// line. Split off the company from the location.
function splitCompanyLocation(line: string): { company?: string; location?: string } {
  const t = normalize(line).replace(/[|·]/g, ',');
  const parts = t.split(',').map((s) => s.trim()).filter(Boolean);
  return { company: parts[0] || undefined, location: parts.slice(1).join(', ') || undefined };
}

// Parse the Experience section into one entry PER ROLE. Crucially, a promotion
// within the same employer (a company header followed by several dated roles)
// yields a separate entry for each role, all sharing the company + location —
// so career progression shows up instead of collapsing to one line.
function parseWorkHistory(lines: string[] | undefined): ParsedWorkEntry[] {
  if (!lines?.length) return [];
  const entries: ParsedWorkEntry[] = [];
  const clean = lines.map(normalize).filter(Boolean);

  let company: string | undefined;
  let location: string | undefined;
  let tenure: { from?: string; to?: string } | undefined; // company-level dates
  let rolesUnderCompany = 0;
  let lastTitle = '';                                    // a title-looking line seen, awaiting dates
  let awaitingCompany: ParsedWorkEntry | null = null;    // emitted role whose company sits below

  const flushEmptyCompany = () => {
    if (company && rolesUnderCompany === 0 && (tenure?.from || tenure?.to)) {
      entries.push({ company, location, from: tenure?.from, to: tenure?.to });
    }
  };

  for (const line of clean) {
    if (BULLET_LINE.test(line)) { awaitingCompany = null; lastTitle = ''; continue; }

    if (isCompanyHeader(line)) {
      flushEmptyCompany();
      const h = parseCompanyHeader(line);
      company = h.company; location = h.location; tenure = { from: h.from, to: h.to };
      rolesUnderCompany = 0;
      // Title sat on the line ABOVE the company+dates line (e.g. "SUPERVISOR" \n
      // "Acme  Jan–Mar  City"). Emit it as a role now.
      if ((h.from || h.to) && lastTitle) {
        entries.push({ title: lastTitle, company, location, from: h.from, to: h.to });
        rolesUnderCompany++;
      }
      lastTitle = '';
      awaitingCompany = null;
      continue;
    }

    const range = line.match(DATE_RANGE);
    if (range && range.index !== undefined) {
      let pre = line.slice(0, range.index).replace(/[|–—\-·•]+\s*$/, '').trim();
      if (!pre) pre = line.slice(range.index + range[0].length).replace(/^[|–—\-·•\s]+/, '').trim();

      const entry: ParsedWorkEntry = { from: range[1]?.trim(), to: range[2]?.trim() };
      if (company) {
        entry.title = pre || lastTitle || undefined;    // role under current employer
        entry.company = company; entry.location = location;
        rolesUnderCompany++;
      } else if (pre && /\s(?:@|at|en|[-–—|·])\s/.test(pre)) {
        const [t, c] = splitTitleCompany(pre, '');
        entry.title = t || undefined; entry.company = c || undefined;
      } else {
        entry.title = pre || lastTitle || undefined;    // company may follow below
        awaitingCompany = entry;
      }
      entries.push(entry);
      lastTitle = '';
      continue;
    }

    // A plain line: fill a pending company (title+dates were above), else it may
    // be a title whose dates are on the next line.
    if (awaitingCompany && looksLikeTitle(line)) {
      const cl = splitCompanyLocation(line);
      awaitingCompany.company = cl.company; awaitingCompany.location = cl.location;
      awaitingCompany = null;
    } else if (looksLikeTitle(line)) {
      lastTitle = line;
    } else {
      awaitingCompany = null;
    }
  }
  flushEmptyCompany();
  return entries;
}

// Split a "Title @ Company" / "Title - Company" / "Title, Company" blob.
function splitTitleCompany(blob: string, fallbackAbove: string): [string | null, string | null] {
  if (!blob) return [null, fallbackAbove || null];
  const sep = blob.match(/\s+(?:@|at|en|[-–—|·•])\s+/);
  if (sep && sep.index !== undefined) {
    const title = blob.slice(0, sep.index).trim();
    const company = blob.slice(sep.index + sep[0].length).trim();
    return [title || null, company || null];
  }
  return [blob.trim() || null, fallbackAbove || null];
}

// ─── Education (best-effort) ──────────────────────────────────────────────────

const DEGREE_HINTS = /\b(b\.?sc|m\.?sc|ph\.?d|bachelor|master|mba|licenciatura|ingenier[oaí]|técnic[oa]|tecnólog[oa]|tecnolog[oa]|diploma|degree|associate|maestría|doctorado|pregrado|posgrado|especializaci[oó]n)\b/i;
// Only lines naming a real institution OR a degree count as education — this
// keeps short online courses / certificates from flooding the education list.
const INSTITUTION_HINTS = /\b(university|universidad|college|institute|instituto|school|escuela|academy|academia|polytechnic|polit[eé]cnic|faculty|facultad|SENA|colegio)\b/i;

// A date at the end of a line, e.g. "Aug 2018" or "2024".
const DATE_AT_END = new RegExp(`(${ONE_DATE})\\s*$`, 'i');
const endsWithColon = (l: string) => /:\s*$/.test(l);
const isJunkLine = (l: string) => /^(?:mailto:|https?:\/\/|www\.)/i.test(l);
// Ends in a recognizable place — used to tell "Institution, City, Country" apart
// from a comma-heavy skills list ("Slack, Notion, Persona, ComplyAdvantage").
const GEO_TAIL = /\b(colombia|venezuela|united states|u\.?s\.?a?\.?|mexico|méxico|spain|españa|argentina|per[uú]|chile|ecuador|brazil|brasil|canada|canadá|panama|panamá|remote)\s*$/i;
// A "School / University, City, Country" style line — names a place, not a degree.
const isInstitutionLine = (l: string) =>
  INSTITUTION_HINTS.test(l) || ((l.match(/,/g) || []).length >= 2 && GEO_TAIL.test(l));
// A degree/program is a short phrase, not a description sentence.
const looksLikeDegree = (l: string) => l.length <= 70 && !/[.]$/.test(l);

function parseEducation(lines: string[] | undefined): ParsedEducationEntry[] {
  if (!lines?.length) return [];
  const entries: ParsedEducationEntry[] = [];
  const clean = lines.map(normalize).filter(Boolean);

  for (let i = 0; i < clean.length; i++) {
    const line = clean[i];
    if (endsWithColon(line) || isJunkLine(line)) continue;   // sub-heading / link
    const hasDegree = DEGREE_HINTS.test(line);
    const isInst = isInstitutionLine(line);
    // Gate: must name a degree or an institution — keeps stray lines out.
    if (!hasDegree && !isInst) continue;

    const dateM = line.match(DATE_AT_END);
    const dateStr = dateM ? dateM[1].trim() : undefined;
    const body = line.replace(DATE_AT_END, '').replace(/[,\s|·]+$/, '').trim();

    if (isInst && !hasDegree) {
      // Institution header: "Institution, City, Country". The degree/program
      // usually sits on the next plain line ("Aircraft Mechanic/Maintenance").
      const parts = body.split(',').map((s) => s.trim()).filter(Boolean);
      const institution = parts[0] || undefined;
      const location = parts.slice(1).join(', ') || undefined;
      let degree: string | undefined;
      const next = clean[i + 1];
      if (next && !endsWithColon(next) && !isInstitutionLine(next) && !isJunkLine(next) && looksLikeDegree(next)) {
        degree = next.replace(DATE_AT_END, '').replace(/^[-–—*•●\s]+/, '').trim() || undefined;
        i++;                                                 // consume the degree line
      }
      entries.push({ institution, location, degree, to: dateStr });
    } else {
      // A degree line. Split an inline "Degree - Institution" if present.
      const sep = body.match(/\s+(?:[-–—|·]|at|en|from)\s+/i);
      let degree: string | undefined = body;
      let institution: string | undefined;
      if (sep && sep.index !== undefined) {
        const a = body.slice(0, sep.index).trim();
        const b = body.slice(sep.index + sep[0].length).trim();
        if (DEGREE_HINTS.test(b) && !DEGREE_HINTS.test(a)) { degree = b; institution = a; }
        else { degree = a; institution = b; }
      }
      entries.push({ degree: degree || undefined, institution });
      if (dateStr) entries[entries.length - 1].to = dateStr;
    }
  }
  return entries.filter((e, idx, arr) =>
    idx === arr.findIndex((x) => x.degree === e.degree && x.institution === e.institution && x.to === e.to));
}

// ─── Certifications ───────────────────────────────────────────────────────────

function parseCertifications(lines: string[] | undefined): ParsedCertification[] {
  if (!lines?.length) return [];
  const clean = lines.map(normalize).filter(Boolean);
  const certs: ParsedCertification[] = [];
  let issuer: string | undefined;      // provider header ("Coursera, United States")
  let issuerDate: string | undefined;  // date carried on the issuer line, if any

  for (const line of clean) {
    if (endsWithColon(line) || isJunkLine(line)) continue;   // category sub-heading / link
    const dateM = line.match(DATE_AT_END);
    const dateStr = dateM ? dateM[1].trim() : undefined;

    // A comma-bearing line names a provider + location — it's an issuer header,
    // and the certs beneath it inherit that provider.
    if (line.includes(',')) {
      const body = line.replace(DATE_AT_END, '').replace(/[,\s]+$/, '').trim();
      issuer = body.split(',')[0].trim() || undefined;
      issuerDate = dateStr;
      continue;
    }

    const name = line.replace(DATE_AT_END, '').replace(/^[-–—*•●\s]+/, '').trim();
    if (name.length > 2 && !isJunkLine(name)) {
      certs.push({ name, issuer, date: dateStr || issuerDate });
    }
  }
  return certs;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function parseCV(rawText: string): ParsedCV {
  const warnings: string[] = [];
  const text = rawText.replace(/\r/g, '');
  const lines = text.split('\n').map((l) => l.replace(/\t/g, ' ').trimEnd());
  const nonEmpty = lines.filter((l) => l.trim().length > 0);

  // Contact
  const email = extractEmail(text);
  const phone = extractPhone(text);
  const urls = extractUrls(text);
  const { linkedIn, portfolio } = classifyUrls(urls);

  // Name + headline from the top of the document
  let name: string | null = null;
  let headline: string | null = null;
  for (const l of nonEmpty.slice(0, 8)) {
    if (headingKey(l)) break;                                // reached a section — stop
    if (!name && looksLikeName(l)) { name = normalize(l); continue; }
    if (name && !headline) {
      const t = normalize(l);
      const isUrlish = /[@/]|https?:|www\.|\.(com|net|org|io|co|dev|me|ai)\b|github|linkedin/i.test(t);
      if (t && !isUrlish && t.length <= 60) { headline = t; break; }
    }
  }
  // Fallback: derive a name from the email local-part if nothing matched.
  if (!name && email) {
    const local = email.split('@')[0].replace(/[._\d]+/g, ' ').trim();
    if (local && /^[a-z ]+$/i.test(local)) name = local.replace(/\b\w/g, (c) => c.toUpperCase());
    if (name) warnings.push('Name guessed from email — verify.');
  }
  if (!name) warnings.push('Could not detect a name.');
  const { firstName, lastName } = name ? splitName(name) : { firstName: null, lastName: null };

  // Sections
  const { sections, order } = segment(lines);
  const sectionsFound = order;

  const skills = sections.skills ? splitList(sections.skills) : [];
  if (!skills.length) warnings.push('No skills section detected.');

  const languages = extractLanguages(sections.languages, text);
  // Nearwork working rule: assume English B2 until the CV states a level or the
  // candidate completes the assessment. Flag it so the recruiter knows it's a
  // default, not something read off the CV.
  const eng = languages.find((l) => l.language === 'English');
  if (!eng) { languages.push({ language: 'English', proficiency: 'B2' }); warnings.push('English defaulted to B2 (not stated on CV).'); }
  else if (!eng.proficiency) { eng.proficiency = 'B2'; warnings.push('English level defaulted to B2 (not stated on CV).'); }

  const workHistory = parseWorkHistory(sections.experience);
  if (sections.experience && !workHistory.length) warnings.push('Experience section found but no entries parsed.');
  const education = parseEducation(sections.education);
  const certifications = parseCertifications(sections.certifications);
  const experienceYears = estimateExperienceYears(workHistory);

  const summary = sections.summary
    ? normalize(sections.summary.join(' ')).slice(0, 1200) || null
    : null;

  // Location — look for a City, Country pattern in the header region.
  let location: string | null = null;
  const headerBlob = nonEmpty.slice(0, 8).join('  ');
  const locM = headerBlob.match(/([A-ZÁÉÍÓÚÑ][a-zá-ÿ.]+(?:\s[A-ZÁÉÍÓÚÑ][a-zá-ÿ.]+)*),\s*([A-ZÁÉÍÓÚÑ][a-zá-ÿ.]+(?:\s[A-ZÁÉÍÓÚÑ][a-zá-ÿ.]+)*)/);
  if (locM && !locM[0].includes('@')) location = normalize(locM[0]);
  // Fallback: many CVs put the city under each role, not in the header — use
  // the most recent job's location.
  if (!location && workHistory[0]?.location) location = workHistory[0].location;

  // Diagnostics: surface any section text we recognized but didn't fully use.
  const unparsedSections: Record<string, string> = {};
  if (sections.experience && !workHistory.length) unparsedSections.experience = sections.experience.join('\n');
  if (sections.education && !education.length) unparsedSections.education = sections.education.join('\n');

  return {
    name, firstName, lastName, email, phone, location, linkedIn, portfolio,
    headline, summary, skills, languages, workHistory, education, certifications,
    experienceYears,
    _meta: { sectionsFound, warnings, unparsedSections },
  };
}
