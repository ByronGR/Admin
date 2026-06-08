import { NextResponse } from 'next/server';

// ─── POST /api/hs ─────────────────────────────────────────────────────────────
// Upserts a contact into HubSpot. Called fire-and-forget from app.nearwork.co
// on client sign-up. Sets the 'type' contact property to 'Client'.
//
// Body: { type: "client", client: { email, name, orgId, orgName, businessRole }, event: "signup" }

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function compact(obj: Record<string, string | undefined | null>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v != null && v !== '')
  ) as Record<string, string>;
}

async function upsertContact(token: string, email: string, props: Record<string, string>) {
  // Search for existing contact
  const search = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
      properties: ['email'],
      limit: 1,
    }),
  });
  const found = await search.json();
  const existingId: string | undefined = found?.results?.[0]?.id;

  if (existingId) {
    const r = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${existingId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: props }),
    });
    return { ok: r.ok, status: r.status };
  }
  const r = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { ...props, email } }),
  });
  return { ok: r.ok, status: r.status };
}

export async function POST(req: Request) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ ok: false, skipped: true, reason: 'not configured' });

  try {
    const body = await req.json();
    if (body?.type === 'client' && body?.client?.email) {
      const { email, name, orgName, businessRole } = body.client as Record<string, string>;
      const parts = (name ?? '').trim().split(/\s+/);
      const props = compact({
        type: 'Client',
        nearwork_contact_type: 'client',
        nearwork_portal_type: 'client',
        company: orgName,
        jobtitle: businessRole,
        firstname: parts[0],
        lastname: parts.slice(1).join(' ') || undefined,
        lifecyclestage: 'lead',
      });
      const result = await upsertContact(token, email, props);
      return NextResponse.json(result);
    }
    return NextResponse.json({ ok: false, reason: 'unknown type' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
