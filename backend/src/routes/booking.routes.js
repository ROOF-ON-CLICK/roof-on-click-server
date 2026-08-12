const express = require('express');
const { verifyToken, optionalAuth, requireRole } = require('../middleware/auth.middleware');
const {
  createBooking,
  getUserBookings,
  getOwnerBookings,
  cancelBooking,
} = require('../controllers/booking.controller');

const router = express.Router();

router.post('/', optionalAuth, createBooking);
router.get('/my-bookings', verifyToken, getUserBookings);
router.get('/received', verifyToken, requireRole('owner', 'admin'), getOwnerBookings);
router.put('/:id/cancel', verifyToken, cancelBooking);

module.exports = router;
