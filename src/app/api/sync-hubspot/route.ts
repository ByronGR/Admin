import { NextResponse } from 'next/server';

// ─── POST /api/sync-hubspot ────────────────────────────────────────────────────
// Upserts a contact into HubSpot. Called fire-and-forget from:
//   • app.nearwork.co  — client portal sign-up  (type: "client")
//   • jobs.nearwork.co — candidate apply         (type: "candidate")  [direct via submit-application.js]
//
// Body (type = "client"):
//   { type: "client", client: { email, name, orgId, orgName, businessRole }, event: "signup" }
//
// The `type` HubSpot property maps to the "Type" contact property with values:
//   Candidate | Client | Hired

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ClientPayload {
  email: string;
  name?: string;
  orgId?: string;
  orgName?: string;
  businessRole?: string;
}

interface SyncBody {
  type: 'client' | 'candidate';
  client?: ClientPayload;
  event?: string;
}

function compactProperties(obj: Record<string, string | undefined | null>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v != null && v !== '')
  ) as Record<string, string>;
}

async function upsertHubSpotContact(
  token: string,
  email: string,
  properties: Record<string, string>
): Promise<{ ok: boolean; status: number }> {
  const searchRes = await fetch(
    `https://api.hubapi.com/crm/v3/objects/contacts/search`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
        properties: ['email'],
        limit: 1,
      }),
    }
  );
  const searchData = await searchRes.json();
  const existingId: string | undefined = searchData?.results?.[0]?.id;

  if (existingId) {
    // Update existing contact
    const updateRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts/${existingId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties }),
      }
    );
    return { ok: updateRes.ok, status: updateRes.status };
  } else {
    // Create new contact
    const createRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties: { ...properties, email } }),
      }
    );
    return { ok: createRes.ok, status: createRes.status };
  }
}

export async function POST(req: Request) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, skipped: true, reason: 'HubSpot not configured' });
  }

  let body: SyncBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    if (body.type === 'client' && body.client?.email) {
      const { email, name, orgName, businessRole } = body.client;
      const nameParts = (name ?? '').trim().split(/\s+/);
      const properties = compactProperties({
        type: 'Client',
        nearwork_contact_type: 'client',
        nearwork_portal_type: 'client',
        company: orgName ?? '',
        jobtitle: businessRole ?? '',
        firstname: nameParts[0] ?? '',
        lastname: nameParts.slice(1).join(' ') || undefined,
        lifecyclestage: 'lead',
      });
      const result = await upsertHubSpotContact(token, email, properties);
      return NextResponse.json({ ok: result.ok, status: result.status });
    }

    return NextResponse.json({ ok: false, reason: 'Unknown type or missing email' }, { status: 400 });
  } catch (err) {
    console.error('sync-hubspot error:', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
