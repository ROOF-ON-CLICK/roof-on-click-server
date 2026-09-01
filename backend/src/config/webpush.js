'use strict';

const webpush = require('web-push');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY

const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY

const VAPID_SUBJECT = process.env.VAPID_SUBJECT

try {
  webpush.setVapidDetails(
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
} catch (err) {
  console.error('[webpush.config] Failed to set VAPID details:', err.message);
}

module.exports = {
  webpush,
  VAPID_PUBLIC_KEY,
  VAPID_SUBJECT,
};
