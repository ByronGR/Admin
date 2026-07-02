// ─── Stage-change email templates (one per Admin pipeline stage) ──────────────
// PLACEHOLDERS — Byron will supply the final HTML for each stage; swap each
// `html` string for his file and keep the {placeholder} tokens where dynamic
// values go. Available tokens: {firstName} {candidateName} {roleTitle} {orgName}
//
// Each entry exports build(data) → { subject, html } — same contract as
// /api/send-email templates.

import { fill } from '../send-email/templates/_base';

type TemplateData = Record<string, string>;
type StageTemplate = { build(data: TemplateData): { subject: string; html: string } };

// Minimal branded shell used by every placeholder until the real HTML arrives.
function shell(heading: string, body: string): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#F5F4F0;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F4F0;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:14px;padding:36px 40px;">
          <tr><td style="font-size:20px;font-weight:bold;color:#111111;padding-bottom:6px;">nearwork<span style="color:#16A085;">.</span></td></tr>
          <tr><td style="font-size:17px;font-weight:bold;color:#111111;padding:18px 0 8px;">${heading}</td></tr>
          <tr><td style="font-size:14px;line-height:1.65;color:#555555;">${body}</td></tr>
          <tr><td style="font-size:12px;color:#9E9E9E;padding-top:28px;border-top:1px solid #EBEBEB;">Nearwork · Remote talent, on demand · nearwork.co</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function simple(subject: string, heading: string, body: string): StageTemplate {
  return {
    build(data) {
      return {
        subject: fill(subject, data),
        html: fill(shell(heading, body), data),
      };
    },
  };
}

// Keyed by the Admin stage the candidate was just moved TO.
export const STAGE_TEMPLATES: Record<string, StageTemplate> = {
  'applied': simple(
    'We received your application — {roleTitle}',
    'Application received',
    `Hi {firstName},<br/><br/>Thanks for applying to <strong>{roleTitle}</strong>. Our team is reviewing your profile and we'll keep you posted on every step from here.<br/><br/>— The Nearwork team`,
  ),
  'background-check': simple(
    'Your application is moving forward — {roleTitle}',
    'You’re moving forward',
    `Hi {firstName},<br/><br/>Good news — your application for <strong>{roleTitle}</strong> has moved into our screening process. We may reach out if we need anything from you.<br/><br/>— The Nearwork team`,
  ),
  'interview': simple(
    'Interview stage — {roleTitle}',
    'Time to talk',
    `Hi {firstName},<br/><br/>You've advanced to the <strong>interview stage</strong> for <strong>{roleTitle}</strong>. Our team will contact you shortly to coordinate the details.<br/><br/>— The Nearwork team`,
  ),
  'assessment': simple(
    'Next step: your assessment — {roleTitle}',
    'Assessment stage',
    `Hi {firstName},<br/><br/>You've reached the <strong>assessment stage</strong> for <strong>{roleTitle}</strong>. Keep an eye on your inbox — instructions are on their way.<br/><br/>— The Nearwork team`,
  ),
  'partner-review': simple(
    'Your profile is with the client — {roleTitle}',
    'Client review',
    `Hi {firstName},<br/><br/>Your profile for <strong>{roleTitle}</strong> is now being reviewed directly by the hiring company. We'll let you know as soon as there's news.<br/><br/>— The Nearwork team`,
  ),
  'partner-interview': simple(
    'Client interview stage — {roleTitle}',
    'Client interview',
    `Hi {firstName},<br/><br/>The hiring company would like to interview you for <strong>{roleTitle}</strong>. Our team will help coordinate the scheduling.<br/><br/>— The Nearwork team`,
  ),
  'hired': simple(
    'Congratulations — {roleTitle}',
    'You did it 🎉',
    `Hi {firstName},<br/><br/>Congratulations! You've been selected for <strong>{roleTitle}</strong>. Our team will contact you with the next steps for your onboarding.<br/><br/>— The Nearwork team`,
  ),
  'not-selected': simple(
    'An update on your application — {roleTitle}',
    'Application update',
    `Hi {firstName},<br/><br/>Thank you for the time you invested in the process for <strong>{roleTitle}</strong>. After careful review, we won't be moving forward on this role. Your profile stays in our talent network and we'll reach out when a strong match opens up.<br/><br/>— The Nearwork team`,
  ),
};
