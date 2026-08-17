'use strict';

/**
 * email.service.js
 * Centralized email delivery via Resend SDK.
 * Lazy-initialises the Resend client so the server starts even without
 * RESEND_API_KEY — the error is surfaced only when an email is actually sent.
 */

const { Resend } = require('resend');

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || 'RoofOnClick <onboarding@resend.dev>';

const FRONTEND_URL =
  process.env.FRONTEND_URL || 'http://localhost:3000';

/** Returns a configured Resend client, or throws a clear error if key is missing. */
function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      '[email.service] RESEND_API_KEY is not set. ' +
      'Add it to your .env file to enable password-reset emails.'
    );
  }
  return new Resend(apiKey);
}

function buildPasswordResetEmail(name, resetUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Reset Your Password - RoofOnClick</title>
</head>
<body style="margin:0;padding:0;background:#0f1117;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
        style="background:#1a1d27;border-radius:16px;overflow:hidden;border:1px solid #2a2d3a;">
        <tr>
          <td style="background:linear-gradient(135deg,#10b981,#059669);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:800;">RoofOnClick</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Your trusted student housing platform</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h2 style="margin:0 0 12px;color:#f1f5f9;font-size:20px;font-weight:700;">Reset your password</h2>
            <p style="margin:0 0 8px;color:#94a3b8;font-size:15px;line-height:1.6;">Hi <strong style="color:#e2e8f0;">${name}</strong>,</p>
            <p style="margin:0 0 28px;color:#94a3b8;font-size:15px;line-height:1.6;">
              We received a request to reset your RoofOnClick password.
              Click the button below to set a new password. This link expires in
              <strong style="color:#10b981;">15 minutes</strong>.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
              <tr>
                <td style="background:linear-gradient(135deg,#10b981,#059669);border-radius:10px;padding:0;">
                  <a href="${resetUrl}" style="display:block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">
                    Reset Password &rarr;
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;color:#64748b;font-size:12px;">If the button does not work, paste this link in your browser:</p>
            <p style="margin:0 0 28px;word-break:break-all;">
              <a href="${resetUrl}" style="color:#10b981;font-size:12px;">${resetUrl}</a>
            </p>
            <div style="background:#111827;border:1px solid #1e293b;border-radius:10px;padding:16px;">
              <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">
                Did not request this? You can safely ignore this email. Your password will not change unless you click the link above.
              </p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #2a2d3a;text-align:center;">
            <p style="margin:0;color:#475569;font-size:11px;">&copy; 2025 RoofOnClick &middot; Indore, India</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendPasswordResetEmail(to, name, rawToken) {
  const resend = getResendClient();
  const resetUrl = `${FRONTEND_URL}/auth/reset-password?token=${rawToken}`;
  await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: 'Reset your RoofOnClick password',
    html: buildPasswordResetEmail(name, resetUrl),
    // Plain-text fallback — required for good deliverability
    text: `Hi ${name},\n\nWe received a request to reset your RoofOnClick password.\n\nClick the link below to set a new password (expires in 15 minutes):\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.\n\n— The RoofOnClick Team`,
    headers: {
      'X-Mailer': 'RoofOnClick Mailer',
      'List-Unsubscribe': `<mailto:noreply@help.roofonclick.com?subject=unsubscribe>`,
    },
  });
}

/**
 * Sent when a user who signed up via Google tries to reset their password.
 * Tells them to use Google Sign-In instead.
 */
async function sendOAuthAccountEmail(to, name) {
  const resend = getResendClient();
  const loginUrl = `${FRONTEND_URL}/login`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>Sign in with Google – RoofOnClick</title></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
        style="background:#1a1d27;border-radius:16px;overflow:hidden;border:1px solid #2a2d3a;">
        <tr>
          <td style="background:linear-gradient(135deg,#10b981,#059669);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:800;">RoofOnClick</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Your trusted student housing platform</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h2 style="margin:0 0 12px;color:#f1f5f9;font-size:20px;font-weight:700;">You use Google to sign in</h2>
            <p style="margin:0 0 8px;color:#94a3b8;font-size:15px;line-height:1.6;">Hi <strong style="color:#e2e8f0;">${name}</strong>,</p>
            <p style="margin:0 0 28px;color:#94a3b8;font-size:15px;line-height:1.6;">
              Your RoofOnClick account is linked to <strong style="color:#ffffff;">Google</strong>.
              There is no separate password to reset &mdash; just click the button below and
              sign in with your Google account as usual.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
              <tr>
                <td style="background:linear-gradient(135deg,#10b981,#059669);border-radius:10px;padding:0;">
                  <a href="${loginUrl}" style="display:block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">
                    Sign in with Google &rarr;
                  </a>
                </td>
              </tr>
            </table>
            <div style="background:#111827;border:1px solid #1e293b;border-radius:10px;padding:16px;">
              <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">
                Did not request this? You can safely ignore this email.
              </p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #2a2d3a;text-align:center;">
            <p style="margin:0;color:#475569;font-size:11px;">&copy; 2025 RoofOnClick &middot; Indore, India</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: 'Your RoofOnClick account uses Google Sign-In',
    html,
  });
}

module.exports = { sendPasswordResetEmail, sendOAuthAccountEmail };
