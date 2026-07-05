// ─── Notification digest email template ──────────────────────────────────────
// Verbatim copy of Byron's Handlebars template
// (nearwork_email_notification_digest.html). Rendered by the tiny renderer in
// notification-digest.ts — it supports ONLY these constructs, which is all this
// template uses:
//   {{var}}   {{#each items}}…{{/each}}   {{#if item_body}}…{{/if}}   {{#if item_link}}…{{/if}}
//
// Do NOT introduce a Handlebars dependency. If this template changes, keep it to
// those same constructs.

export const NOTIFICATION_DIGEST_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Your Nearwork updates</title>
</head>
<body style="margin:0; padding:0; background-color:#F5F4F0; font-family:'Poppins', Arial, sans-serif; -webkit-font-smoothing:antialiased;">

  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; color:#F5F4F0; line-height:1px;">
    Here's a quick summary of your latest Nearwork activity.&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F4F0;">
    <tr>
      <td align="center" style="padding:40px 16px 48px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px; width:100%; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.06);">

          <!-- HEADER -->
          <tr>
            <td style="background-color:#FFFFFF; padding:32px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <a href="{{app_url}}" target="_blank" style="text-decoration:none;">
                      <span style="font-family:'Poppins', Arial, sans-serif; font-size:22px; font-weight:700; color:#111111; letter-spacing:-0.03em; line-height:1;">Nearwork</span>
                    </a>
                    <div style="width:68px; height:3px; background-color:#16A085; border-radius:2px; margin-top:4px;"></div>
                  </td>
                  <td align="right" valign="middle">
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:11px; color:#9E9E9E; letter-spacing:0.08em; text-transform:uppercase;">Notifications</span>
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

              <h1 style="font-family:'Poppins', Arial, sans-serif; font-size:22px; font-weight:700; color:#111111; letter-spacing:-0.02em; line-height:1.3; margin:0 0 6px 0;">
                Hi {{first_name}},
              </h1>
              <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; color:#555555; line-height:1.7; margin:0 0 28px 0;">
                Here's a quick summary of your latest Nearwork activity.
              </p>

              {{#each items}}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
                <tr>
                  <td style="background-color:#F5F4F0; border-radius:10px; border-left:4px solid {{item_accent}}; padding:16px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td><span style="font-family:'Poppins', Arial, sans-serif; font-size:11px; font-weight:600; color:{{item_accent}}; letter-spacing:0.08em; text-transform:uppercase;">{{item_category}}</span></td>
                        <td align="right"><span style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#B0B0B0;">{{item_time}}</span></td>
                      </tr>
                    </table>
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:15px; font-weight:600; color:#111111; margin:8px 0 0 0; line-height:1.4;">{{item_title}}</p>
                    {{#if item_body}}<p style="font-family:'Poppins', Arial, sans-serif; font-size:13px; color:#9E9E9E; margin:6px 0 0 0; line-height:1.5;">{{item_body}}</p>{{/if}}
                    {{#if item_link}}<a href="{{item_link}}" target="_blank" style="display:inline-block; font-family:'Poppins', Arial, sans-serif; font-size:13px; font-weight:600; color:#16A085; text-decoration:none; margin-top:10px;">View →</a>{{/if}}
                  </td>
                </tr>
              </table>
              {{/each}}

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
                <tr>
                  <td style="border-radius:6px; background-color:#16A085;">
                    <a href="{{app_url}}" target="_blank"
                      style="display:inline-block; font-family:'Poppins', Arial, sans-serif; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none; padding:13px 30px; border-radius:6px; letter-spacing:-0.01em;">
                      Open Nearwork →
                    </a>
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
                    <span style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E;"> · Your team extension.</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:8px;">
                    <p style="font-family:'Poppins', Arial, sans-serif; font-size:12px; color:#9E9E9E; margin:0; line-height:1.6;">
                      <a href="{{preferences_url}}" target="_blank" style="color:#16A085; text-decoration:none; font-weight:600;">Manage notifications</a>
                      &nbsp;·&nbsp; Questions? <a href="mailto:support@nearwork.co" style="color:#16A085; text-decoration:none;">support@nearwork.co</a>
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
