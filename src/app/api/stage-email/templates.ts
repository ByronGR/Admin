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
