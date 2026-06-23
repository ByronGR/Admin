/**
 * POST /api/sync-hubspot
 *
 * Unified HubSpot contact sync for both candidate and client portals.
 * Body: { type: 'candidate' | 'client', candidate: {...} | client: {...}, event: string }
 *
 * Merged from sync-hubspot-candidate.js + sync-hubspot-client.js to stay
 * within Vercel Hobby plan's 12 serverless-function limit.
 */

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { firstname: parts[0] || '', lastname: parts.slice(1).join(' ') };
}

function compactProperties(properties) {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
  );
}

async function hubspotFetch(path, options) {
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

async function upsertContact(email, properties) {
  let result = await hubspotFetch(
    '/crm/v3/objects/contacts/' + encodeURIComponent(email) + '?idProperty=email',
    { method: 'PATCH', body: JSON.stringify({ properties }) }
  );
  if (result.response.status === 404) {
    result = await hubspotFetch('/crm/v3/objects/contacts', {
      method: 'POST',
      body: JSON.stringify({ properties })
    });
  }
  return result;
}

function isUnknownProperty(body) {
  const msg = String(body.message || '').toLowerCase();
  return msg.includes('property') && (msg.includes('does not exist') || msg.includes('unknown'));
}

function candidateProperties(candidate) {
  const { firstname, lastname } = splitName(candidate.name);
  const firstPipeline = (candidate.pipelines || [])[0] || {};
  return compactProperties({
    email: candidate.email,
    firstname,
    lastname,
    phone: candidate.phone,
    city: String(candidate.location || '').split(',')[0].trim(),
    jobtitle: candidate.role,
    company: firstPipeline.orgName || 'Nearwork Candidate',
    website: candidate.profileUrl,
    type: 'Candidate',
    nearwork_contact_type: 'candidate',
    nearwork_portal_type: 'talent',
    nearwork_candidate_code: candidate.code,
    nearwork_candidate_status: candidate.status,
    lifecyclestage: 'lead',
  });
}

function clientProperties(client) {
  const { firstname, lastname } = splitName(client.name);
  return compactProperties({
    email: client.email,
    firstname,
    lastname,
    company: client.orgName || '',
    jobtitle: client.displayRole || client.jobTitle || client.businessRole || '',
    nearwork_contact_type: 'client',
    nearwork_portal_type: 'app',
    nearwork_org_id: client.orgId || '',
    lifecyclestage: 'lead',
  });
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

  const { type = 'candidate', candidate = {}, client = {} } = req.body || {};
  const email = (type === 'client' ? client.email : candidate.email) || '';
  if (!email) return res.status(400).json({ ok: false, error: 'email is required' });

  const properties = type === 'client' ? clientProperties(client) : candidateProperties(candidate);

  let result = await upsertContact(email, properties);

  // If Nearwork custom properties don't exist yet in this HubSpot portal, retry without them
  if (!result.response.ok && isUnknownProperty(result.body)) {
    const safe = Object.fromEntries(
      Object.entries(properties).filter(([key]) => !key.startsWith('nearwork_'))
    );
    result = await upsertContact(email, safe);
    result.body.nearworkPropertiesSkipped = true;
  }

  if (!result.response.ok) {
    return res.status(result.response.status).json({
      ok: false,
      error: result.body.message || 'HubSpot sync failed',
      details: result.body,
    });
  }

  return res.status(200).json({
    ok: true,
    id: result.body.id,
    type,
    createdOrUpdated: true,
    nearworkPropertiesSkipped: !!result.body.nearworkPropertiesSkipped,
  });
};
