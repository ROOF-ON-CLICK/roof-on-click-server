const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth.middleware');
const {
  createOrder,
  verifyPayment,
  handleWebhook,
  getMyPayments,
  getAdminPayments,
} = require('../controllers/payment.controller');

const router = express.Router();

// Razorpay asynchronous webhook (Public, signature-verified via raw body)
router.post('/webhook', handleWebhook);

// Owner / User routes
router.post('/create-order', verifyToken, createOrder);
router.post('/verify', verifyToken, verifyPayment);
router.get('/my-payments', verifyToken, getMyPayments);

// Admin routes
router.get('/admin/all', verifyToken, requireRole('admin'), getAdminPayments);

module.exports = router;
