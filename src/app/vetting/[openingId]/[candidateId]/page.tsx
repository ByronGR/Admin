import VettingPage from '@/components/candidates/vetting-page';

export default async function Page({
  params,
}: {
  params: Promise<{ openingId: string; candidateId: string }>;
}) {
  const { openingId, candidateId } = await params;
  return <VettingPage openingId={openingId} candidateId={candidateId} />;
}
