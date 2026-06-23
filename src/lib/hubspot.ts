export function syncCandidateToHubSpot(candidate: {
  email?: string;
  name?: string;
  phone?: string;
  location?: string;
  code?: string;
  status?: string;
  role?: string;
  currentRole?: string;
  activePipelineStage?: string;
}) {
  const email = candidate.email?.trim();
  if (!email) return;
  fetch('/api/sync-hubspot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'candidate',
      candidate: {
        email,
        name: candidate.name || '',
        phone: candidate.phone || '',
        location: candidate.location || '',
        code: candidate.code || '',
        status: candidate.activePipelineStage || candidate.status || 'active',
        role: candidate.currentRole || candidate.role || '',
      },
    }),
  }).catch(() => {});
}
