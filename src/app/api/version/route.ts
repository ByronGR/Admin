import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Reports the currently-deployed build id. The client remembers the id it first
// loaded with and polls this; when it changes, a new version has been deployed and
// the client shows a "refresh" banner. VERCEL_DEPLOYMENT_ID changes on every
// deploy (even a redeploy of the same commit); the others are fallbacks.
export function GET() {
  const v =
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    'dev';
  return NextResponse.json(
    { v },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
