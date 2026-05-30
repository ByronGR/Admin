// ─── Client invite email template ─────────────────────────────────────────────
// Placeholders: {{firstName}} {{companyName}} {{setupLink}}

export const INVITE_EMAIL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Set up your Nearwork account</title>
</head>
<body style="margin:0; padding:0; background-color:#F5F4F0; font-family:'Poppins', Arial, sans-serif; -webkit-font-smoothing:antialiased;">

  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; color:#F5F4F0; line-height:1px;">
    Your Nearwork workspace is ready. Create your password and get started.&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;
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
              <div style="height:4px; border-radius:2px; background: linear-gradient(90deg, #16A085 0%, #AF7AC5 60%, #E74C7C 100%);"></div>
            </td>
          </tr>

          <tr>
            <td style="background-color:#FFFFFF; padding:36px 40px 40px;">

              <p style="font-family:'Poppins', Arial, sans-serif; font-size:40px; margin:0 0 16px 0; line-height:1;">&#127881;</p>
              <h1 style="font-family:'Poppins', Arial, sans-serif; font-size:26px; font-weight:700; color:#111111; letter-spacing:-0.02em; line-height:1.25; margin:0 0 14px 0;">
                Welcome to Nearwork! Your account is almost ready.
              </h1>

              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 10px 0;">
                Your organization workspace for <strong style="color:#111111;">{{companyName}}</strong> has been created on Nearwork. We&apos;re excited to start building your team together.
              </p>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 28px 0;">
                To get started, create your password using the button below and you&apos;ll have full access to your client portal right away. &#128071;
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background-color:#F5F4F0; border-radius:10px; border-left:4px solid #16A085; padding:24px;">
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:11px; font-weight:600; color:#9E9E9E; letter-spacing:0.08em; text-transform:uppercase; margin:0 0 14px 0;">Your workspace</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
                      <tr>
                        <td width="50%">
                          <p style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E; margin:0 0 4px 0;">&#127970; Organization</p>
                          <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; font-weight:600; color:#111111; margin:0;">{{companyName}}</p>
                        </td>
                        <td width="50%">
                          <p style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E; margin:0 0 4px 0;">&#127760; Portal</p>
                          <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; font-weight:600; color:#111111; margin:0;">app.nearwork.co</p>
                        </td>
                      </tr>
                    </table>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0;">
                      <tr><td style="border-top:1px solid #EBEBEB;"></td></tr>
                    </table>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background-color:#E8F8F5; border-radius:999px; padding:4px 12px;">
                          <span style="font-family:'Poppins', Arial, sans-serif; font-size:12px; font-weight:600; color:#16A085;">&#9203; Awaiting password setup</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
                <tr>
                  <td style="border-radius:6px; background-color:#16A085;">
                    <a href="{{setupLink}}" target="_blank"
                      style="display:inline-block; font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none; padding:13px 30px; border-radius:6px; letter-spacing:-0.01em;">
                      Create my password &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E; margin:0 0 32px 0; line-height:1.6;">
                &#128274; This link is unique to your account and expires in 7 days. Do not share it. If it expires, contact us and we&apos;ll send a new one.
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
                <tr><td style="border-top:1px solid #EBEBEB;"></td></tr>
              </table>

              <p style="font-family:'Poppins', Arial, sans-serif; font-size:11px; font-weight:600; color:#16A085; letter-spacing:0.1em; text-transform:uppercase; margin:0 0 20px 0;">
                What you get with your portal
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
                <tr>
                  <td valign="top" width="50" style="padding-right:14px;">
                    <div style="width:38px; height:38px; border-radius:10px; background-color:#E8F8F5; text-align:center; line-height:38px; font-size:20px;">&#128101;</div>
                  </td>
                  <td valign="top">
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#111111; margin:0 0 3px 0; line-height:1.4;">Full pipeline visibility</p>
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; margin:0; line-height:1.5;">See every candidate we&apos;re working on for your roles &mdash; where they are, what&apos;s next, and when to expect updates.</p>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
                <tr>
                  <td valign="top" width="50" style="padding-right:14px;">
                    <div style="width:38px; height:38px; border-radius:10px; background-color:#F3EEF8; text-align:center; line-height:38px; font-size:20px;">&#128203;</div>
                  </td>
                  <td valign="top">
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#111111; margin:0 0 3px 0; line-height:1.4;">Manage your open roles</p>
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; margin:0; line-height:1.5;">Submit new roles, review requirements, and track progress all in one place.</p>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
                <tr>
                  <td valign="top" width="50" style="padding-right:14px;">
                    <div style="width:38px; height:38px; border-radius:10px; background-color:#FEF0F5; text-align:center; line-height:38px; font-size:20px;">&#128172;</div>
                  </td>
                  <td valign="top">
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#111111; margin:0 0 3px 0; line-height:1.4;">Direct line to your team</p>
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; margin:0; line-height:1.5;">Your Nearwork team is always within reach. No back-and-forth emails &mdash; everything in the portal.</p>
                  </td>
                </tr>
              </table>

              <p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; line-height:1.6; margin:0;">
                &#129309; We&apos;re genuinely excited to work with {{companyName}}. Let&apos;s build something great together.
              </p>

            </td>
          </tr>

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

export function buildInviteEmail(firstName: string, companyName: string, setupLink: string): string {
  return INVITE_EMAIL_HTML
    .replace(/{{firstName}}/g, firstName)
    .replace(/{{companyName}}/g, companyName)
    .replace(/{{setupLink}}/g, setupLink);
}
