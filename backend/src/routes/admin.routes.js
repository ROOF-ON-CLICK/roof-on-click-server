const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth.middleware');
const {
  getAllListings,
  verifyListing,
  setListingStatus,
  getAllUsers,
  setUserRole,
} = require('../controllers/admin.controller');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(verifyToken);
router.use(requireRole('admin'));

// ─── Listings ─────────────────────────────────────────────────────────────────
router.get('/listings', getAllListings);
router.put('/listings/:id/verify', verifyListing);
router.put('/listings/:id/status', setListingStatus);

// ─── Users ────────────────────────────────────────────────────────────────────
router.get('/users', getAllUsers);
router.put('/users/:id/role', setUserRole);

module.exports = router;
