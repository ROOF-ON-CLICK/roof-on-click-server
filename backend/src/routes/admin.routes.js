const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth.middleware');
const {
  getDashboardStats,
  getAllListings,
  getListingById,
  updateListing,
  verifyListing,
  setListingStatus,
  reassignListingOwner,
  getAllUsers,
  setUserRole,
  updateUserStatus,
  updateUserKyc,
  deleteUser,
  bulkUpdateUsersStatus,
  assignAccountManager,
  broadcastNotification,
  getAllBookings,
  updateAdminBookingStatus,
  processBookingRefund,
  bulkUpdateBookings,
  assignBookingExecutive,
  getFinanceStats,
  getFinanceTransactions,
  settleFinanceTransaction,
  refundFinanceTransaction,
  getAllSupportTickets,
  createSupportTicket,
  updateSupportTicket,
  bulkUpdateSupportTickets,
  getTrustSafetyReports,
  getAllReviews,
  updateAdminReviewStatus,
  deleteAdminReview,
  getAuditLogs,
  getSystemSettings,
  updateSystemSetting,
} = require('../controllers/admin.controller');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(verifyToken);
router.use(requireRole('admin'));

// ─── Overview Stats ───────────────────────────────────────────────────────────
router.get('/stats', getDashboardStats);

// ─── Listings ─────────────────────────────────────────────────────────────────
router.get('/listings', getAllListings);
router.get('/listings/:id', getListingById);
router.put('/listings/:id', updateListing);
router.put('/listings/:id/verify', verifyListing);
router.put('/listings/:id/status', setListingStatus);
router.patch('/listings/:id/reassign-owner', reassignListingOwner);

// ─── Users ────────────────────────────────────────────────────────────────────
router.get('/users', getAllUsers);
router.put('/users/:id/role', setUserRole);
router.put('/users/:id/status', updateUserStatus);
router.put('/users/:id/kyc', updateUserKyc);
router.delete('/users/:id', deleteUser);
router.post('/users/bulk-status', bulkUpdateUsersStatus);
router.put('/users/:id/manager', assignAccountManager);
router.post('/users/broadcast', broadcastNotification);

// ─── Bookings ─────────────────────────────────────────────────────────────────
router.get('/bookings', getAllBookings);
router.put('/bookings/:id/status', updateAdminBookingStatus);
router.post('/bookings/:id/refund', processBookingRefund);
router.post('/bookings/bulk-status', bulkUpdateBookings);
router.put('/bookings/:id/executive', assignBookingExecutive);

// ─── Financials & Transactions ────────────────────────────────────────────────
router.get('/finance/stats', getFinanceStats);
router.get('/finance/transactions', getFinanceTransactions);
router.put('/finance/transactions/:id/settle', settleFinanceTransaction);
router.post('/finance/transactions/:id/refund', refundFinanceTransaction);

// ─── Support Tickets ──────────────────────────────────────────────────────────
router.get('/support/tickets', getAllSupportTickets);
router.post('/support/tickets', createSupportTicket);
router.put('/support/tickets/:id', updateSupportTicket);
router.post('/support/tickets/bulk-status', bulkUpdateSupportTickets);

// ─── Trust & Safety ───────────────────────────────────────────────────────────
router.get('/trust-safety/reports', getTrustSafetyReports);

// ─── Reviews Moderation ───────────────────────────────────────────────────────
router.get('/reviews', getAllReviews);
router.put('/reviews/:id/status', updateAdminReviewStatus);
router.delete('/reviews/:id', deleteAdminReview);

// ─── Audit Logs ───────────────────────────────────────────────────────────────
router.get('/audit-logs', getAuditLogs);

// ─── System Settings ──────────────────────────────────────────────────────────
router.get('/system/settings', getSystemSettings);
router.put('/system/settings', updateSystemSetting);

module.exports = router;
