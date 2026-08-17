'use strict';

/**
 * notification.controller.js
 * In-App Notification REST controller for RoofOnClick users.
 */

const Notification = require('../models/Notification.model');
const { registerSseClient } = require('../services/notification.service');
const { success, error } = require('../utils/apiResponse');

// ─── GET /api/notifications ──────────────────────────────────────────────────
/**
 * Get paginated notifications for the authenticated user.
 * Query params: page, limit, category, isRead
 */
const getNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, category, isRead } = req.query;

    const filter = { recipient: req.user._id };

    if (category && category !== 'All') {
      filter.category = category;
    }

    if (typeof isRead !== 'undefined' && isRead !== '') {
      filter.isRead = isRead === 'true';
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ recipient: req.user._id, isRead: false }),
    ]);

    return success(res, {
      message: 'Notifications fetched successfully.',
      data: {
        notifications,
        unreadCount,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/notifications/unread-count ─────────────────────────────────────
/**
 * Fast endpoint for the navbar badge / polling.
 */
const getUnreadCount = async (req, res, next) => {
  try {
    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      isRead: false,
    });

    return success(res, {
      message: 'Unread count fetched.',
      data: { unreadCount },
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/notifications/:id/read ─────────────────────────────────────────
/**
 * Mark a single notification as read.
 */
const markAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { isRead: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      return error(res, { message: 'Notification not found.', statusCode: 404 });
    }

    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      isRead: false,
    });

    return success(res, {
      message: 'Notification marked as read.',
      data: { notification, unreadCount },
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/notifications/read-all ──────────────────────────────────────────
/**
 * Mark all notifications as read for current user.
 */
const markAllAsRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    return success(res, {
      message: 'All notifications marked as read.',
      data: { unreadCount: 0 },
    });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/notifications/:id ───────────────────────────────────────────
/**
 * Delete a single notification.
 */
const deleteNotification = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      recipient: req.user._id,
    });

    if (!notification) {
      return error(res, { message: 'Notification not found.', statusCode: 404 });
    }

    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      isRead: false,
    });

    return success(res, {
      message: 'Notification deleted.',
      data: { unreadCount },
    });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/notifications ────────────────────────────────────────────────
/**
 * Clear all notifications for current user.
 */
const clearAllNotifications = async (req, res, next) => {
  try {
    await Notification.deleteMany({ recipient: req.user._id });

    return success(res, {
      message: 'All notifications cleared.',
      data: { unreadCount: 0 },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/notifications/stream ──────────────────────────────────────────
/**
 * Real-Time SSE (Server-Sent Events) push stream.
 * Keeps an open HTTP connection for instant in-app alerts.
 */
const streamNotifications = async (req, res, next) => {
  try {
    await registerSseClient(req.user._id, req, res);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/notifications/push/public-key ──────────────────────────────────
/**
 * Returns VAPID public key for frontend PushManager subscription.
 */
const getVapidPublicKey = async (req, res) => {
  const { VAPID_PUBLIC_KEY } = require('../config/webpush');
  return success(res, {
    message: 'VAPID public key fetched.',
    data: { publicKey: VAPID_PUBLIC_KEY },
  });
};

// ─── POST /api/notifications/push/subscribe ──────────────────────────────────
/**
 * Register a client browser/device PushSubscription for native OS push alerts.
 */
const subscribePush = async (req, res, next) => {
  try {
    const { subscription, userAgent } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return error(res, {
        message: 'Invalid subscription object. Required fields: endpoint, keys.p256dh, keys.auth.',
        statusCode: 400,
      });
    }

    const PushSubscription = require('../models/PushSubscription.model');

    // Upsert subscription by endpoint
    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        user: req.user._id,
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
        userAgent: userAgent || req.headers['user-agent'] || '',
      },
      { upsert: true, new: true }
    );

    return success(res, {
      message: 'Push subscription registered successfully.',
      data: { subscribed: true },
      statusCode: 201,
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/notifications/push/unsubscribe ────────────────────────────────
/**
 * Remove a PushSubscription by endpoint.
 */
const unsubscribePush = async (req, res, next) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return error(res, { message: 'Push endpoint is required.', statusCode: 400 });
    }

    const PushSubscription = require('../models/PushSubscription.model');
    await PushSubscription.deleteOne({ endpoint, user: req.user._id });

    return success(res, {
      message: 'Push subscription removed successfully.',
      data: { subscribed: false },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getNotifications,
  getUnreadCount,
  streamNotifications,
  getVapidPublicKey,
  subscribePush,
  unsubscribePush,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications,
};
