'use strict';

const webpush = require('web-push');

const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  'BJtNfTOCYyS3mywZ4xCyyOV6q4IDzRTVkiGXmQov74WuMgmACJpBrY5LuaGJQbnRplvZk5hfB9oD8RzecnKaUeM';

const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY ||
  'Q3soQZduVx2PyFhgThA5XLHmqTfzkrWscUpCJ-ylaPc';

const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || 'mailto:notifications@roofonclick.com';

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
