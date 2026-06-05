import { NextResponse } from 'next/server';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

interface AirtableResponse {
  records?: AirtableRecord[];
  offset?: string;
  error?: { type: string; message: string };
}

export interface AirtableRole {
  id: string;
  name: string;
  suggestedMin?: number;
  suggestedMax?: number;
  currency?: string;
  notes?: string;
}

// ─── Field helpers ──────────────────────────────────────────────────────────────

function firstStr(fields: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = fields[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function firstNum(fields: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = fields[k];
    if (v !== undefined && v !== null && v !== '') {
      const n = Number(v);
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return undefined;
}

function parseRecord(r: AirtableRecord): AirtableRole | null {
  const f = r.fields;
  const name = firstStr(f,
    'Role', 'Job Title', 'Title', 'Name', 'Position', 'Role Name',
    'Job Role', 'Job Name', 'Opening Title',
  );
  if (!name) return null;
  return {
    id: r.id,
    name,
    suggestedMin: firstNum(f,
      'Min Rate', 'Salary Min', 'Min Salary', 'NW Min',
      'Suggested Min', 'Min Rate (USD)', 'Min', 'Rate Min',
      'Base Min', 'Salary Min (USD)', 'NW Rate Min',
    ),
    suggestedMax: firstNum(f,
      'Max Rate', 'Salary Max', 'Max Salary', 'NW Max',
      'Suggested Max', 'Max Rate (USD)', 'Max', 'Rate Max',
      'Base Max', 'Salary Max (USD)', 'NW Rate Max',
    ),
    currency: firstStr(f, 'Currency', 'Salary Currency') || 'USD',
    notes: firstStr(f, 'Notes', 'Description', 'Details', 'Comments'),
  };
}

// ─── Handler ────────────────────────────────────────────────────────────────────

export async function GET() {
  const base = process.env.AIRTABLE_BASE;
  const key  = process.env.AIRTABLE_KEY;

  if (!base || !key) {
    return NextResponse.json(
      { ok: false, error: 'AIRTABLE_BASE / AIRTABLE_KEY not configured' },
      { status: 500 },
    );
  }

  // Try common table names in order
  const tableNames = [
    'Roles', 'Job Roles', 'Positions', 'Job Titles',
    'Salary Rates', 'Role Rates', 'Openings',
  ];

  let records: AirtableRecord[] = [];

  for (const tableName of tableNames) {
    try {
      const url = `https://api.airtable.com/v0/${base}/${encodeURIComponent(tableName)}?maxRecords=200`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
        // Vercel edge cache — revalidate every hour
        next: { revalidate: 3600 },
      } as RequestInit);
      if (!res.ok) continue;
      const data: AirtableResponse = await res.json();
      if (data.records && data.records.length > 0) {
        records = data.records;
        break;
      }
    } catch {
      continue;
    }
  }

  const roles: AirtableRole[] = records
    .map(parseRecord)
    .filter((r): r is AirtableRole => r !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ ok: true, roles });
}
