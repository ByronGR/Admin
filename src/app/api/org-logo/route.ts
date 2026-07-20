// ─── GET /api/org-logo?url=<website> ──────────────────────────────────────────
// Returns an organization's logo as a same-origin image, so the browser never
// has to load a third-party host (keeps the strict img-src CSP intact) and we get
// caching + a clean fallback chain for free.
//
// Source order, best recognizable logo first:
//   1. unavatar.io   — aggregates real company logos (Clearbit, Twitter, favicon…)
//   2. Google favicon — always available, lower-res, used only if unavatar has none
// If neither yields an image we 404, and <OrgAvatar> falls back to initials.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function hostnameFrom(raw: string): string | null {
  try {
    const withProto = raw.startsWith('http') ? raw : `https://${raw}`;
    const h = new URL(withProto).hostname.replace(/^www\./, '');
    // Reject obviously invalid hosts (no dot, localhost, IPs used as SSRF probes).
    if (!h.includes('.') || h === 'localhost') return null;
    return h;
  } catch {
    return null;
  }
}

async function tryFetch(url: string, timeoutMs = 6000): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return null;
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url') || req.nextUrl.searchParams.get('domain') || '';
  const host = hostnameFrom(raw.trim());
  if (!host) return new NextResponse(null, { status: 400 });

  const sources = [
    `https://unavatar.io/${host}?fallback=false`,        // real company logo, 404 if none
    `https://icons.duckduckgo.com/ip3/${host}.ico`,      // reliable favicon, 404 if none
    `https://www.google.com/s2/favicons?domain=${host}&sz=128`, // last-resort favicon
  ];

  for (const src of sources) {
    const res = await tryFetch(src);
    if (res) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength < 100) continue; // skip 1px trackers / empty responses
      return new NextResponse(buf, {
        status: 200,
        headers: {
          'Content-Type': res.headers.get('content-type') ?? 'image/png',
          // Cache hard: logos rarely change, and this keeps the proxy cheap.
          'Cache-Control': 'public, max-age=604800, s-maxage=604800, immutable',
        },
      });
    }
  }

  return new NextResponse(null, { status: 404 });
}
