function splitName(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return {
    firstname: parts[0] || '',
    lastname: parts.slice(1).join(' ')
  };
}

function cityFromLocation(location = '') {
  return String(location).split(',')[0].trim();
}

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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    return res.status(500).json({ ok: false, error: 'HUBSPOT_ACCESS_TOKEN is not configured' });
  }

  const { candidate = {}, event = 'ats_sync' } = req.body || {};
  if (!candidate.email) {
    return res.status(400).json({ ok: false, error: 'Candidate email is required' });
  }

  const { firstname, lastname } = splitName(candidate.name);
  const firstPipeline = (candidate.pipelines || [])[0] || {};

  const properties = compactProperties({
    email: candidate.email,
    firstname,
    lastname,
    phone: candidate.phone,
    city: cityFromLocation(candidate.location),
    jobtitle: candidate.role,
    company: firstPipeline.orgName || 'Nearwork Candidate',
    website: candidate.profileUrl,
    lifecyclestage: 'lead'
  });

  let hubspot = await hubspotFetch('/crm/v3/objects/contacts/' + encodeURIComponent(candidate.email) + '?idProperty=email', {
    method: 'PATCH',
    body: JSON.stringify({ properties })
  });

  if (hubspot.response.status === 404) {
    hubspot = await hubspotFetch('/crm/v3/objects/contacts', {
      method: 'POST',
      body: JSON.stringify({ properties })
    });
  }

  if (!hubspot.response.ok) {
    return res.status(hubspot.response.status).json({
      ok: false,
      error: hubspot.body.message || 'HubSpot sync failed',
      details: hubspot.body
    });
  }

  return res.status(200).json({
    ok: true,
    id: hubspot.body.id,
    createdOrUpdated: true
  });
};
