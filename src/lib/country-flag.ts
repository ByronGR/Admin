// ── Country flags ────────────────────────────────────────────────────────────
// Emoji flags, built from the ISO-3166 alpha-2 code by offsetting each letter
// into the Unicode regional-indicator block. No images, no network, no licence
// — the font already has them.
//
// Candidate records store the country inconsistently: the CV parser writes an
// ISO-2 code into `locationCountry`, sourced candidates carry a full country
// name, and some rows only have a "City, Country" string. All three resolve
// here, because a flag that silently fails to appear for half the database is
// worse than no flag at all.

/** Full names → ISO-2, for the countries Nearwork actually places from. */
const NAME_TO_CODE: Record<string, string> = {
  colombia: 'CO', argentina: 'AR', peru: 'PE', chile: 'CL', venezuela: 'VE',
  ecuador: 'EC', uruguay: 'UY', bolivia: 'BO', paraguay: 'PY', mexico: 'MX',
  brazil: 'BR', brasil: 'BR', 'costa rica': 'CR', panama: 'PA', 'panamá': 'PA',
  guatemala: 'GT', honduras: 'HN', nicaragua: 'NI', 'el salvador': 'SV',
  'dominican republic': 'DO', 'república dominicana': 'DO',
  'puerto rico': 'PR', cuba: 'CU', haiti: 'HT', belize: 'BZ',
  // Occasionally seen on CVs of people who have moved back.
  spain: 'ES', 'españa': 'ES', 'united states': 'US', usa: 'US', canada: 'CA',
  'united kingdom': 'GB', portugal: 'PT', india: 'IN', nigeria: 'NG',
};

const strip = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** ISO-2 code for whatever the record happens to hold, or '' if unknown. */
export function countryCode(input?: {
  locationCountry?: string; country?: string; location?: string; city?: string;
} | string | null): string {
  if (!input) return '';
  const parts = typeof input === 'string'
    ? [input]
    : [input.locationCountry, input.country, input.location, input.city];

  for (const raw of parts) {
    const v = (raw || '').trim();
    if (!v) continue;
    // Already a code.
    if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
    // The tail of "Bogotá, Colombia" or "Ibagué, CO" — the latter is what the
    // CV parser actually writes, so a whole-string code test alone misses it.
    const rawTail = (v.split(',').pop() || '').trim();
    if (/^[A-Za-z]{2}$/.test(rawTail)) return rawTail.toUpperCase();
    const tail = strip(rawTail);
    if (NAME_TO_CODE[tail]) return NAME_TO_CODE[tail];
    // Or named anywhere in the string.
    const whole = strip(v);
    for (const [name, code] of Object.entries(NAME_TO_CODE)) {
      if (whole.includes(name)) return code;
    }
  }
  return '';
}

/** The flag emoji for an ISO-2 code, or '' when it isn't a real code. */
export function flagEmoji(code: string): string {
  const c = (code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** Convenience: record → flag emoji, '' when the country can't be resolved. */
export function countryFlag(input?: Parameters<typeof countryCode>[0]): string {
  return flagEmoji(countryCode(input));
}
