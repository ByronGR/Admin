// Server-only X-ray sourcing engine — ported from the standalone nearwork-xray-sourcing
// service. Builds LinkedIn X-ray queries, runs them via Serper (or Google CSE),
// geo-locks to selected country subdomains, dedupes, and drops founders/offshore.
// Never import this into client code — it reads API keys from the environment.

const COUNTRIES: Record<string, string> = {
  co: 'Colombia', ar: 'Argentina', pe: 'Peru', cl: 'Chile', ve: 'Venezuela',
  ec: 'Ecuador', uy: 'Uruguay', bo: 'Bolivia', py: 'Paraguay', mx: 'Mexico',
  // Brazil is Portuguese-speaking, so it sits outside the Spanish-speaking
  // default set and is opted into per search rather than always on.
  br: 'Brazil',
};

const SUBDOMAIN_COUNTRY: Record<string, string> = {
  co: 'Colombia', ar: 'Argentina', mx: 'Mexico', pe: 'Peru', ve: 'Venezuela',
  cl: 'Chile', ec: 'Ecuador', uy: 'Uruguay', br: 'Brazil', do: 'Dominican Republic',
  gt: 'Guatemala', cr: 'Costa Rica', pa: 'Panama', bo: 'Bolivia', py: 'Paraguay',
  hn: 'Honduras', ni: 'Nicaragua', sv: 'El Salvador',
};

const CITY_HINTS: Record<string, string> = {
  Bogota: 'Colombia', 'Bogotá': 'Colombia', Medellin: 'Colombia', 'Medellín': 'Colombia',
  Cali: 'Colombia', Barranquilla: 'Colombia', Bucaramanga: 'Colombia', Cartagena: 'Colombia',
  'Buenos Aires': 'Argentina', Cordoba: 'Argentina', Rosario: 'Argentina',
  Lima: 'Peru', Caracas: 'Venezuela', Maracaibo: 'Venezuela', Valencia: 'Venezuela',
  Santiago: 'Chile', Quito: 'Ecuador', Guayaquil: 'Ecuador', Cancun: 'Mexico', 'Cancún': 'Mexico',
  'Mexico City': 'Mexico', Guadalajara: 'Mexico', Monterrey: 'Mexico', Montevideo: 'Uruguay',
  'Sao Paulo': 'Brazil', 'São Paulo': 'Brazil', 'Rio de Janeiro': 'Brazil',
  'Belo Horizonte': 'Brazil', Brasilia: 'Brazil', 'Brasília': 'Brazil',
  Curitiba: 'Brazil', 'Porto Alegre': 'Brazil', Recife: 'Brazil', Fortaleza: 'Brazil',
};

const EXCLUDE_OWNER = /(\bfounder\b|\bco-?founder\b|\bceo\b|\bc\.e\.o\b|\bowner\b|\bco-?owner\b|\bpropietari[oa]\b|\bdue[ñn][oa]\b|\bfundador[a]?\b|\bcofundador[a]?\b|\bpresidente\b|\bchief executive\b|\bmanaging director\b|\bself-employed\b)/i;
const NON_LATAM_LOC = /(\bspain\b|\bespa[ñn]a\b|\bbarcelona\b|\bmadrid\b|\bsevilla\b|\bbilbao\b|\bunited states\b|\bu\.?s\.?a\b|\bmiami\b|\bnew york\b|\blos angeles\b|\bsan francisco\b|\blondon\b|\bunited kingdom\b|\bcanada\b|\btoronto\b|\bportugal\b|\blisbon\b|\bgermany\b|\bberlin\b|\bfrance\b|\bparis\b|\bitaly\b|\baustralia\b|metropolitan area)/i;

// Never source Nearwork's own team — they sit on LATAM subdomains and match
// marketing/account keywords (Nearwork is a staffing/marketing company), so they
// slip past the founder filter when their result title doesn't say "CEO/Founder".
const NEARWORK_SELF = /\bnearwork\b/i;

// FreshPrints master-list snapshot — candidates already sourced, always deduped out.
const EXISTING_RAW = [
  'simon-gomez-palacio-9944a9143', 'ivanna-z-923122114', 'alejandra-garcía-rosales', 'harol-alvear',
  'cikeilycabrera', 'maria-eugenia-natera', 'aarón-lópez-170580170', 'yolizmar-del-valle-paredes-muñoz-447ab2123',
  'maria-camila-carvajal-londoño-aa877b115', 'laura-cabal', 'luisfearango', 'mandreajimenezp',
  'nicolas-henao-437912235', 'karen-barrera-734a9523a', 'manuela-gómez-31267b1ba', 'alexandrarodriguezpuentes',
  'catalina-reyes-osorio', 'catalina-garcia-9b5501247', 'luisa-gómez-68b6171a1', 'mariapcohen24',
  'jhonny-arzuza-a715a51a4', 'mauricio-digitalmarketing', 'bensmithmac', 'danielfelipeor', 'anampedrazac',
  'evertmorales', 'vivian-andrea-rozo', 'soydiegorojasc', 'karen-arboleda-a40b48218', 'jonathantoledosalamanca',
  'camilo-herrera-b76588197', 'hernán-petit-bernal-32551a238', 'gabriela-valderrama-86765b228',
  'davidvargasescobar', 'susyvelasq', 'miguelzuluagas', 'marianatorresparra-marketingydiseño',
  'nathalia-sepulveda-triana', 'juan-zea-68394320b', 'miguel-caballero-a79bba338', 'mariauehara',
  'castillotomas1', 'paloma-rosas-9300312a0', 'ana-maría-corredor-penagos-525626287', 'paula-botero-679567225',
  'sebastianfleiva', 'maria-camila-forero-gómez-bb1389128', 'susanne-pachas', 'milagros-villalba-hachard',
  'juandpineda28', 'claragiacchino', 'patriciagonzalezpaublini', 'andrea-serna-marketing-director', 'beafaundes',
  'paula-andrea-gomez-posso-marketing', 'patricia-fliguer-30a475', 'lauraaporrasv', 'linamvargasc',
  'juan-barreto-4a5039311', 'camiloarroyave-growthmarketing', 'daniela-puentes-cuellar-5131a625a',
  'juan-daniel-contreras', 'diego-granada-dem-gen-marketing', 'amap', 'ana-quintero-7b0b061a4',
  'valentina-vasquez-ruidiaz', 'carlos-daniel-chacón-0295951b6', 'javiro04', 'justfp', 'sergioepl',
  'tatiana-garcia-posada', 'tatiana-osorio-ospina-420999243', 'mariana-zapatam', 'camila-gallop',
  'catalina-dugand-senior', 'isabella-vélez-salebe-826b6a24b', 'mauricio-peña-ramírez-03526959', 'erikfcortes',
  'singhsuraj1', 'joseapintog', 'jeanse95br', 'nataliaramirezcastillo', 'facundo-zocola-2a575012',
  'jocelyn-arrieta-rojas', 'vivihernandezf', 'melissa-castro-diaz', 'analifecyclemarketing', 'elossada', 'mariangelicarodr',
];

function stripAccents(s: string) { return s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }
export function normSlug(s: string) {
  try { s = decodeURIComponent(s); } catch { /* noop */ }
  return stripAccents(s).toLowerCase().replace(/\/+$/, '').trim();
}
const EXISTING = new Set(EXISTING_RAW.map(normSlug));

// Known Nearwork-team LinkedIn slugs — always dropped (belt-and-suspenders with NEARWORK_SELF).
const SELF_EXCLUDE = new Set(['byron-giraldo-30513b215'].map(normSlug));

function cleanName(title: string) {
  if (!title) return '';
  return title.split('|')[0].split(' - ')[0].split(' – ')[0].trim();
}

/** Accepts an array or a comma-separated string, as the brain's runSearch does. */
export function normKw(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

// One query per phrase, scoped to the selected country subdomains, with any
// exclude keywords appended as Google negatives. Excludes are ALSO post-filtered
// in filterResults — the negative alone isn't reliable, since the term can sit
// in profile text Google didn't index as a match.
export function buildQueriesFromPhrases(phrases: string[], codes: string[], excludeKeywords: string[] = []) {
  const site = '(' + codes.filter(c => COUNTRIES[c]).map(c => `site:${c}.linkedin.com/in`).join(' OR ') + ')';
  const neg = excludeKeywords.map((k) => ` -"${k}"`).join('');
  return phrases.map(p => `${site} ${p}${neg}`);
}

type RawItem = { title?: string; link?: string; snippet?: string };

export async function serperSearch(apiKey: string, query: string, opts: { english?: boolean; page?: number } = {}): Promise<{ items: RawItem[]; error?: string }> {
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 10, page: opts.page || 1, ...(opts.english ? { hl: 'en' } : {}) }),
    });
    const json = await res.json();
    if (json.message || res.status >= 400) return { items: [], error: json.message || `Serper error ${res.status}` };
    return { items: (json.organic || []).map((o: { title: string; link: string; snippet: string }) => ({ title: o.title, link: o.link, snippet: o.snippet })) };
  } catch (e) { return { items: [], error: (e as Error).message }; }
}

export async function googleSearch(apiKey: string, cx: string, query: string, opts: { english?: boolean } = {}): Promise<{ items: RawItem[]; error?: string }> {
  try {
    const u = new URL('https://www.googleapis.com/customsearch/v1');
    u.searchParams.set('key', apiKey); u.searchParams.set('cx', cx); u.searchParams.set('q', query); u.searchParams.set('num', '10');
    if (opts.english) u.searchParams.set('lr', 'lang_en');
    const res = await fetch(u.toString());
    const json = await res.json();
    if (json.error) return { items: [], error: json.error.message || 'Google API error' };
    return { items: json.items || [] };
  } catch (e) { return { items: [], error: (e as Error).message }; }
}

// Claude Haiku reads the job post and writes the search plan: the role's DOMAIN,
// real-world equivalent titles (aliases), and 6 domain-anchored X-ray phrases.
// Domain-anchoring matters because an X-ray only sees a headline + one-line
// snippet, so a bare generic title ("Account Manager") drags in the wrong field.
export async function writePlan(apiKey: string, jd: string): Promise<{ phrases: string[] | null; aliases?: string[]; domain?: string; error?: string }> {
  const system = `You are a technical sourcer building LinkedIn X-ray searches. CRITICAL: an X-ray search only sees a person's HEADLINE + a one-line snippet — never the full profile — so a generic title like "Customer Success Manager", "Account Manager", or "Project Manager" is AMBIGUOUS (could be operations, sales, support, anything) and will drag in the wrong people.
Do this:
1) From the JOB POST, identify the role's DOMAIN/field (e.g. marketing, operations, engineering, finance).
2) Work out the real-world equivalent titles (aliases), reasoning from the RESPONSIBILITIES not the literal title (e.g. an "Account Manager - Marketing" doing account-based marketing is really "ABM Manager" / "Growth Marketing Manager", NOT an operations account manager).
3) Build 6 search phrases. HARD RULE: if the domain is a specific field like marketing, EVERY phrase MUST be anchored to that domain — it must contain the domain word (e.g. "marketing") OR a domain-specific skill/tool/method (e.g. ABM, growth marketing, demand generation, Klaviyo, campaigns, SEO). NEVER emit a bare generic title with no domain signal. Only if the domain is broad/operational and the titles are already unambiguous may you skip the anchor.
Output JSON ONLY: {"domain":"<field>", "aliases":[equivalent titles, best first], "phrases":[6 domain-anchored phrases; include one Spanish variant]}. Phrases = role-title and/or skill keywords only; NO site:, country, or location. Realistic to how people write LinkedIn profiles.`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 900, system, messages: [{ role: 'user', content: jd }] }),
    });
    const g = await res.json();
    if (g.error) return { phrases: null, error: g.error.message };
    const text = (g.content || []).map((b: { text?: string }) => b.text || '').join('').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.phrases) || !parsed.phrases.length) return { phrases: null, error: 'plan parse failed' };
    return { phrases: parsed.phrases, aliases: Array.isArray(parsed.aliases) ? parsed.aliases : [], domain: typeof parsed.domain === 'string' ? parsed.domain : '' };
  } catch (e) { return { phrases: null, error: (e as Error).message }; }
}

export type XrayResult = {
  name: string; li: string; linkedin: string; location: string; country: string;
};

// Parse raw search results → net-new candidates, applying geo-lock, dedup and exclusions.
export function filterResults(
  rawItems: RawItem[],
  { codes, pulled, excludeOwners, excludeKeywords = [] }: { codes: string[]; pulled: Set<string>; excludeOwners: boolean; excludeKeywords?: string[] }
): { candidates: XrayResult[]; stats: { found: number; net_new: number; skipped_existing: number; dropped_geo: number; dropped_owner: number; dropped_offshore: number; dropped_internal: number; dropped_excluded: number } } {
  const codeSet = new Set(codes);
  const candidates: XrayResult[] = [];
  const exc = excludeKeywords.map((k) => k.toLowerCase());
  let dupExisting = 0, droppedGeo = 0, droppedOwner = 0, droppedOffshore = 0, droppedInternal = 0, droppedExcluded = 0;
  for (const it of rawItems) {
    const host = (() => { try { return new URL(it.link || '').host; } catch { return ''; } })();
    const sub = host.split('.')[0];
    if (!codeSet.has(sub)) { droppedGeo++; continue; }
    const m = /linkedin\.com\/in\/([^/?#]+)/i.exec(it.link || '');
    if (!m) continue;
    const slug = normSlug(m[1]);
    if (EXISTING.has(slug)) { dupExisting++; continue; }
    if (pulled.has(slug)) continue;
    const text = (it.title || '') + ' ' + (it.snippet || '');
    if (SELF_EXCLUDE.has(slug) || NEARWORK_SELF.test(text)) { droppedInternal++; continue; }  // never source our own team
    if (excludeOwners && EXCLUDE_OWNER.test(it.title || '')) { droppedOwner++; continue; }
    if (NON_LATAM_LOC.test(text)) { droppedOffshore++; continue; }
    // Post-filter the excludes: the Google negative catches most of them, but a
    // term can still sit in text the query didn't match on.
    if (exc.length && exc.some((k) => text.toLowerCase().includes(k))) { droppedExcluded++; continue; }
    pulled.add(slug);
    const country = SUBDOMAIN_COUNTRY[sub] || COUNTRIES[sub] || '';
    let loc = country;
    for (const [city, c] of Object.entries(CITY_HINTS)) {
      if (c === country && new RegExp('\\b' + city + '\\b', 'i').test(text)) { loc = city + ', ' + country; break; }
    }
    candidates.push({
      name: cleanName(it.title || ''),
      li: '/in/' + m[1].replace(/\/+$/, ''),
      linkedin: 'https://www.linkedin.com/in/' + m[1].replace(/\/+$/, ''),
      location: loc, country,
    });
  }
  return { candidates, stats: { found: rawItems.length, net_new: candidates.length, skipped_existing: dupExisting, dropped_geo: droppedGeo, dropped_owner: droppedOwner, dropped_offshore: droppedOffshore, dropped_internal: droppedInternal, dropped_excluded: droppedExcluded } };
}

export const XRAY_COUNTRY_CODES = Object.keys(COUNTRIES);

/** Country codes → display names, for the search-run audit record. */
export function countryNames(codes: string[]): string[] {
  return codes.map((c) => COUNTRIES[c]).filter(Boolean);
}
