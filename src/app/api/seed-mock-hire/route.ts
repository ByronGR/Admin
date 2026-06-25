import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const db = adminDb();
    const mockHire = {
      candidateCode: 'CAND-MOCK01',
      candidateName: 'Valentina Morales',
      name: 'Valentina Morales',
      email: 'valentina.morales@example.com',
      role: 'Senior Customer Success Manager',
      orgId: 'WSNPTT',
      organizationId: 'WSNPTT',
      orgName: 'Nearwork',
      clientCompany: 'Nearwork',
      pipelineCode: 'NW-2499',
      openingCode: 'NW-2499',
      serviceType: 'EOR',
      engagementType: 'EOR',
      contractType: 'EOR',
      eorTier: 'Growth',
      startDate: '2026-06-01',
      effectiveDate: '2026-05-28',
      status: 'Active',
      salary: 4200000,
      salaryCurrency: 'COP',
      copSalaryMonthly: 4200000,
      compensationCurrency: 'COP',
      salesPrice: 2800,
      salesCurrency: 'USD',
      usdBilledMonthly: 2800,
      fxRateAtHire: 4150,
      ncrAtSigning: 0.33,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.collection('clientAccountPeople').doc('mock-hire-valentina').set(mockHire);
    return NextResponse.json({ ok: true, id: 'mock-hire-valentina' });
  } catch (e) {
    console.error('seed-mock-hire error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
