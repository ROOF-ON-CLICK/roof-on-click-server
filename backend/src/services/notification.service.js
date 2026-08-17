'use strict';

/**
 * notification.service.js
 * Centralized Notification Dispatcher:
 * 1. Persists In-App notification in MongoDB (Notification model).
 * 2. Asynchronously dispatches high-deliverability transactional email via Resend (email.service.js).
 * 3. Asynchronously dispatches event payload to n8n webhook (if N8N_WEBHOOK_URL is set).
 * 4. Fail-safe: Email/Webhook failures will never throw or disrupt calling business logic.
 */

const Notification = require('../models/Notification.model');
const PushSubscription = require('../models/PushSubscription.model');
const User = require('../models/User.model');
const emailService = require('./email.service');
const { webpush } = require('../config/webpush');

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || null;
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET || null;

// In-memory active SSE client connections: Map<userIdString, Set<Response>>
const sseClients = new Map();

/**
 * Register an incoming SSE connection for real-time in-app pushes.
 */
async function registerSseClient(userId, req, res) {
  const userIdStr = userId.toString();

  // Set SSE response headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable NGINX buffering
  res.flushHeaders?.();

  // Initialize client set for user
  if (!sseClients.has(userIdStr)) {
    sseClients.set(userIdStr, new Set());
  }
  sseClients.get(userIdStr).add(res);

  // Send initial handshake with unread count
  try {
    const unreadCount = await Notification.countDocuments({ recipient: userId, isRead: false });
    res.write(`event: connected\ndata: ${JSON.stringify({ unreadCount })}\n\n`);
  } catch {
    res.write(`event: connected\ndata: ${JSON.stringify({ status: 'ok' })}\n\n`);
  }

  // Periodic 25-second keepalive ping to prevent proxy/browser timeout
  const keepAliveInterval = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(keepAliveInterval);
    }
  }, 25000);

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(keepAliveInterval);
    const userSet = sseClients.get(userIdStr);
    if (userSet) {
      userSet.delete(res);
      if (userSet.size === 0) {
        sseClients.delete(userIdStr);
      }
    }
  });
}

/**
 * Broadcast an in-app notification in real-time to all active browser sessions for a user.
 */
async function broadcastNotificationToUser(userId, notification) {
  const userIdStr = userId.toString();
  const userSet = sseClients.get(userIdStr);
  if (!userSet || userSet.size === 0) return;

  try {
    const unreadCount = await Notification.countDocuments({ recipient: userId, isRead: false });
    const payload = JSON.stringify({
      notification: {
        id: notification._id.toString(),
        title: notification.title,
        description: notification.message,
        category: notification.category,
        type: notification.type,
        actionUrl: notification.actionUrl,
        metadata: notification.metadata,
        isRead: notification.isRead,
        timestamp: notification.createdAt,
      },
      unreadCount,
    });

    for (const clientRes of userSet) {
      try {
        clientRes.write(`event: notification\ndata: ${payload}\n\n`);
      } catch (err) {
        console.error('[notification.service] SSE write error:', err.message);
      }
    }
  } catch (err) {
    console.error('[notification.service] Failed to broadcast SSE:', err.message);
  }
}

/**
 * Send an event payload to n8n automation webhook asynchronously (if configured).
 */
async function dispatchN8NWebhook(payload) {
  if (!N8N_WEBHOOK_URL) return;

  try {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'RoofOnClick-NotificationService/1.0',
    };

    if (N8N_WEBHOOK_SECRET) {
      headers['X-RoofOnClick-Webhook-Secret'] = N8N_WEBHOOK_SECRET;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[notification.service] n8n webhook responded with status ${response.status}`);
    }
  } catch (err) {
    // Non-fatal — log and keep primary execution clean
    console.error('[notification.service] Failed to dispatch n8n webhook:', err.message);
  }
}

/**
 * Create an In-App notification and trigger background email + SSE real-time broadcast.
 * @param {Object} options
 * @param {string|mongoose.Types.ObjectId} options.recipient - Target User ID
 * @param {string|mongoose.Types.ObjectId} [options.sender] - Initiating User ID
 * @param {string} options.category - 'Booking'|'Enquiry'|'Visit'|'Property'|'System'
 * @param {string} options.type - Unique event identifier e.g. 'booking_created'
 * @param {string} options.title - Short notification title
 * @param {string} options.message - Detailed notification message
 * @param {string} [options.actionUrl] - Route URL for user interaction
 * @param {Object} [options.metadata] - Extra context (bookingId, listingId, etc.)
 */
async function createNotification({
  recipient,
  sender = null,
  category = 'System',
  type,
  title,
  message,
  actionUrl = null,
  metadata = {},
}) {
  try {
    if (!recipient || !title || !message) {
      console.warn('[notification.service] Missing required notification fields:', { recipient, title });
      return null;
    }

    // 1. Persist In-App notification in MongoDB
    const notification = await Notification.create({
      recipient,
      sender,
      category,
      type,
      title,
      message,
      actionUrl,
      metadata,
    });

    // 2. Real-time In-App Push via SSE to all open browser tabs for this user
    broadcastNotificationToUser(recipient, notification);

    // 3. Fetch recipient details for Email delivery, Web Push, and Webhook
    (async () => {
      try {
        // A. Dispatch Device-Level Web Push Notifications (if subscribed)
        await sendWebPushNotification(recipient, notification);

        const recipientUser = await User.findById(recipient).select('name email phone role');
        if (!recipientUser) return;

        // B. Dispatch Direct Transactional Email via Resend
        await emailService.dispatchNotificationEmail(notification, recipientUser);

        // C. Optional n8n Webhook Dispatch
        if (N8N_WEBHOOK_URL) {
          const webhookPayload = {
            event: type,
            timestamp: new Date().toISOString(),
            notificationId: notification._id.toString(),
            category,
            title,
            message,
            actionUrl,
            recipient: {
              id: recipientUser._id.toString(),
              name: recipientUser.name,
              email: recipientUser.email,
              phone: recipientUser.phone,
              role: recipientUser.role,
            },
            metadata,
          };
          await dispatchN8NWebhook(webhookPayload);
        }
      } catch (asyncErr) {
        console.error('[notification.service] Async dispatch error:', asyncErr.message);
      }
    })();

    return notification;
  } catch (err) {
    console.error('[notification.service] Error creating notification:', err);
    return null;
  }
}

/**
 * Dispatch native Web Push notifications to all active subscriptions of a user.
 */
async function sendWebPushNotification(userId, notification) {
  try {
    const subscriptions = await PushSubscription.find({ user: userId });
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
        // If subscription is expired or unsubscribed (404 / 410 Gone), automatically prune
        if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: sub._id });
        } else {
          console.error('[notification.service] Web Push dispatch failed for subscription:', pushErr.message);
        }
      }
    });

    await Promise.allSettled(sendPromises);
  } catch (err) {
    console.error('[notification.service] Failed to send Web Push:', err.message);
  }
}

/**
 * Bulk dispatch notifications (e.g. notify both Owner and Admin).
 */
async function createBulkNotifications(notificationsArray) {
  if (!Array.isArray(notificationsArray) || notificationsArray.length === 0) return [];
  const results = await Promise.allSettled(
    notificationsArray.map((item) => createNotification(item))
  );
  return results
    .filter((r) => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);
}

module.exports = {
  registerSseClient,
  broadcastNotificationToUser,
  createNotification,
  createBulkNotifications,
  sendWebPushNotification,
};

