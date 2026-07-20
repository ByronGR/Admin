// ─── Stage-change email templates (real HTML, per Admin pipeline stage) ───────
// The HTML lives in ./html.ts (generated from Byron's files). Each stage below
// maps an Admin stage key → { subject, html }. Tokens are filled at send time.
//
// Mapping (per Byron, 2026-07-01):
//   applied            → NO stage email (the apply-time "Application received"
//                        email already welcomes them — see send-email/job_applied)
//   background-check   → profile_review
//   interview          → interview
//   assessment         → assessment      (+ {assessmentUrl})
//   partner-review     → partner_review
//   partner-interview  → partner_interview
//   hired              → hired
//   not-selected       → denied          (+ {rejectionReason}, candidate-safe)

import { fill } from '../send-email/templates/_base';
import { STAGE_HTML } from './html';

type TemplateData = Record<string, string>;
type StageTemplate = { build(data: TemplateData): { subject: string; html: string } };

function tmpl(subject: string, htmlKey: keyof typeof STAGE_HTML | string): StageTemplate {
  const html = STAGE_HTML[htmlKey as string] ?? '';
  return {
    build(data) {
      return { subject: fill(subject, data), html: fill(html, data) };
    },
  };
}

// Keyed by the Admin stage the candidate was just moved TO.
export const STAGE_TEMPLATES: Record<string, StageTemplate> = {
  // Sent when a candidate is APPROVED from the applicant list into the pipeline
  // (i.e. enters the "Applied" stage). The apply-time "Application received"
  // email is a separate, earlier moment.
  'applied':           tmpl("You've moved to the next stage — {roleTitle}", 'application_moved'),
  'background-check':  tmpl('Your profile is under review — {roleTitle}', 'profile_review'),
  'interview':         tmpl('Time to meet the team — {roleTitle}', 'interview'),
  'assessment':        tmpl('Your assessment is ready — {roleTitle}', 'assessment'),
  'partner-review':    tmpl("You've been presented to our partner — {roleTitle}", 'partner_review'),
  'partner-interview': tmpl('Your partner interview is scheduled — {roleTitle}', 'partner_interview'),
  'hired':             tmpl('You got the job! — {roleTitle}', 'hired'),
  'not-selected':      tmpl('An update on your application — {roleTitle}', 'denied'),
};

// ─── Sourcing-only: the single candidate email, sent on 'submitted' ────────────
// Nearwork sources & submits; the partner runs their own process and talks to
// the candidate directly. So sourcing sends exactly one email — on hand-off — and
// deliberately does NOT name the client.
export const SOURCING_SUBMITTED: StageTemplate = {
  build(data) {
    const subject = fill('Your application has been shared — {roleTitle}', data);
    const html = fill(
      `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F5F4F0;font-family:'Poppins',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F4F0;">
    <tr><td align="center" style="padding:40px 16px 48px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
        <tr><td style="padding:30px 40px 0;">
          <span style="font-size:22px;font-weight:700;color:#111;letter-spacing:-0.03em;">Nearwork</span>
          <div style="width:64px;height:3px;background:#16A085;border-radius:2px;margin-top:5px;"></div>
        </td></tr>
        <tr><td style="padding:28px 40px 40px;">
          <h1 style="font-size:20px;font-weight:700;color:#111;margin:0 0 14px;">Hi {firstName},</h1>
          <p style="font-size:15px;color:#444;line-height:1.7;margin:0 0 16px;">
            Good news — your information for the <strong>{roleTitle}</strong> role has been shared with our partner.
          </p>
          <p style="font-size:15px;color:#444;line-height:1.7;margin:0 0 16px;">
            Their team will be in touch with you directly about the next steps. From here, the interviews and the final decision are handled on their side — we&rsquo;ll be cheering you on.
          </p>
          <p style="font-size:15px;color:#444;line-height:1.7;margin:0;">Thanks for going through this with us.</p>
          <p style="font-size:15px;color:#111;font-weight:600;line-height:1.7;margin:18px 0 0;">— The Nearwork team</p>
        </td></tr>
        <tr><td style="background:#F5F4F0;border-top:1px solid #EBEBEB;padding:20px 40px;">
          <p style="font-size:12px;color:#9E9E9E;margin:0;">Questions? Reach us at <a href="mailto:support@nearwork.co" style="color:#16A085;text-decoration:none;">support@nearwork.co</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
      data,
    );
    return { subject, html };
  },
};
