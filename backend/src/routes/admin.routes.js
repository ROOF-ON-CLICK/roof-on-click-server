const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth.middleware');
const {
  getDashboardStats,
  getAllListings,
  verifyListing,
  setListingStatus,
  getAllUsers,
  setUserRole,
  getAllBookings,
  updateAdminBookingStatus,
  getAllReviews,
  deleteAdminReview,
} = require('../controllers/admin.controller');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(verifyToken);
router.use(requireRole('admin'));

// ─── Overview Stats ───────────────────────────────────────────────────────────
router.get('/stats', getDashboardStats);

// ─── Listings ─────────────────────────────────────────────────────────────────
router.get('/listings', getAllListings);
router.put('/listings/:id/verify', verifyListing);
router.put('/listings/:id/status', setListingStatus);

// ─── Users ────────────────────────────────────────────────────────────────────
router.get('/users', getAllUsers);
router.put('/users/:id/role', setUserRole);

// ─── Bookings ─────────────────────────────────────────────────────────────────
router.get('/bookings', getAllBookings);
router.put('/bookings/:id/status', updateAdminBookingStatus);

// ─── Reviews Moderation ───────────────────────────────────────────────────────
router.get('/reviews', getAllReviews);
router.delete('/reviews/:id', deleteAdminReview);

module.exports = router;
