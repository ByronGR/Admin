// ─── similar_role_alert ───────────────────────────────────────────────────────
// Sent to a candidate when a new role opens that matches their skills/profile.
// Triggered by: Admin (manually or automated when a new opening is published)
//
// Required data: { firstName, roleTitle, jobUrl }

import { fill } from './_base';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>A role that matches your skills just opened up</title>
</head>
<body style="margin:0; padding:0; background-color:#F5F4F0; font-family:'Poppins', Arial, sans-serif; -webkit-font-smoothing:antialiased;">

  <!-- Preheader -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; color:#F5F4F0; line-height:1px;">
    A new role just opened up that matches your skills — take a look before it fills up.&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;
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

          <!-- ALERT BANNER -->
          <tr>
            <td style="padding:28px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:#E8F8F5; border-radius:8px; padding:12px 18px;">
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:12px; font-weight:600; color:#16A085; letter-spacing:0.06em; text-transform:uppercase;">&#9889; New role alert</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="background-color:#FFFFFF; padding:28px 40px 40px;">

              <p style="font-family:'Poppins', Arial, sans-serif; font-size:40px; margin:0 0 16px 0; line-height:1;">&#127919;</p>
              <h1 style="font-family:'Poppins', Arial, sans-serif; font-size:26px; font-weight:700; color:#111111; letter-spacing:-0.02em; line-height:1.25; margin:0 0 14px 0;">
                {firstName}, this one looks like you.
              </h1>

              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 10px 0;">
                A new role just opened up that matches your skills and experience. We thought you should know about it before it fills up.
              </p>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 28px 0;">
                Take a look and apply directly from your portal. &#128071;
              </p>

              <!-- Role card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background-color:#F5F4F0; border-radius:10px; border-left:4px solid #16A085; padding:20px 24px;">
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:11px; font-weight:600; color:#9E9E9E; letter-spacing:0.08em; text-transform:uppercase; margin:0 0 6px 0;">Open role</p>
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:18px; font-weight:700; color:#111111; letter-spacing:-0.02em; margin:0 0 10px 0;">&#128188; {roleTitle}</p>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background-color:#E8F8F5; border-radius:999px; padding:4px 12px;">
                          <span style="font-family:'Poppins', Arial, sans-serif; font-size:12px; font-weight:600; color:#16A085;">&#9989; Matches your profile</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-radius:6px; background-color:#16A085;">
                    <a href="{jobUrl}" target="_blank"
                      style="display:inline-block; font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none; padding:13px 30px; border-radius:6px; letter-spacing:-0.01em;">
                      View this role &#8594;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:36px 0 24px;">
                <tr>
                  <td style="border-top:1px solid #EBEBEB;"></td>
                </tr>
              </table>

              <!-- Fine print nudge -->
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; line-height:1.6; margin:0;">
                &#128336; Roles at Nearwork move fast. If this one looks right, don't wait — apply today and our team will take it from there.
              </p>

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
    roleTitle:  data.roleTitle || 'a new role',
    jobUrl:     data.jobUrl    || 'https://jobs.nearwork.co',
  };
  return {
    subject: `${d.roleTitle} — a role that matches your profile`,
    html: fill(HTML, d),
  };
}
