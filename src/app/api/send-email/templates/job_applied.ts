// ─── job_applied ─────────────────────────────────────────────────────────────
// Sent to a candidate immediately after they submit an application.
// Triggered by: jobs.nearwork.co (submit-application.js) and
//               talent.nearwork.co (applyToJob in firebase.js)
//
// Required data: { firstName, roleTitle }

import { fill } from './_base';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Application received</title>
</head>
<body style="margin:0; padding:0; background-color:#F5F4F0; font-family:'Poppins', Arial, sans-serif; -webkit-font-smoothing:antialiased;">

  <!-- Preheader -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; color:#F5F4F0; line-height:1px;">
    We've received your application and our team is already on it. Talk soon.&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;
  </div>

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F4F0;">
    <tr>
      <td align="center" style="padding:40px 16px 48px;">

        <!-- Email card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px; width:100%; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.06);">

          <!-- HEADER -->
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

          <!-- ACCENT BAR -->
          <tr>
            <td style="padding:20px 40px 0 40px;">
              <div style="height:4px; border-radius:2px; background: linear-gradient(90deg, #16A085 0%, #AF7AC5 60%, #E74C7C 100%);"></div>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="background-color:#FFFFFF; padding:36px 40px 40px;">

              <p style="font-family:'Poppins', Arial, sans-serif; font-size:40px; margin:0 0 16px 0; line-height:1;">&#128233;</p>
              <h1 style="font-family:'Poppins', Arial, sans-serif; font-size:26px; font-weight:700; color:#111111; letter-spacing:-0.02em; line-height:1.25; margin:0 0 14px 0;">
                We got your application, {firstName}.
              </h1>

              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 10px 0;">
                Thanks for applying for the <strong style="color:#111111;">{roleTitle}</strong> role. Our Nearwork team will be reviewing your incredible experience and we'll be in touch soon.
              </p>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 32px 0;">
                In the meantime, you can log in to your portal at any time to track where your application stands. &#128064;
              </p>

              <!-- Role pill -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background-color:#E8F8F5; border-radius:999px; padding:8px 20px;">
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:13px; font-weight:600; color:#16A085;">&#128188; {roleTitle}</span>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-radius:6px; background-color:#16A085;">
                    <a href="https://talent.nearwork.co" target="_blank"
                      style="display:inline-block; font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none; padding:13px 30px; border-radius:6px; letter-spacing:-0.01em;">
                      Track your application &#8594;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:36px 0 28px;">
                <tr><td style="border-top:1px solid #EBEBEB;"></td></tr>
              </table>

              <!-- What happens now -->
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:11px; font-weight:600; color:#16A085; letter-spacing:0.1em; text-transform:uppercase; margin:0 0 20px 0;">
                What happens now
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
                <tr>
                  <td valign="top" width="50" style="padding-right:14px;">
                    <div style="width:38px; height:38px; border-radius:10px; background-color:#E8F8F5; text-align:center; line-height:38px; font-size:20px;">&#128269;</div>
                  </td>
                  <td valign="top">
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#111111; margin:0 0 3px 0; line-height:1.4;">We review your profile</p>
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; margin:0; line-height:1.5;">Our team carefully reviews your experience and assesses your fit for the role.</p>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
                <tr>
                  <td valign="top" width="50" style="padding-right:14px;">
                    <div style="width:38px; height:38px; border-radius:10px; background-color:#F3EEF8; text-align:center; line-height:38px; font-size:20px;">&#128172;</div>
                  </td>
                  <td valign="top">
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#111111; margin:0 0 3px 0; line-height:1.4;">We reach out</p>
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; margin:0; line-height:1.5;">If there's a strong match, a member of our team will contact you directly to move forward.</p>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="top" width="50" style="padding-right:14px;">
                    <div style="width:38px; height:38px; border-radius:10px; background-color:#FEF0F5; text-align:center; line-height:38px; font-size:20px;">&#128640;</div>
                  </td>
                  <td valign="top">
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#111111; margin:0 0 3px 0; line-height:1.4;">The process begins</p>
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; margin:0; line-height:1.5;">You'll be guided through every step — interviews, assessments, and beyond.</p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background-color:#F5F4F0; border-top:1px solid #EBEBEB; border-radius:0 0 12px 12px; padding:24px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <a href="https://www.nearwork.co" target="_blank" style="font-family:'Poppins', Arial, sans-serif; font-size:13px; font-weight:700; color:#111111; text-decoration:none; letter-spacing:-0.02em;">Nearwork</a>
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E;"> &middot; Your team extension.</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:6px;">
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E; margin:0; line-height:1.6;">
                      Questions? Reach us at <a href="mailto:support@nearwork.co" style="color:#16A085; text-decoration:none;">support@nearwork.co</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;

export function build(data: Record<string, string>): { subject: string; html: string } {
  const d = {
    firstName: data.firstName || data.name?.split(' ')[0] || 'there',
    roleTitle:  data.roleTitle || 'this role',
  };
  return {
    subject: `We received your application — ${d.roleTitle}`,
    html: fill(HTML, d),
  };
}
