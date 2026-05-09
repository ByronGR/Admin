export default async function handler(req, res) {
  const key   = process.env.AIRTABLE_KEY || process.env.AIRTABLE_TOKEN;
  const base  = process.env.AIRTABLE_BASE || process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_SALARY_TABLE || process.env.AIRTABLE_ROLES_TABLE || 'Table 1';

  if (!key || !base) {
    return res.status(500).json({ ok: false, error: 'Airtable credentials not configured' });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const role = String(body.role || '').trim();
    if (!role) return res.status(400).json({ ok: false, error: 'Role is required' });
    const fields = {
      Role: role,
      'Min in USD': Number(body.min || 0),
      'Avg in USD': Number(body.avg || body.min || body.max || 0),
      'Max in USD': Number(body.max || 0),
      Department: body.department || ''
    };
    const response = await fetch(`https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(500).json({ ok: false, error: data.error?.message || 'Airtable create failed' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, role: { id: data.id, ...fields } });
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
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

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, roles });
}
