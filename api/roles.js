export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const key   = process.env.AIRTABLE_KEY;
  const base  = process.env.AIRTABLE_BASE;
  const table = process.env.AIRTABLE_SALARY_TABLE || 'Table 1';

  if (!key || !base) {
    return res.status(500).json({ ok: false, error: 'Airtable credentials not configured' });
  }

  const records = [];
  let offset = null;

  do {
    const url = new URL(`https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`);
    url.searchParams.append('fields[]', 'Role');
    url.searchParams.append('fields[]', 'Min in USD');
    url.searchParams.append('fields[]', 'Avg in USD');
    url.searchParams.append('fields[]', 'Max in USD');
    url.searchParams.append('fields[]', 'Department');
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}` }
    });
    const d = await r.json();

    if (!r.ok) {
      return res.status(500).json({ ok: false, error: d.error?.message || 'Airtable error' });
    }

    records.push(...d.records);
    offset = d.offset || null;
  } while (offset);

  const roles = records
    .filter(r => r.fields && r.fields.Role)
    .map(r => ({
      role:       r.fields.Role,
      min:        r.fields['Min in USD'] || 0,
      avg:        r.fields['Avg in USD'] || 0,
      max:        r.fields['Max in USD'] || 0,
      department: r.fields['Department'] || null
    }));

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ ok: true, roles });
}
