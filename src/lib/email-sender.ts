// ─── Resend sender routing ────────────────────────────────────────────────────
// Every Resend email leaves on a sending domain chosen by AUDIENCE, never on the
// root domain. Candidates and clients are kept apart on purpose: candidate mail
// is high-volume and consent-based (job-match blasts to the whole opted-in
// base), client mail is low-volume and revenue-critical. Sharing one reputation
// means a bad alert blast can spam-folder a candidate submission. The root
// domain @nearwork.co is reserved for human mail out of Microsoft 365, which
// also carries the cold outreach — so no automated mail belongs there at all.
//
//   candidate → RESEND_FROM_CANDIDATE   e.g. "Nearwork <noreply@careers.nearwork.co>"
//   client    → RESEND_FROM_CLIENT      e.g. "Nearwork <noreply@portal.nearwork.co>"
//
// There is deliberately NO hardcoded @nearwork.co fallback here. An unset
// variable falls back to the legacy RESEND_FROM_EMAIL and, failing that, throws.
// A silent revert to the root domain is the exact bug this module exists to
// prevent — it is better for a send to fail loudly than to quietly poison the
// domain that carries Byron's own mail.

export type EmailAudience = 'candidate' | 'client';

const AUDIENCE_ENV: Record<EmailAudience, string> = {
  candidate: 'RESEND_FROM_CANDIDATE',
  client: 'RESEND_FROM_CLIENT',
};

/** "noreply@x" → "Nearwork <noreply@x>". Already-formatted values pass through. */
function withDisplayName(value: string): string {
  return value.includes('<') ? value : `Nearwork <${value}>`;
}

export function fromAddress(audience: EmailAudience): string {
  const specific = process.env[AUDIENCE_ENV[audience]]?.trim();
  if (specific) return withDisplayName(specific);

  // Transitional: keeps sending working until both audience variables are set.
  const legacy = process.env.RESEND_FROM_EMAIL?.trim();
  if (legacy) return withDisplayName(legacy);

  throw new Error(
    `No sending address configured for "${audience}" email. ` +
      `Set ${AUDIENCE_ENV[audience]} in the environment.`,
  );
}

export function replyToAddress(): string | undefined {
  return process.env.RESEND_REPLY_TO_EMAIL?.trim() || undefined;
}

/** `from` + `reply_to`, ready to spread straight into a Resend payload. */
export function senderFields(audience: EmailAudience): { from: string; reply_to?: string } {
  const replyTo = replyToAddress();
  return {
    from: fromAddress(audience),
    ...(replyTo ? { reply_to: replyTo } : {}),
  };
}
