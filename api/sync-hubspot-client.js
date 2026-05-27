function compactProperties(properties) {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
  );
}

async function hubspotFetch(path, options = {}) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  const response = await fetch('https://api.hubapi.com' + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function upsertHubspotContact(email, properties) {
  let hubspot = await hubspotFetch('/crm/v3/objects/contacts/' + encodeURIComponent(email) + '?idProperty=email', {
    method: 'PATCH',
    body: JSON.stringify({ properties })
  });
  if (hubspot.response.status === 404) {
    hubspot = await hubspotFetch('/crm/v3/objects/contacts', {
      method: 'POST',
      body: JSON.stringify({ properties })
    });
  }
  return hubspot;
}

function isUnknownHubspotProperty(body = {}) {
  const msg = String(body.message || '').toLowerCase();
  return msg.includes('property') && (msg.includes('does not exist') || msg.includes('unknown'));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    return res.status(500).json({ ok: false, error: 'HUBSPOT_ACCESS_TOKEN is not configured' });
  }

  const { client = {}, event = 'signup' } = req.body || {};
  if (!client.email) return res.status(400).json({ ok: false, error: 'Client email is required' });

  const nameParts = String(client.name || '').trim().split(/\s+/).filter(Boolean);
  const properties = compactProperties({
    email: client.email,
    firstname: nameParts[0] || '',
    lastname: nameParts.slice(1).join(' ') || '',
    company: client.orgName || '',
    jobtitle: client.displayRole || client.jobTitle || client.businessRole || '',
    nearwork_contact_type: 'client',
    nearwork_portal_type: 'app',
    nearwork_org_id: client.orgId || '',
    lifecyclestage: 'lead',
  });

  let hubspot = await upsertHubspotContact(client.email, properties);
  if (!hubspot.response.ok && isUnknownHubspotProperty(hubspot.body)) {
    const fallback = { email: properties.email, firstname: properties.firstname, lastname: properties.lastname, company: properties.company, jobtitle: properties.jobtitle, lifecyclestage: 'lead' };
    hubspot = await upsertHubspotContact(client.email, fallback);
    hubspot.body.nearworkPropertiesSkipped = true;
  }

  if (!hubspot.response.ok) {
    return res.status(hubspot.response.status).json({ ok: false, error: hubspot.body.message || 'HubSpot sync failed', details: hubspot.body });
  }

  return res.status(200).json({ ok: true, id: hubspot.body.id, createdOrUpdated: true });
};
