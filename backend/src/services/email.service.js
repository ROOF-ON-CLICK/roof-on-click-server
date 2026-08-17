'use strict';

/**
 * email.service.js
 * Centralized high-deliverability transactional email delivery via Resend SDK.
 * 
 * Anti-Spam & Deliverability Features:
 * 1. True Multipart delivery (both responsive HTML and clean plain-text fallback).
 * 2. Proper List-Unsubscribe, X-Mailer, and transactional headers.
 * 3. Responsive, table-based inline styling with dark/emerald theme.
 * 4. Lazy-initialization & fail-safe execution (does not crash server if key is unset).
 */

const { Resend } = require('resend');

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || 'RoofOnClick <onboarding@resend.dev>';

const FRONTEND_URL =
  process.env.FRONTEND_URL || 'http://localhost:3000';

/**
 * Returns a configured Resend client instance, or null if API key is missing.
 */
function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      '[email.service] RESEND_API_KEY is not set. Emails will be logged to console in dev mode.'
    );
    return null;
  }
  return new Resend(apiKey);
}

/**
 * Clean plain-text fallback generator for anti-spam multipart compliance.
 */
function buildPlainTextEmail({ name, title, message, details = [], actionUrl, actionText }) {
  let text = `RoofOnClick — Student & Professional Housing\n\n`;
  if (name) text += `Hi ${name},\n\n`;
  if (title) text += `${title}\n\n`;
  if (message) text += `${message}\n\n`;

  if (details && details.length > 0) {
    text += `Details:\n`;
    details.forEach(({ label, value }) => {
      text += `• ${label}: ${value}\n`;
    });
    text += `\n`;
  }

  if (actionUrl) {
    const fullUrl = actionUrl.startsWith('http') ? actionUrl : `${FRONTEND_URL}${actionUrl}`;
    text += `${actionText || 'View Details'}: ${fullUrl}\n\n`;
  }

  text += `—\nRoofOnClick Team · Indore, India\nTo manage notification preferences, visit ${FRONTEND_URL}/profile/notifications`;
  return text;
}

/**
 * Core responsive, dark-mode branded HTML email builder.
 */
function buildBrandedEmailTemplate({
  badge = 'Notification',
  title,
  recipientName,
  message,
  details = [],
  actionUrl = null,
  actionText = 'View in App',
  footerNote = null,
}) {
  const fullActionUrl = actionUrl
    ? (actionUrl.startsWith('http') ? actionUrl : `${FRONTEND_URL}${actionUrl}`)
    : null;

  // Build details table rows if provided
  let detailsHtml = '';
  if (details && details.length > 0) {
    const rows = details
      .map(
        (d) => `
        <tr>
          <td style="padding:8px 0;color:#94a3b8;font-size:13px;font-weight:500;border-bottom:1px solid #1e293b;">${d.label}</td>
          <td style="padding:8px 0;color:#f1f5f9;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #1e293b;">${d.value}</td>
        </tr>`
      )
      .join('');

    detailsHtml = `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 24px;background:#111827;border-radius:10px;padding:16px 20px;border:1px solid #1e293b;">
        ${rows}
      </table>`;
  }

  // CTA button HTML
  const actionButtonHtml = fullActionUrl
    ? `
      <table cellpadding="0" cellspacing="0" style="margin:28px 0 20px;">
        <tr>
          <td style="background:linear-gradient(135deg,#10b981,#059669);border-radius:10px;padding:0;">
            <a href="${fullActionUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:13px 32px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px;">
              ${actionText} &rarr;
            </a>
          </td>
        </tr>
      </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title || 'RoofOnClick Notification'}</title>
</head>
<body style="margin:0;padding:0;background:#0b0f17;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b0f17;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#131823;border-radius:16px;overflow:hidden;border:1px solid #1f293d;box-shadow:0 10px 25px rgba(0,0,0,0.4);">
        
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#059669,#10b981);padding:28px 36px;text-align:left;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">RoofOnClick</h1>
                  <p style="margin:4px 0 0;color:rgba(255,255,255,0.9);font-size:12px;font-weight:500;">Student &amp; Professional Housing Platform</p>
                </td>
                <td align="right">
                  <span style="display:inline-block;background:rgba(255,255,255,0.2);color:#ffffff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;text-transform:uppercase;letter-spacing:0.5px;">
                    ${badge}
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Main Body -->
        <tr>
          <td style="padding:32px 36px 28px;">
            ${recipientName ? `<p style="margin:0 0 12px;color:#cbd5e1;font-size:15px;line-height:1.5;">Hi <strong style="color:#ffffff;">${recipientName}</strong>,</p>` : ''}
            
            <h2 style="margin:0 0 14px;color:#f8fafc;font-size:18px;font-weight:700;line-height:1.4;">${title}</h2>
            <p style="margin:0 0 16px;color:#94a3b8;font-size:14px;line-height:1.6;">${message}</p>

            ${detailsHtml}
            ${actionButtonHtml}

            ${
              footerNote
                ? `<div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:12px 16px;margin-top:20px;">
                    <p style="margin:0;color:#64748b;font-size:12px;line-height:1.5;">${footerNote}</p>
                   </div>`
                : ''
            }
          </td>
        </tr>

        <!-- Footer (Anti-Spam compliance) -->
        <tr>
          <td style="padding:20px 36px;background:#0d121c;border-top:1px solid #1f293d;text-align:center;">
            <p style="margin:0 0 6px;color:#475569;font-size:11px;">&copy; ${new Date().getFullYear()} RoofOnClick &middot; Indore, Madhya Pradesh, India</p>
            <p style="margin:0;color:#475569;font-size:11px;">
              You received this transactional notification regarding your RoofOnClick account.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Universal transactional email sender with anti-spam headers and multipart payload.
 */
async function sendTransactionalEmail({
  to,
  name,
  subject,
  badge,
  title,
  message,
  details = [],
  actionUrl = null,
  actionText = 'View in App',
  footerNote = null,
}) {
  if (!to) return;

  const resend = getResendClient();
  if (!resend) {
    console.log(`[email.service] [DEV MOCK] Email to: ${to} | Subject: "${subject}" | Title: "${title}"`);
    return;
  }

  const html = buildBrandedEmailTemplate({
    badge,
    title,
    recipientName: name,
    message,
    details,
    actionUrl,
    actionText,
    footerNote,
  });

  const text = buildPlainTextEmail({
    name,
    title,
    message,
    details,
    actionUrl,
    actionText,
  });

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
      text,
      headers: {
        'X-Mailer': 'RoofOnClick Notification Mailer v1.0',
        'List-Unsubscribe': `<mailto:notifications@roofonclick.com?subject=unsubscribe>`,
        'Precedence': 'bulk',
      },
    });
  } catch (err) {
    console.error(`[email.service] Failed to send email to ${to}:`, err.message);
  }
}

/**
 * Automatically format and dispatch an email based on a Notification event and recipient user.
 */
async function dispatchNotificationEmail(notification, recipientUser) {
  if (!recipientUser?.email) return;

  const { type, category, title, message, actionUrl, metadata = {} } = notification;
  const name = recipientUser.name || 'Resident';
  const to = recipientUser.email;

  // Build metadata detail list for clean display
  const details = [];
  let subject = title;
  let actionText = 'View in App';
  let badge = category || 'Update';

  switch (type) {
    case 'booking.created':
      subject = `[RoofOnClick] New Reservation Received - ${metadata.reservationId || 'Booking'}`;
      badge = 'Booking';
      actionText = 'Manage Booking';
      if (metadata.reservationId) details.push({ label: 'Reservation ID', value: metadata.reservationId });
      if (metadata.guestName) details.push({ label: 'Guest Name', value: metadata.guestName });
      if (metadata.guestPhone) details.push({ label: 'Phone', value: metadata.guestPhone });
      if (metadata.totalDueNow) details.push({ label: 'Total Due', value: `₹${metadata.totalDueNow}` });
      break;

    case 'booking.submitted':
      subject = `[RoofOnClick] Reservation Submitted (${metadata.reservationId || 'Pending'})`;
      badge = 'Booking';
      actionText = 'View My Bookings';
      if (metadata.reservationId) details.push({ label: 'Reservation ID', value: metadata.reservationId });
      if (metadata.propertyName) details.push({ label: 'Property', value: metadata.propertyName });
      break;

    case 'booking.confirmed':
    case 'booking.accepted':
      subject = `[RoofOnClick] 🎉 Booking Confirmed (${metadata.reservationId || ''})`;
      badge = 'Confirmed';
      actionText = 'View Booking Details';
      if (metadata.reservationId) details.push({ label: 'Reservation ID', value: metadata.reservationId });
      break;

    case 'booking.cancelled':
      subject = `[RoofOnClick] Booking Cancelled (${metadata.reservationId || ''})`;
      badge = 'Cancelled';
      actionText = 'View Bookings';
      if (metadata.reservationId) details.push({ label: 'Reservation ID', value: metadata.reservationId });
      break;

    case 'enquiry.created':
      subject = `[RoofOnClick] New ${metadata.requestType || 'Enquiry'} Request`;
      badge = metadata.requestType === 'Visit' ? 'Visit Request' : 'Enquiry';
      actionText = 'Respond to Enquiry';
      if (metadata.name) details.push({ label: 'Name', value: metadata.name });
      if (metadata.phone) details.push({ label: 'Phone', value: metadata.phone });
      if (metadata.preferredDate) details.push({ label: 'Date', value: new Date(metadata.preferredDate).toLocaleDateString() });
      if (metadata.preferredTime) details.push({ label: 'Time Slot', value: metadata.preferredTime });
      break;

    case 'enquiry.submitted':
      subject = `[RoofOnClick] Your ${metadata.requestType || 'Enquiry'} has been sent`;
      badge = 'Enquiry Sent';
      actionText = 'View My Enquiries';
      break;

    case 'property.submitted':
      subject = `[RoofOnClick] Property Submitted for Verification`;
      badge = 'Pending Review';
      actionText = 'View Property Status';
      if (metadata.title) details.push({ label: 'Property', value: metadata.title });
      break;

    case 'property.review_needed':
      subject = `[RoofOnClick Admin] New Property Pending Review`;
      badge = 'Admin Review';
      actionText = 'Review Listing';
      if (metadata.ownerName) details.push({ label: 'Owner', value: metadata.ownerName });
      break;

    case 'property.approved':
      subject = `[RoofOnClick] 🎉 Your Property Listing has been Approved!`;
      badge = 'Listing Live';
      actionText = 'View My Properties';
      break;

    case 'property.rejected':
      subject = `[RoofOnClick] Property Listing Rejected`;
      badge = 'Rejected';
      actionText = 'Review Listing Guidelines';
      break;

    case 'property.suspended':
      subject = `[RoofOnClick] ⚠️ Property Listing Suspended`;
      badge = 'Suspended';
      actionText = 'View Property Status';
      if (metadata.title) details.push({ label: 'Property', value: metadata.title });
      break;

    case 'property.deleted':
      subject = `[RoofOnClick] Property Listing Removed`;
      badge = 'Removed';
      actionText = 'View Dashboard';
      break;

    default:
      subject = `[RoofOnClick] ${title}`;
      badge = category || 'Notification';
      actionText = 'View Notification';
      break;
  }

  await sendTransactionalEmail({
    to,
    name,
    subject,
    badge,
    title,
    message,
    details,
    actionUrl,
    actionText,
  });
}

/**
 * Send password reset email.
 */
async function sendPasswordResetEmail(to, name, rawToken) {
  const resetUrl = `${FRONTEND_URL}/auth/reset-password?token=${rawToken}`;
  await sendTransactionalEmail({
    to,
    name,
    subject: 'Reset your RoofOnClick password',
    badge: 'Security',
    title: 'Reset your password',
    message: 'We received a request to reset your RoofOnClick password. Click the button below to set a new password. This link expires in 15 minutes.',
    actionUrl: resetUrl,
    actionText: 'Reset Password',
    footerNote: 'If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.',
  });
}

/**
 * Sent when a user who signed up via Google tries to reset their password.
 */
async function sendOAuthAccountEmail(to, name) {
  const loginUrl = `${FRONTEND_URL}/login`;
  await sendTransactionalEmail({
    to,
    name,
    subject: 'Your RoofOnClick account uses Google Sign-In',
    badge: 'Account Alert',
    title: 'You use Google to sign in',
    message: 'Your RoofOnClick account is linked to Google. There is no separate password to reset — click below to sign in with Google.',
    actionUrl: loginUrl,
    actionText: 'Sign in with Google',
    footerNote: 'Did not request this? You can safely ignore this email.',
  });
}

/**
 * Send welcome email on account registration.
 */
async function sendWelcomeEmail(to, name, role = 'seeker') {
  const isOwner = role === 'owner';
  const subject = `Welcome to RoofOnClick, ${name || 'there'}! 🏠`;
  const badge = isOwner ? 'Partner Onboarding' : 'Welcome';
  const title = isOwner ? 'Welcome to the RoofOnClick Partner Network!' : 'Welcome to RoofOnClick!';
  const message = isOwner
    ? 'Thank you for joining RoofOnClick as a property partner. You can now list verified student accommodations, manage live resident enquiries, and track bookings with zero brokerage.'
    : 'Welcome to RoofOnClick — your trusted student & professional housing platform in Indore. Start discovering verified hostels, PGs, and apartments with zero brokerage and transparent pricing.';

  const actionUrl = isOwner ? '/owner/properties' : '/properties';
  const actionText = isOwner ? 'List Your First Property' : 'Explore Verified PGs';

  const details = [
    { label: 'Account Type', value: isOwner ? 'Property Owner / Partner' : 'Resident / Seeker' },
    { label: 'Zero Brokerage', value: '100% Guaranteed' },
    { label: 'Location Hub', value: 'Indore, MP' },
  ];

  await sendTransactionalEmail({
    to,
    name,
    subject,
    badge,
    title,
    message,
    details,
    actionUrl,
    actionText,
  });
}

module.exports = {
  sendTransactionalEmail,
  dispatchNotificationEmail,
  sendPasswordResetEmail,
  sendOAuthAccountEmail,
  sendWelcomeEmail,
};
