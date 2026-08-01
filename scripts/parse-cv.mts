// ── CV parser test harness (local only) ──────────────────────────────────────
// Run the CV parser against real files without deploying, so we can tune the
// extraction rules by feeding lots of CVs. Never touches Firestore or the API.
//
//   npm run parse-cv -- path/to/cv.pdf                 # one file, pretty output
//   npm run parse-cv -- path/to/cv.docx --json         # raw JSON only
//   npm run parse-cv -- tmp/cvs                         # every CV in a folder
//
// Drop sample CVs in ~/Developer/Admin/tmp/cvs (git-ignored) and point at them.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { detectKind, extractCVText } from '../src/lib/cv-extract-text.ts';
import { parseCV, type ParsedCV } from '../src/lib/cv-parser.ts';

const args = process.argv.slice(2);
const jsonOnly = args.includes('--json');
const target = args.find((a) => !a.startsWith('--'));

if (!target) {
  console.error('Usage: npm run parse-cv -- <file-or-folder> [--json]');
  process.exit(1);
}

async function collectFiles(path: string): Promise<string[]> {
  const s = await stat(path);
  if (s.isFile()) return [path];
  const names = await readdir(path);
  return names
    .filter((n) => ['.pdf', '.docx'].includes(extname(n).toLowerCase()))
    .map((n) => join(path, n));
}

function line(label: string, value: unknown) {
  const v = Array.isArray(value)
    ? (value.length ? value.join(', ') : '—')
    : (value ?? '—');
  console.log(`  ${label.padEnd(14)} ${v}`);
}

function pretty(file: string, p: ParsedCV) {
  console.log(`\n━━━ ${basename(file)} ━━━`);
  line('Name', p.name);
  line('Email', p.email);
  line('Phone', p.phone);
  line('Location', p.location);
  line('LinkedIn', p.linkedIn);
  line('Portfolio', p.portfolio);
  line('Headline', p.headline);
  line('Exp (yrs)', p.experienceYears);
  line('Languages', p.languages.map((l) => l.proficiency ? `${l.language} (${l.proficiency})` : l.language));
  line('Skills', p.skills.length ? `${p.skills.length}: ${p.skills.slice(0, 12).join(', ')}${p.skills.length > 12 ? '…' : ''}` : '—');
  console.log(`  Work history   ${p.workHistory.length} entries`);
  for (const w of p.workHistory) console.log(`     • ${w.title ?? '?'} @ ${w.company ?? '?'}  (${w.from ?? '?'} – ${w.to ?? '?'})`);
  console.log(`  Education      ${p.education.length} entries`);
  for (const e of p.education) console.log(`     • ${e.degree ?? '?'} — ${e.institution ?? '?'}${e.location ? `, ${e.location}` : ''}  (${e.to ?? '?'})`);
  console.log(`  Certifications ${p.certifications.length}`);
  for (const c of p.certifications) console.log(`     • ${c.name}${c.issuer ? ` — ${c.issuer}` : ''}${c.date ? `  (${c.date})` : ''}`);
  if (p.summary) console.log(`  Summary        ${p.summary.slice(0, 120)}${p.summary.length > 120 ? '…' : ''}`);
  console.log(`  Sections       ${p._meta.sectionsFound.join(', ') || '(none detected)'}`);
  if (p._meta.warnings.length) console.log(`  ⚠ Warnings     ${p._meta.warnings.join(' | ')}`);
}

const files = await collectFiles(target);
if (!files.length) { console.error('No .pdf or .docx files found.'); process.exit(1); }

for (const file of files) {
  const buf = await readFile(file);
  const kind = detectKind(file);
  if (!kind) { console.error(`Skip (unsupported): ${file}`); continue; }
  try {
    const text = await extractCVText(buf, kind);
    const parsed = parseCV(text);
    if (jsonOnly) console.log(JSON.stringify({ file: basename(file), parsed }, null, 2));
    else pretty(file, parsed);
  } catch (e) {
    console.error(`✗ Failed on ${basename(file)}:`, (e as Error).message);
  }
}
