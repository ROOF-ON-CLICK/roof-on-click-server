'use strict';

const PushSubscription = require('../models/PushSubscription.model');
const { webpush } = require('../config/webpush');

/**
 * Executes Web Push notification sending with automatic pruning of 404/410 subscriptions.
 */
async function processPushNotification({ recipientId, notification }) {
  if (!recipientId) return;

  const subscriptions = await PushSubscription.find({ user: recipientId });
  if (!subscriptions || subscriptions.length === 0) return;

  const payload = JSON.stringify({
    title: notification.title || 'RoofOnClick Notification',
    body: notification.message || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: `roofonclick-${notification._id || Date.now()}`,
    url: notification.actionUrl || '/',
    data: {
      notificationId: notification._id?.toString(),
      actionUrl: notification.actionUrl || '/',
      type: notification.type,
      category: notification.category,
    },
  });

  const sendPromises = subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys.p256dh,
            auth: sub.keys.auth,
          },
        },
        payload
      );
    } catch (pushErr) {
      if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
        await PushSubscription.deleteOne({ _id: sub._id });
      } else {
        console.error('[push.worker] Web Push dispatch failed:', pushErr.message);
      }
    }
  });

  await Promise.allSettled(sendPromises);
}

module.exports = {
  processPushNotification,
};
