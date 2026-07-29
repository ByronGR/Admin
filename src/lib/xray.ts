// Server-only X-ray sourcing engine — ported from the standalone nearwork-xray-sourcing
// service. Builds LinkedIn X-ray queries, runs them via Serper (or Google CSE),
// geo-locks to selected country subdomains, dedupes, and drops founders/offshore.
// Never import this into client code — it reads API keys from the environment.

const COUNTRIES: Record<string, string> = {
  co: 'Colombia', ar: 'Argentina', pe: 'Peru', cl: 'Chile', ve: 'Venezuela',
  ec: 'Ecuador', uy: 'Uruguay', bo: 'Bolivia', py: 'Paraguay', mx: 'Mexico',
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

export function buildQueriesFromPhrases(phrases: string[], codes: string[]) {
  const site = '(' + codes.filter(c => COUNTRIES[c]).map(c => `site:${c}.linkedin.com/in`).join(' OR ') + ')';
  return phrases.map(p => `${site} ${p}`);
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

// Claude Haiku writes the search phrases from the job post. Cached per opening upstream.
export async function writePlan(apiKey: string, jd: string): Promise<{ phrases: string[] | null; error?: string }> {
  const system = `You write short LinkedIn X-ray search phrases to source candidates. Read the JOB POST and output JSON ONLY: {"phrases":[6 short search phrases]}. Each phrase is just role-title and/or skill keywords (mix title-based and skill-based; include a Spanish title variant). Do NOT add site:, country, or location — handled separately. Realistic to how people write LinkedIn profiles.`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 700, system, messages: [{ role: 'user', content: jd }] }),
    });
    const g = await res.json();
    if (g.error) return { phrases: null, error: g.error.message };
    const text = (g.content || []).map((b: { text?: string }) => b.text || '').join('').replace(/```json|```/g, '').trim();
    const phrases = JSON.parse(text).phrases;
    if (!Array.isArray(phrases) || !phrases.length) return { phrases: null, error: 'plan parse failed' };
    return { phrases };
  } catch (e) { return { phrases: null, error: (e as Error).message }; }
}

export type XrayResult = {
  name: string; li: string; linkedin: string; location: string; country: string;
};

// Parse raw search results → net-new candidates, applying geo-lock, dedup and exclusions.
export function filterResults(
  rawItems: RawItem[],
  { codes, pulled, excludeOwners }: { codes: string[]; pulled: Set<string>; excludeOwners: boolean }
): { candidates: XrayResult[]; stats: { found: number; net_new: number; skipped_existing: number; dropped_geo: number; dropped_owner: number; dropped_offshore: number; dropped_internal: number } } {
  const codeSet = new Set(codes);
  const candidates: XrayResult[] = [];
  let dupExisting = 0, droppedGeo = 0, droppedOwner = 0, droppedOffshore = 0, droppedInternal = 0;
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
  return { candidates, stats: { found: rawItems.length, net_new: candidates.length, skipped_existing: dupExisting, dropped_geo: droppedGeo, dropped_owner: droppedOwner, dropped_offshore: droppedOffshore, dropped_internal: droppedInternal } };
}

export const XRAY_COUNTRY_CODES = Object.keys(COUNTRIES);
