'use strict';

const express = require('express');
const {
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
} = require('../controllers/notification.controller');
const { verifyToken } = require('../middleware/auth.middleware');

const router = express.Router();

// Public endpoint — VAPID public key needed to initialize PushManager subscription
router.get('/push/public-key', getVapidPublicKey);

// All subsequent notification endpoints require authentication
router.use(verifyToken);

router.get('/stream', streamNotifications);
router.post('/push/subscribe', subscribePush);
router.post('/push/unsubscribe', unsubscribePush);
router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.put('/read-all', markAllAsRead);
router.put('/:id/read', markAsRead);
router.delete('/:id', deleteNotification);
router.delete('/', clearAllNotifications);

module.exports = router;
