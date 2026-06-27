'use client';

import { MainLayout } from '@/components/layout/main-layout';
import { PageHeader, Card } from '@/components/nw/shell-ui';
import { NW, Icon } from '@/components/nw/primitives';

export default function SppPage() {
  return (
    <MainLayout>
      <PageHeader overline="Partners" title="SPP" subtitle="Strategic Partner Program — agencies and partners reselling Nearwork." />
      <Card style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 28 }}>
        <span style={{ width: 40, height: 40, borderRadius: 10, background: NW.gray50, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="git-merge" size={18} color={NW.gray500} />
        </span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: NW.black }}>Coming up in the redesign</div>
          <div style={{ fontSize: 13, color: NW.gray500, marginTop: 2 }}>The SPP partners view is part of the Admin makeover and ships in a later sprint.</div>
        </div>
      </Card>
    </MainLayout>
  );
}
