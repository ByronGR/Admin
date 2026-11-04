'use client';

// Activity tab on a company — the shared HubSpot-style timeline, scoped to the
// whole company: every call, email, meeting, note and task across its deals and
// contacts.

import type { Organization } from '@/lib/types';
import { Timeline } from './timeline';

export function ActivityTab({ org }: { org: Organization }) {
  return (
    <div style={{ marginTop: 20 }}>
      <Timeline scope={{ kind: 'org', orgId: org.id }} context={{ orgId: org.id, orgName: org.name }} />
    </div>
  );
}
