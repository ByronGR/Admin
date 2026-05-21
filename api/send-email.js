const TEMPLATE_COPY = {
  account_created: {
    subject: 'You\'re in. Welcome to Nearwork, {firstName} ✅',
    heading: 'Welcome to Nearwork, {firstName}.',
    body: 'Your candidate account is all set. You now have full access to the Nearwork talent portal, where you can manage your profile, track your applications, and follow every step of the process in real time.'
  },
  account_deleted: {
    subject: 'Your Nearwork account was deleted',
    heading: 'Account deleted',
    body: 'Your Nearwork account has been deleted successfully. If this was not expected, please contact our team.'
  },
  job_applied: {
    subject: 'We got your application, {firstName} 📩',
    heading: 'We got your application, {firstName}.',
    body: 'Thanks for applying. Our Nearwork team will review your experience and we will be in touch soon.'
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
    subject: 'Let\'s talk, {firstName} — book your interview now 🤝',
    heading: 'Let\'s talk, {firstName}.',
    body: 'You have moved to the next step. Please book time with a Nearwork recruiter so we can continue your process.'
  },
  assessment_assigned: {
    subject: 'Your assessment is ready, {firstName} — here\'s what you need to know 📝',
    heading: 'Your assessment is ready',
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
  pipeline_profile_review: {
    subject: 'You\'re in the pipeline, {firstName} — here\'s what\'s next 🌟',
    heading: 'You\'re in the pipeline, {firstName}.',
    body: 'Great news — our team has reviewed your profile and added you to the pipeline for this role.'
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
    subject: 'You were invited to {orgName} on Nearwork',
    heading: 'Your Nearwork workspace is ready',
    body: 'You were invited to your company workspace on Nearwork. Create your password to review candidates, openings, notes, and updates from the Nearwork team.'
  },
  client_org_created: {
    subject: 'Your Nearwork workspace is ready, {firstName}',
    heading: 'Welcome to Nearwork, {firstName}.',
    body: 'Your organization workspace has been created on Nearwork. Create your password to review candidates, openings, notes, and updates from the Nearwork team.'
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
    subject: '{firstName}, a role that matches your skills just opened up 🎯',
    heading: '{firstName}, this one looks like you.',
    body: 'A new role just opened up that matches your skills and experience. Take a look and apply directly from your portal.'
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

function firstNameFromData(data = {}) {
  return String(data.firstName || data.name || 'there').trim().split(/\s+/)[0] || 'there';
}

function personalizeSubject(subject, data = {}) {
  return String(subject || '')
    .replace(/\{firstName\}/g, firstNameFromData(data))
    .replace(/\{orgName\}/g, String(data.orgName || data.companyName || 'Nearwork'));
}

function buildAccountCreatedHtml(data) {
  const firstName = escapeHtml(firstNameFromData(data));
  const actionUrl = escapeHtml(data.actionUrl || data.dashboardUrl || 'https://talent.nearwork.co');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Your Nearwork account is ready</title>
</head>
<body style="margin:0; padding:0; background-color:#F5F4F0; font-family:'Poppins', Arial, sans-serif; -webkit-font-smoothing:antialiased;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; color:#F5F4F0; line-height:1px;">
    Your account is ready. Sign in and start your journey with Nearwork.&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F4F0;">
    <tr>
      <td align="center" style="padding:40px 16px 48px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px; width:100%; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.06);">
          <tr>
            <td style="background-color:#FFFFFF; padding:32px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:22px; font-weight:700; color:#111111; letter-spacing:-0.03em; line-height:1;">Nearwork</span>
                    <div style="width:68px; height:3px; background-color:#16A085; border-radius:2px; margin-top:4px;"></div>
                  </td>
                  <td align="right" valign="middle">
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:11px; color:#9E9E9E; letter-spacing:0.08em; text-transform:uppercase;">Candidate portal</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 0 40px;">
              <div style="height:4px; border-radius:2px; background:linear-gradient(90deg, #16A085 0%, #AF7AC5 60%, #E74C7C 100%);"></div>
            </td>
          </tr>
          <tr>
            <td style="background-color:#FFFFFF; padding:36px 40px 40px;">
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:40px; margin:0 0 16px 0; line-height:1;">🎉</p>
              <h1 style="font-family:'Poppins', Arial, sans-serif; font-size:26px; font-weight:700; color:#111111; letter-spacing:-0.02em; line-height:1.25; margin:0 0 14px 0;">
                Welcome to Nearwork, ${firstName}.
              </h1>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 10px 0;">
                Your candidate account is all set. You now have full access to the Nearwork talent portal, where you can manage your profile, track your applications, and follow every step of the process in real time.
              </p>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 32px 0;">
                Sign in and let's get started. 👇
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-radius:6px; background-color:#16A085;">
                    <a href="${actionUrl}" target="_blank" style="display:inline-block; font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none; padding:13px 30px; border-radius:6px; letter-spacing:-0.01em;">
                      Sign in to your portal →
                    </a>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:36px 0 28px;">
                <tr><td style="border-top:1px solid #EBEBEB;"></td></tr>
              </table>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:11px; font-weight:600; color:#16A085; letter-spacing:0.1em; text-transform:uppercase; margin:0 0 20px 0;">What to do next</p>
              ${[
                ['👤', '#E8F8F5', 'Complete your profile', 'Add your experience, skills, and CV so we can match you to the right roles.'],
                ['📋', '#F3EEF8', 'Track your applications', 'See exactly where you stand in each pipeline — no guesswork, full visibility.'],
                ['🔔', '#FEF0F5', 'Stay ready', "Our team will reach out when there's a role that matches your profile."]
              ].map(([icon, bg, title, copy]) => `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
                <tr>
                  <td valign="top" width="50" style="padding-right:14px;">
                    <div style="width:38px; height:38px; border-radius:10px; background-color:${bg}; text-align:center; line-height:38px; font-size:20px;">${icon}</div>
                  </td>
                  <td valign="top">
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#111111; margin:0 0 3px 0; line-height:1.4;">${title}</p>
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; margin:0; line-height:1.5;">${copy}</p>
                  </td>
                </tr>
              </table>`).join('')}
            </td>
          </tr>
          <tr>
            <td style="background-color:#F5F4F0; border-top:1px solid #EBEBEB; border-radius:0 0 12px 12px; padding:24px 40px;">
              <a href="https://www.nearwork.co" target="_blank" style="font-family:'Poppins', Arial, sans-serif; font-size:13px; font-weight:700; color:#111111; text-decoration:none; letter-spacing:-0.02em;">Nearwork</a>
              <span style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E;"> · Your team extension.</span>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E; margin:6px 0 0; line-height:1.6;">
                Questions? Reach us at <a href="mailto:support@nearwork.co" style="color:#16A085; text-decoration:none;">support@nearwork.co</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildClientOrgCreatedHtml(data) {
  const firstName = escapeHtml(firstNameFromData(data));
  const companyName = escapeHtml(data.companyName || data.orgName || 'your company');
  const setupLink = escapeHtml(data.setupLink || data.actionUrl || 'https://app.nearwork.co/invite');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Set up your Nearwork account</title>
</head>
<body style="margin:0; padding:0; background-color:#F5F4F0; font-family:'Poppins', Arial, sans-serif; -webkit-font-smoothing:antialiased;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; color:#F5F4F0; line-height:1px;">
    Your Nearwork workspace is ready, ${firstName}. Create your password and get started.&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F4F0;">
    <tr>
      <td align="center" style="padding:40px 16px 48px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px; width:100%; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.06);">
          <tr>
            <td style="background-color:#FFFFFF; padding:32px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:22px; font-weight:700; color:#111111; letter-spacing:-0.03em; line-height:1;">Nearwork</span>
                    <div style="width:68px; height:3px; background-color:#16A085; border-radius:2px; margin-top:4px;"></div>
                  </td>
                  <td align="right" valign="middle">
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:11px; color:#9E9E9E; letter-spacing:0.08em; text-transform:uppercase;">Client portal</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 0 40px;">
              <div style="height:4px; border-radius:2px; background:linear-gradient(90deg, #16A085 0%, #AF7AC5 60%, #E74C7C 100%);"></div>
            </td>
          </tr>
          <tr>
            <td style="background-color:#FFFFFF; padding:36px 40px 40px;">
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:40px; margin:0 0 16px 0; line-height:1;">🎉</p>
              <h1 style="font-family:'Poppins', Arial, sans-serif; font-size:26px; font-weight:700; color:#111111; letter-spacing:-0.02em; line-height:1.25; margin:0 0 14px 0;">Welcome to Nearwork, ${firstName}.</h1>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 10px 0;">
                Your organization workspace for <strong style="color:#111111;">${companyName}</strong> has been created on Nearwork. We're excited to start building your team together.
              </p>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 28px 0;">
                To get started, create your password using the button below and you'll have access to your company portal. 👇
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background-color:#F5F4F0; border-radius:10px; border-left:4px solid #16A085; padding:24px;">
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:11px; font-weight:600; color:#9E9E9E; letter-spacing:0.08em; text-transform:uppercase; margin:0 0 14px 0;">Your workspace</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
                      <tr>
                        <td width="50%">
                          <p style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E; margin:0 0 4px 0;">🏢 Organization</p>
                          <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; font-weight:600; color:#111111; margin:0;">${companyName}</p>
                        </td>
                        <td width="50%">
                          <p style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E; margin:0 0 4px 0;">🌐 Portal</p>
                          <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; font-weight:600; color:#111111; margin:0;">app.nearwork.co</p>
                        </td>
                      </tr>
                    </table>
                    <div style="border-top:1px solid #EBEBEB; margin:14px 0;"></div>
                    <span style="display:inline-block; font-family:'Poppins', Arial, sans-serif; font-size:12px; font-weight:600; color:#16A085; background-color:#E8F8F5; border-radius:999px; padding:4px 12px;">⏳ Awaiting password setup</span>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
                <tr>
                  <td style="border-radius:6px; background-color:#16A085;">
                    <a href="${setupLink}" target="_blank" style="display:inline-block; font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none; padding:13px 30px; border-radius:6px; letter-spacing:-0.01em;">Create my password →</a>
                  </td>
                </tr>
              </table>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E; margin:0 0 32px 0; line-height:1.6;">
                🔒 This link is unique to your account and should not be shared. If it expires, ask Nearwork to resend the invitation.
              </p>
              <div style="border-top:1px solid #EBEBEB; margin:0 0 28px;"></div>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:11px; font-weight:600; color:#16A085; letter-spacing:0.1em; text-transform:uppercase; margin:0 0 20px 0;">What you get with your portal</p>
              ${[
                ['👥', '#E8F8F5', 'Full pipeline visibility', "See every candidate we're working on for your roles — where they are, what's next, and when to expect updates."],
                ['📋', '#F3EEF8', 'Manage your open roles', 'Submit new roles, review requirements, and track progress all in one place.'],
                ['💬', '#FEF0F5', 'Direct line to your team', 'Your Nearwork team is always within reach. No back-and-forth emails — everything in the portal.']
              ].map(([icon, bg, title, copy]) => `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
                <tr>
                  <td valign="top" width="50" style="padding-right:14px;"><div style="width:38px; height:38px; border-radius:10px; background-color:${bg}; text-align:center; line-height:38px; font-size:20px;">${icon}</div></td>
                  <td valign="top"><p style="font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#111111; margin:0 0 3px 0; line-height:1.4;">${title}</p><p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; margin:0; line-height:1.5;">${copy}</p></td>
                </tr>
              </table>`).join('')}
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; line-height:1.6; margin:0;">🤝 We're genuinely excited to work with ${companyName}, ${firstName}. Let's build something great together.</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#F5F4F0; border-top:1px solid #EBEBEB; border-radius:0 0 12px 12px; padding:24px 40px;">
              <a href="https://www.nearwork.co" target="_blank" style="font-family:'Poppins', Arial, sans-serif; font-size:13px; font-weight:700; color:#111111; text-decoration:none; letter-spacing:-0.02em;">Nearwork</a>
              <span style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E;"> · Your team extension.</span>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E; margin:6px 0 0; line-height:1.6;">Questions? Reach us at <a href="mailto:support@nearwork.co" style="color:#16A085; text-decoration:none;">support@nearwork.co</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function roleTitleFromData(data = {}) {
  return String(data.roleTitle || data.openingTitle || data.jobTitle || data.role || 'this role').trim() || 'this role';
}

function buildApplicationSubmittedHtml(data) {
  const firstName = escapeHtml(firstNameFromData(data));
  const roleTitle = escapeHtml(roleTitleFromData(data));
  const actionUrl = escapeHtml(data.actionUrl || data.dashboardUrl || 'https://talent.nearwork.co');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Application received</title>
</head>
<body style="margin:0; padding:0; background-color:#F5F4F0; font-family:'Poppins', Arial, sans-serif; -webkit-font-smoothing:antialiased;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; color:#F5F4F0; line-height:1px;">
    We've received your application and our team is already on it. Talk soon.&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F4F0;">
    <tr>
      <td align="center" style="padding:40px 16px 48px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px; width:100%; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.06);">
          <tr>
            <td style="background-color:#FFFFFF; padding:32px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:22px; font-weight:700; color:#111111; letter-spacing:-0.03em; line-height:1;">Nearwork</span>
                    <div style="width:68px; height:3px; background-color:#16A085; border-radius:2px; margin-top:4px;"></div>
                  </td>
                  <td align="right" valign="middle">
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:11px; color:#9E9E9E; letter-spacing:0.08em; text-transform:uppercase;">Candidate portal</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 0 40px;">
              <div style="height:4px; border-radius:2px; background:linear-gradient(90deg, #16A085 0%, #AF7AC5 60%, #E74C7C 100%);"></div>
            </td>
          </tr>
          <tr>
            <td style="background-color:#FFFFFF; padding:36px 40px 40px;">
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:40px; margin:0 0 16px 0; line-height:1;">📩</p>
              <h1 style="font-family:'Poppins', Arial, sans-serif; font-size:26px; font-weight:700; color:#111111; letter-spacing:-0.02em; line-height:1.25; margin:0 0 14px 0;">
                We got your application, ${firstName}.
              </h1>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 10px 0;">
                Thanks for applying for the <strong style="color:#111111;">${roleTitle}</strong> role. Our Nearwork team will be reviewing your incredible experience and we'll be in touch soon.
              </p>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 32px 0;">
                In the meantime, you can log in to your portal at any time to track where your application stands. 👀
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background-color:#E8F8F5; border-radius:999px; padding:8px 20px;">
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:13px; font-weight:600; color:#16A085;">💼 ${roleTitle}</span>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-radius:6px; background-color:#16A085;">
                    <a href="${actionUrl}" target="_blank" style="display:inline-block; font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none; padding:13px 30px; border-radius:6px; letter-spacing:-0.01em;">
                      Track your application →
                    </a>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:36px 0 28px;">
                <tr><td style="border-top:1px solid #EBEBEB;"></td></tr>
              </table>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:11px; font-weight:600; color:#16A085; letter-spacing:0.1em; text-transform:uppercase; margin:0 0 20px 0;">What happens now</p>
              ${[
                ['🔍', '#E8F8F5', 'We review your profile', 'Our team carefully reviews your experience and assesses your fit for the role.'],
                ['💬', '#F3EEF8', 'We reach out', "If there's a strong match, a member of our team will contact you directly to move forward."],
                ['🚀', '#FEF0F5', 'The process begins', "You'll be guided through every step — interviews, assessments, and beyond."]
              ].map(([icon, bg, title, copy]) => `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
                <tr>
                  <td valign="top" width="50" style="padding-right:14px;">
                    <div style="width:38px; height:38px; border-radius:10px; background-color:${bg}; text-align:center; line-height:38px; font-size:20px;">${icon}</div>
                  </td>
                  <td valign="top">
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#111111; margin:0 0 3px 0; line-height:1.4;">${title}</p>
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; margin:0; line-height:1.5;">${copy}</p>
                  </td>
                </tr>
              </table>`).join('')}
            </td>
          </tr>
          <tr>
            <td style="background-color:#F5F4F0; border-top:1px solid #EBEBEB; border-radius:0 0 12px 12px; padding:24px 40px;">
              <a href="https://www.nearwork.co" target="_blank" style="font-family:'Poppins', Arial, sans-serif; font-size:13px; font-weight:700; color:#111111; text-decoration:none; letter-spacing:-0.02em;">Nearwork</a>
              <span style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E;"> · Your team extension.</span>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E; margin:6px 0 0; line-height:1.6;">
                Questions? Reach us at <a href="mailto:support@nearwork.co" style="color:#16A085; text-decoration:none;">support@nearwork.co</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildJobAlertHtml(data) {
  const firstName = escapeHtml(firstNameFromData(data));
  const roleTitle = escapeHtml(roleTitleFromData(data));
  const jobUrl = escapeHtml(data.jobUrl || data.actionUrl || 'https://jobs.nearwork.co');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>A role that matches your skills just opened up</title>
</head>
<body style="margin:0; padding:0; background-color:#F5F4F0; font-family:'Poppins', Arial, sans-serif; -webkit-font-smoothing:antialiased;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; color:#F5F4F0; line-height:1px;">
    A new role just opened up that matches your skills — take a look before it fills up.&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F4F0;">
    <tr>
      <td align="center" style="padding:40px 16px 48px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px; width:100%; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.06);">
          <tr>
            <td style="background-color:#FFFFFF; padding:32px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:22px; font-weight:700; color:#111111; letter-spacing:-0.03em; line-height:1;">Nearwork</span>
                    <div style="width:68px; height:3px; background-color:#16A085; border-radius:2px; margin-top:4px;"></div>
                  </td>
                  <td align="right" valign="middle">
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:11px; color:#9E9E9E; letter-spacing:0.08em; text-transform:uppercase;">Candidate portal</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 0 40px;">
              <div style="height:4px; border-radius:2px; background:linear-gradient(90deg, #16A085 0%, #AF7AC5 60%, #E74C7C 100%);"></div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:#E8F8F5; border-radius:8px; padding:12px 18px;">
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:12px; font-weight:600; color:#16A085; letter-spacing:0.06em; text-transform:uppercase;">⚡ New role alert</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#FFFFFF; padding:28px 40px 40px;">
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:40px; margin:0 0 16px 0; line-height:1;">🎯</p>
              <h1 style="font-family:'Poppins', Arial, sans-serif; font-size:26px; font-weight:700; color:#111111; letter-spacing:-0.02em; line-height:1.25; margin:0 0 14px 0;">
                ${firstName}, this one looks like you.
              </h1>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 10px 0;">
                A new role just opened up that matches your skills and experience. We thought you should know about it before it fills up.
              </p>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 28px 0;">
                Take a look and apply directly from your portal. 👇
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background-color:#F5F4F0; border-radius:10px; border-left:4px solid #16A085; padding:20px 24px;">
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:11px; font-weight:600; color:#9E9E9E; letter-spacing:0.08em; text-transform:uppercase; margin:0 0 6px 0;">Open role</p>
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:18px; font-weight:700; color:#111111; letter-spacing:-0.02em; margin:0 0 10px 0;">💼 ${roleTitle}</p>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background-color:#E8F8F5; border-radius:999px; padding:4px 12px;">
                          <span style="font-family:'Poppins', Arial, sans-serif; font-size:12px; font-weight:600; color:#16A085;">✅ Matches your profile</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-radius:6px; background-color:#16A085;">
                    <a href="${jobUrl}" target="_blank" style="display:inline-block; font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none; padding:13px 30px; border-radius:6px; letter-spacing:-0.01em;">View this role →</a>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:36px 0 24px;">
                <tr><td style="border-top:1px solid #EBEBEB;"></td></tr>
              </table>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; line-height:1.6; margin:0;">🕐 Roles at Nearwork move fast. If this one looks right, don't wait — apply today and our team will take it from there.</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#F5F4F0; border-top:1px solid #EBEBEB; border-radius:0 0 12px 12px; padding:24px 40px;">
              <a href="https://www.nearwork.co" target="_blank" style="font-family:'Poppins', Arial, sans-serif; font-size:13px; font-weight:700; color:#111111; text-decoration:none; letter-spacing:-0.02em;">Nearwork</a>
              <span style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E;"> · Your team extension.</span>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E; margin:6px 0 0; line-height:1.6;">
                Questions? Reach us at <a href="mailto:support@nearwork.co" style="color:#16A085; text-decoration:none;">support@nearwork.co</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildPipelineProfileReviewHtml(data) {
  const firstName = escapeHtml(firstNameFromData(data));
  const roleTitle = escapeHtml(roleTitleFromData(data));
  const actionUrl = escapeHtml(data.actionUrl || data.dashboardUrl || 'https://talent.nearwork.co');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Your profile is under review</title>
</head>
<body style="margin:0; padding:0; background-color:#F5F4F0; font-family:'Poppins', Arial, sans-serif; -webkit-font-smoothing:antialiased;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; color:#F5F4F0; line-height:1px;">
    Good news — you've been added to the pipeline. Our team is reviewing your profile now.&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F4F0;">
    <tr>
      <td align="center" style="padding:40px 16px 48px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px; width:100%; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.06);">
          <tr>
            <td style="background-color:#FFFFFF; padding:32px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:22px; font-weight:700; color:#111111; letter-spacing:-0.03em; line-height:1;">Nearwork</span>
                    <div style="width:68px; height:3px; background-color:#16A085; border-radius:2px; margin-top:4px;"></div>
                  </td>
                  <td align="right" valign="middle">
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:11px; color:#9E9E9E; letter-spacing:0.08em; text-transform:uppercase;">Candidate portal</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 0 40px;">
              <div style="height:4px; border-radius:2px; background:linear-gradient(90deg, #16A085 0%, #AF7AC5 60%, #E74C7C 100%);"></div>
            </td>
          </tr>
          <tr>
            <td style="background-color:#FFFFFF; padding:36px 40px 40px;">
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:40px; margin:0 0 16px 0; line-height:1;">🌟</p>
              <h1 style="font-family:'Poppins', Arial, sans-serif; font-size:26px; font-weight:700; color:#111111; letter-spacing:-0.02em; line-height:1.25; margin:0 0 14px 0;">You're in the pipeline, ${firstName}.</h1>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 10px 0;">
                Great news — our team has reviewed your profile and you've been added to the pipeline for the <strong style="color:#111111;">${roleTitle}</strong> role.
              </p>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 28px 0;">
                We're currently doing a deeper review of your experience and background. You'll hear from us soon with more details on the next steps. 🙌
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background-color:#F5F4F0; border-radius:10px; border-left:4px solid #AF7AC5; padding:20px 24px;">
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:11px; font-weight:600; color:#9E9E9E; letter-spacing:0.08em; text-transform:uppercase; margin:0 0 6px 0;">Active pipeline</p>
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:18px; font-weight:700; color:#111111; letter-spacing:-0.02em; margin:0 0 12px 0;">💼 ${roleTitle}</p>
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:11px; color:#9E9E9E; margin:0 0 8px 0;">Your current stage</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">
                      <tr>
                        <td width="20%" style="padding-right:4px;"><div style="height:6px; border-radius:3px; background-color:#16A085;"></div></td>
                        <td width="20%" style="padding-right:4px;"><div style="height:6px; border-radius:3px; background-color:#EBEBEB;"></div></td>
                        <td width="20%" style="padding-right:4px;"><div style="height:6px; border-radius:3px; background-color:#EBEBEB;"></div></td>
                        <td width="20%" style="padding-right:4px;"><div style="height:6px; border-radius:3px; background-color:#EBEBEB;"></div></td>
                        <td width="20%"><div style="height:6px; border-radius:3px; background-color:#EBEBEB;"></div></td>
                      </tr>
                    </table>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr><td style="background-color:#E8F8F5; border-radius:999px; padding:4px 12px;"><span style="font-family:'Poppins', Arial, sans-serif; font-size:12px; font-weight:600; color:#16A085;">Stage 1 — Profile review</span></td></tr>
                    </table>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-radius:6px; background-color:#16A085;"><a href="${actionUrl}" target="_blank" style="display:inline-block; font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none; padding:13px 30px; border-radius:6px; letter-spacing:-0.01em;">Track your status →</a></td></tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:36px 0 28px;"><tr><td style="border-top:1px solid #EBEBEB;"></td></tr></table>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:11px; font-weight:600; color:#16A085; letter-spacing:0.1em; text-transform:uppercase; margin:0 0 20px 0;">What to expect</p>
              ${[
                ['🔍', '#E8F8F5', 'Profile review in progress', 'Our team is taking a close look at your experience, skills, and background right now.'],
                ['📬', '#F3EEF8', 'More information coming', "Once we complete the review, you'll receive an email with your next steps and what to prepare."],
                ['💪', '#FEF0F5', 'Keep your profile up to date', 'Make sure your skills and experience in the portal reflect your latest work — it matters.']
              ].map(([icon, bg, title, copy]) => `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
                <tr>
                  <td valign="top" width="50" style="padding-right:14px;"><div style="width:38px; height:38px; border-radius:10px; background-color:${bg}; text-align:center; line-height:38px; font-size:20px;">${icon}</div></td>
                  <td valign="top"><p style="font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#111111; margin:0 0 3px 0; line-height:1.4;">${title}</p><p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; margin:0; line-height:1.5;">${copy}</p></td>
                </tr>
              </table>`).join('')}
            </td>
          </tr>
          <tr>
            <td style="background-color:#F5F4F0; border-top:1px solid #EBEBEB; border-radius:0 0 12px 12px; padding:24px 40px;">
              <a href="https://www.nearwork.co" target="_blank" style="font-family:'Poppins', Arial, sans-serif; font-size:13px; font-weight:700; color:#111111; text-decoration:none; letter-spacing:-0.02em;">Nearwork</a>
              <span style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E;"> · Your team extension.</span>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E; margin:6px 0 0; line-height:1.6;">Questions? Reach us at <a href="mailto:support@nearwork.co" style="color:#16A085; text-decoration:none;">support@nearwork.co</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildAssessmentAssignedHtml(data) {
  const firstName = escapeHtml(firstNameFromData(data));
  const roleTitle = escapeHtml(roleTitleFromData(data));
  const assessmentUrl = escapeHtml(data.assessmentUrl || data.actionUrl || data.dashboardUrl || 'https://talent.nearwork.co/assessment');
  const deadline = escapeHtml(data.deadline || '24 hours after assignment');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Your assessment is ready</title>
</head>
<body style="margin:0; padding:0; background-color:#F5F4F0; font-family:'Poppins', Arial, sans-serif; -webkit-font-smoothing:antialiased;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; color:#F5F4F0; line-height:1px;">
    Your assessment is ready. You have 24 hours to complete it — find a quiet spot and give it your best.&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F4F0;">
    <tr>
      <td align="center" style="padding:40px 16px 48px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px; width:100%; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.06);">
          <tr>
            <td style="background-color:#FFFFFF; padding:32px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:22px; font-weight:700; color:#111111; letter-spacing:-0.03em; line-height:1;">Nearwork</span>
                    <div style="width:68px; height:3px; background-color:#16A085; border-radius:2px; margin-top:4px;"></div>
                  </td>
                  <td align="right" valign="middle">
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:11px; color:#9E9E9E; letter-spacing:0.08em; text-transform:uppercase;">Candidate portal</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 0 40px;">
              <div style="height:4px; border-radius:2px; background:linear-gradient(90deg, #16A085 0%, #AF7AC5 60%, #E74C7C 100%);"></div>
            </td>
          </tr>
          <tr>
            <td style="background-color:#FFFFFF; padding:36px 40px 40px;">
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:40px; margin:0 0 16px 0; line-height:1;">📝</p>
              <h1 style="font-family:'Poppins', Arial, sans-serif; font-size:26px; font-weight:700; color:#111111; letter-spacing:-0.02em; line-height:1.25; margin:0 0 14px 0;">Time to shine, ${firstName}.</h1>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 10px 0;">
                Your assessment for the <strong style="color:#111111;">${roleTitle}</strong> role is ready. This helps us understand your technical fit, work style, and how we can best support your next step.
              </p>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 28px 0;">
                You have <strong style="color:#111111;">24 hours</strong> to complete it once assigned. Make sure you are logged into your Nearwork account before starting.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="border-radius:6px; background-color:#16A085;">
                    <a href="${assessmentUrl}" target="_blank" style="display:inline-block; font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none; padding:13px 30px; border-radius:6px; letter-spacing:-0.01em;">Start my assessment →</a>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background-color:#FEF7E8; border-radius:10px; border-left:4px solid #F39C12; padding:18px 22px;">
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:12px; font-weight:700; color:#B56B00; letter-spacing:0.08em; text-transform:uppercase; margin:0 0 8px 0;">Important</p>
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#555555; line-height:1.6; margin:0;">
                      Complete by: <strong style="color:#111111;">${deadline}</strong>. Find a quiet space, use a stable connection, and keep the assessment open until each section is submitted.
                    </p>
                  </td>
                </tr>
              </table>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:11px; font-weight:600; color:#16A085; letter-spacing:0.1em; text-transform:uppercase; margin:0 0 20px 0;">What you'll complete</p>
              ${[
                ['💻', '#E8F8F5', 'Technical assessment', 'Role-specific multiple choice questions selected from the skills required for this opening.'],
                ['🧭', '#F3EEF8', 'DISC personality section', 'Work-style questions that help us understand communication, collaboration, and team fit.'],
                ['⏱️', '#FEF0F5', 'Timed sections', 'You will have time limits for each section, so start only when you are ready to focus.']
              ].map(([icon, bg, title, copy]) => `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
                <tr>
                  <td valign="top" width="50" style="padding-right:14px;"><div style="width:38px; height:38px; border-radius:10px; background-color:${bg}; text-align:center; line-height:38px; font-size:20px;">${icon}</div></td>
                  <td valign="top"><p style="font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#111111; margin:0 0 3px 0; line-height:1.4;">${title}</p><p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; margin:0; line-height:1.5;">${copy}</p></td>
                </tr>
              </table>`).join('')}
            </td>
          </tr>
          <tr>
            <td style="background-color:#F5F4F0; border-top:1px solid #EBEBEB; border-radius:0 0 12px 12px; padding:24px 40px;">
              <a href="https://www.nearwork.co" target="_blank" style="font-family:'Poppins', Arial, sans-serif; font-size:13px; font-weight:700; color:#111111; text-decoration:none; letter-spacing:-0.02em;">Nearwork</a>
              <span style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E;"> · Your team extension.</span>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E; margin:6px 0 0; line-height:1.6;">Questions? Reach us at <a href="mailto:support@nearwork.co" style="color:#16A085; text-decoration:none;">support@nearwork.co</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildInterviewStageHtml(data) {
  const firstName = escapeHtml(firstNameFromData(data));
  const roleTitle = escapeHtml(roleTitleFromData(data));
  const bookingUrl = escapeHtml(data.bookingUrl || data.actionUrl || data.dashboardUrl || 'https://talent.nearwork.co');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Time to meet the team</title>
</head>
<body style="margin:0; padding:0; background-color:#F5F4F0; font-family:'Poppins', Arial, sans-serif; -webkit-font-smoothing:antialiased;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; color:#F5F4F0; line-height:1px;">
    You're moving forward, ${firstName}. Book your interview now — the sooner the better.&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F4F0;">
    <tr>
      <td align="center" style="padding:40px 16px 48px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px; width:100%; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.06);">
          <tr>
            <td style="background-color:#FFFFFF; padding:32px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:22px; font-weight:700; color:#111111; letter-spacing:-0.03em; line-height:1;">Nearwork</span>
                    <div style="width:68px; height:3px; background-color:#16A085; border-radius:2px; margin-top:4px;"></div>
                  </td>
                  <td align="right" valign="middle"><span style="font-family:'Poppins', Arial, sans-serif; font-size:11px; color:#9E9E9E; letter-spacing:0.08em; text-transform:uppercase;">Candidate portal</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td style="padding:20px 40px 0 40px;"><div style="height:4px; border-radius:2px; background:linear-gradient(90deg, #16A085 0%, #AF7AC5 60%, #E74C7C 100%);"></div></td></tr>
          <tr>
            <td style="background-color:#FFFFFF; padding:36px 40px 40px;">
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:40px; margin:0 0 16px 0; line-height:1;">🤝</p>
              <h1 style="font-family:'Poppins', Arial, sans-serif; font-size:26px; font-weight:700; color:#111111; letter-spacing:-0.02em; line-height:1.25; margin:0 0 14px 0;">Let's talk, ${firstName}.</h1>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 10px 0;">
                You've made it to the interview stage for the <strong style="color:#111111;">${roleTitle}</strong> role — and honestly, we're excited to meet you. This is a big step and you've earned it.
              </p>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 28px 0;">
                Head to your portal and book a call with your recruiter directly. The sooner you lock in a time, the better your chances of securing the best slot. 📅
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr><td style="border-radius:6px; background-color:#16A085;"><a href="${bookingUrl}" target="_blank" style="display:inline-block; font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none; padding:13px 30px; border-radius:6px; letter-spacing:-0.01em;">Book my interview →</a></td></tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background-color:#E8F8F5; border-radius:10px; border-left:4px solid #16A085; padding:20px 24px;">
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:12px; font-weight:600; color:#16A085; letter-spacing:0.08em; text-transform:uppercase; margin:0 0 10px 0;">⚡ Don't wait on this one, ${firstName}</p>
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#555555; margin:0; line-height:1.6;">Candidates who book early show initiative — and that matters to the companies you're interviewing with. The faster you move, the more opportunities stay open for you.</p>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;"><tr><td style="border-top:1px solid #EBEBEB;"></td></tr></table>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:11px; font-weight:600; color:#16A085; letter-spacing:0.1em; text-transform:uppercase; margin:0 0 20px 0;">How to book your interview</p>
              ${[
                ['🔑', '#E8F8F5', 'Sign in to your portal', 'Head to talent.nearwork.co and log in to your candidate account.'],
                ['👤', '#F3EEF8', 'Go to the recruiter section', 'Find your assigned recruiter and open their availability calendar.'],
                ['📅', '#FEF0F5', 'Pick your slot and confirm', "Choose a time that works best for you and lock it in. You'll get a confirmation right away."]
              ].map(([icon, bg, title, copy]) => `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
                <tr>
                  <td valign="top" width="50" style="padding-right:14px;"><div style="width:38px; height:38px; border-radius:10px; background-color:${bg}; text-align:center; line-height:38px; font-size:20px;">${icon}</div></td>
                  <td valign="top"><p style="font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#111111; margin:0 0 3px 0; line-height:1.4;">${title}</p><p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; margin:0; line-height:1.5;">${copy}</p></td>
                </tr>
              </table>`).join('')}
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; line-height:1.6; margin:0;">💪 You've worked hard to get here, ${firstName}. Now go show them what you've got. We're in your corner every step of the way.</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#F5F4F0; border-top:1px solid #EBEBEB; border-radius:0 0 12px 12px; padding:24px 40px;">
              <a href="https://www.nearwork.co" target="_blank" style="font-family:'Poppins', Arial, sans-serif; font-size:13px; font-weight:700; color:#111111; text-decoration:none; letter-spacing:-0.02em;">Nearwork</a>
              <span style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E;"> · Your team extension.</span>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E; margin:6px 0 0; line-height:1.6;">Questions? Reach us at <a href="mailto:support@nearwork.co" style="color:#16A085; text-decoration:none;">support@nearwork.co</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildClientInviteSimpleHtml(data) {
  const firstName = escapeHtml(firstNameFromData(data));
  const companyName = escapeHtml(data.companyName || data.orgName || 'your company');
  const setupLink = escapeHtml(data.setupLink || data.actionUrl || 'https://app.nearwork.co/invite');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Nearwork client portal is ready</title>
  </head>
  <body style="margin:0;background:#F5F4F0;font-family:Arial,sans-serif;color:#111111;">
    <div style="max-width:620px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border:1px solid #EBEBEB;border-radius:14px;padding:32px;">
        <div style="font-size:22px;font-weight:800;letter-spacing:-.03em;">Nearwork</div>
        <div style="width:68px;height:3px;background:#16A085;border-radius:2px;margin:6px 0 28px;"></div>
        <p style="font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#12866E;margin:0 0 12px;">Client portal</p>
        <h1 style="font-size:28px;line-height:1.2;margin:0 0 14px;">Welcome to Nearwork, ${firstName}.</h1>
        <p style="font-size:15px;line-height:1.7;color:#555555;margin:0 0 18px;">Your workspace for <strong>${companyName}</strong> is ready. Create your password to access candidates, openings, notes, and updates from the Nearwork team.</p>
        <p style="font-size:15px;line-height:1.7;color:#555555;margin:0 0 26px;">This link is for the Nearwork client portal.</p>
        <a href="${setupLink}" target="_blank" style="display:inline-block;background:#16A085;color:#ffffff;text-decoration:none;border-radius:8px;padding:13px 24px;font-size:14px;font-weight:800;">Create my password</a>
        <p style="font-size:12px;line-height:1.6;color:#777777;margin:26px 0 0;">If the button does not work, copy and paste this link into your browser:<br><a href="${setupLink}" style="color:#12866E;word-break:break-all;">${setupLink}</a></p>
        <p style="font-size:12px;line-height:1.6;color:#777777;margin:18px 0 0;">Questions? Contact <a href="mailto:support@nearwork.co" style="color:#12866E;">support@nearwork.co</a>.</p>
      </div>
    </div>
  </body>
</html>`;
}

function buildHtml(template, data) {
  if (data.templateId === 'account_created') return buildAccountCreatedHtml(data);
  if (data.templateId === 'account_invitation' || data.templateId === 'client_org_created') return buildClientInviteSimpleHtml(data);
  if (data.templateId === 'job_applied') return buildApplicationSubmittedHtml(data);
  if (data.templateId === 'job_alert') return buildJobAlertHtml(data);
  if (data.templateId === 'pipeline_profile_review') return buildPipelineProfileReviewHtml(data);
  if (data.templateId === 'assessment_assigned') return buildAssessmentAssignedHtml(data);
  if (data.templateId === 'book_recruiter') return buildInterviewStageHtml(data);
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

function buildPlainText(template, data) {
  const firstName = firstNameFromData(data);
  const orgName = data.orgName || data.companyName || 'your company';
  const actionUrl = data.setupLink || data.actionUrl || data.dashboardUrl || 'https://app.nearwork.co';
  if (data.templateId === 'account_invitation' || data.templateId === 'client_org_created') {
    return [
      `Hi ${firstName},`,
      '',
      `Your Nearwork workspace for ${orgName} is ready.`,
      'Create your client portal password using this link:',
      actionUrl,
      '',
      'This is for the Nearwork client portal.',
      '',
      'Questions? Contact support@nearwork.co',
      '',
      'Nearwork Team'
    ].join('\n');
  }
  return [
    `Hi ${firstName},`,
    '',
    template.body,
    '',
    actionUrl,
    '',
    'Questions? Contact support@nearwork.co',
    '',
    'Nearwork Team'
  ].join('\n');
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

  const html = buildHtml(template, { ...data, templateId });
  const payload = {
    from: `Nearwork <${fromEmail}>`,
    to: Array.isArray(to) ? to : [to],
    reply_to: replyTo,
    subject: personalizeSubject(subject || template.subject, data),
    html,
    text: buildPlainText(template, { ...data, templateId })
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
