const TEMPLATE_COPY = {
  account_created: {
    subject: 'Your Nearwork account is ready',
    heading: 'Your account was created',
    body: 'Your Nearwork account has been created successfully. You can now log in and continue your process.'
  },
  account_deleted: {
    subject: 'Your Nearwork account was deleted',
    heading: 'Account deleted',
    body: 'Your Nearwork account has been deleted successfully. If this was not expected, please contact our team.'
  },
  job_applied: {
    subject: 'We received your application',
    heading: 'Application received',
    body: 'Thanks for applying. Our team will review your profile and start working to match you with the right opportunity.'
  },
  withdrawal_application: {
    subject: 'Application withdrawn',
    heading: 'We understand',
    body: 'We confirmed that you withdrew from this application. When you are ready, you can apply again to any open Nearwork role.'
  },
  update_profile: {
    subject: 'Please update your Nearwork profile',
    heading: 'Your profile needs attention',
    body: 'Some information is missing from your profile. Please update it so we can continue reviewing your applications.'
  },
  book_recruiter: {
    subject: 'Next step: book time with a Nearwork recruiter',
    heading: 'Book time with your recruiter',
    body: 'You have moved to the next step. Please book time with a Nearwork recruiter so we can continue your process.'
  },
  assessment_assigned: {
    subject: 'Your Nearwork assessment is ready',
    heading: 'Assessment assigned',
    body: 'Your assessment is available in your Nearwork dashboard. Please complete it within the next 24 hours.'
  },
  assessment_completed_candidate: {
    subject: 'We received your Nearwork assessment',
    heading: 'Assessment submitted',
    body: 'Thank you for completing your assessment. It has been shared successfully with the Nearwork team, and we will reach out with next steps.'
  },
  assessment_completed_recruiter: {
    subject: 'Candidate assessment completed',
    heading: 'Assessment ready for review',
    body: 'A candidate has completed their Nearwork assessment. Please review the answers, DISC profile, and score in the Admin assessment center.'
  },
  stage_moved: {
    subject: 'Your Nearwork application has moved forward',
    heading: 'You moved to the next stage',
    body: 'Your application has moved to a new stage. Please keep an eye on your email, WhatsApp, and Nearwork dashboard for next steps.'
  },
  candidate_hired: {
    subject: 'You got the job!',
    heading: 'Congratulations',
    body: 'You got the job. Please keep an eye on your email for next steps while we coordinate with the client.'
  },
  candidate_rejected: {
    subject: 'Update on your Nearwork application',
    heading: 'Thank you for going through the process',
    body: 'Thank you for applying and participating in the process. You were not selected for this opportunity, but we will keep your profile in mind for future roles.'
  },
  next_steps: {
    subject: 'Nearwork next steps',
    heading: 'Next steps',
    body: 'We wanted to share an update on your process. Please review your dashboard and stay attentive for the next step.'
  },
  account_invitation: {
    subject: 'You were invited to Nearwork',
    heading: 'Nearwork invitation',
    body: 'You were added to an organization in Nearwork. Please log in to review your dashboard.'
  },
  password_reset: {
    subject: 'Reset your Nearwork password',
    heading: 'Password reset',
    body: 'A password reset was requested for your Nearwork account. Follow the secure link to set a new password.'
  },
  notification: {
    subject: 'You have a Nearwork notification',
    heading: 'New notification',
    body: 'You have a new notification in your Nearwork dashboard. Please log in to review it.'
  },
  urgent_contact: {
    subject: 'Urgent: Nearwork is trying to reach you',
    heading: 'We are trying to reach you',
    body: 'We have tried to contact you without success. Please check your dashboard or contact our team as soon as possible.'
  },
  support_auto_reply: {
    subject: 'We received your support request',
    heading: 'Thanks for contacting Nearwork',
    body: 'Thank you for your email. Our team will review it and get back to you as soon as possible.'
  },
  client_interview: {
    subject: 'Reminder: client interview coming up',
    heading: 'Client interview reminder',
    body: 'Your client interview is coming up. Please join on time, review the role, prepare examples, and make sure your camera, audio, and internet are ready.'
  },
  account_completion: {
    subject: 'Complete your Nearwork account',
    heading: 'Complete your profile',
    body: 'Your account needs to be completed before you can apply to jobs. Please log in and finish your profile.'
  },
  job_alert: {
    subject: 'New Nearwork job alert',
    heading: 'A matching role is open',
    body: 'A new role matching your job alerts is open. Review it and apply if it looks like a fit.'
  }
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildHtml(template, data) {
  const name = escapeHtml(data.name || 'there');
  const role = escapeHtml(data.role || data.openingTitle || '');
  const stage = escapeHtml(data.stage || '');
  const actionUrl = data.actionUrl || data.dashboardUrl || 'https://talent.nearwork.co';
  const actionText = escapeHtml(data.actionText || 'Open Nearwork');
  const extra = data.message ? `<p>${escapeHtml(data.message)}</p>` : '';
  return `<!doctype html>
<html>
  <body style="margin:0;background:#F5F4F0;font-family:Arial,sans-serif;color:#111111;">
    <div style="max-width:620px;margin:0 auto;padding:28px 16px;">
      <div style="background:#111111;color:#fff;border-radius:14px 14px 0 0;padding:22px 24px;font-size:22px;font-weight:800;">Near<span style="color:#AF7AC5;">work</span></div>
      <div style="background:#fff;border:1px solid #EBEBEB;border-top:0;border-radius:0 0 14px 14px;padding:28px 24px;">
        <h1 style="font-size:22px;line-height:1.25;margin:0 0 12px;">${escapeHtml(template.heading)}</h1>
        <p style="font-size:15px;line-height:1.7;margin:0 0 14px;">Hi ${name},</p>
        <p style="font-size:15px;line-height:1.7;margin:0 0 14px;">${escapeHtml(template.body)}</p>
        ${role ? `<p style="font-size:14px;line-height:1.6;margin:0 0 8px;"><strong>Role:</strong> ${role}</p>` : ''}
        ${stage ? `<p style="font-size:14px;line-height:1.6;margin:0 0 8px;"><strong>Current stage:</strong> ${stage}</p>` : ''}
        ${extra}
        <a href="${escapeHtml(actionUrl)}" style="display:inline-block;margin-top:18px;background:#16A085;color:#fff;text-decoration:none;border-radius:9px;padding:12px 18px;font-size:14px;font-weight:700;">${actionText}</a>
        <p style="font-size:12px;line-height:1.6;color:#555555;margin:24px 0 0;">Nearwork Team</p>
      </div>
    </div>
  </body>
</html>`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const configuredFrom = process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM || 'support@nearwork.co';
  const fromEmail = configuredFrom.includes('<')
    ? configuredFrom.match(/<([^>]+)>/)?.[1] || 'support@nearwork.co'
    : configuredFrom;
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL || 'support@nearwork.co';

  if (!apiKey) {
    return res.status(500).json({ ok: false, error: 'RESEND_API_KEY is not configured' });
  }

  const { to, templateId, data = {}, subject } = req.body || {};
  const template = TEMPLATE_COPY[templateId];

  if (!to || !template) {
    return res.status(400).json({ ok: false, error: 'Missing to or valid templateId' });
  }

  const payload = {
    from: `Nearwork <${fromEmail}>`,
    to: Array.isArray(to) ? to : [to],
    reply_to: replyTo,
    subject: subject || template.subject,
    html: buildHtml(template, data)
  };

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const result = await resendResponse.json().catch(() => ({}));
  if (!resendResponse.ok) {
    return res.status(resendResponse.status).json({ ok: false, error: result.message || 'Resend failed', details: result });
  }

  return res.status(200).json({ ok: true, id: result.id });
};
