const express = require('express');
const { verifyToken, optionalAuth, requireRole } = require('../middleware/auth.middleware');
const {
  createBooking,
  getUserBookings,
  getOwnerBookings,
  updateBookingStatus,
  cancelBooking,
} = require('../controllers/booking.controller');

const router = express.Router();

router.post('/', verifyToken, requireRole('seeker'), createBooking);
router.get('/my-bookings', verifyToken, getUserBookings);
router.get('/received', verifyToken, requireRole('owner', 'admin'), getOwnerBookings);
router.put('/:id/status', verifyToken, requireRole('owner', 'admin'), updateBookingStatus);
router.put('/:id/cancel', verifyToken, cancelBooking);

module.exports = router;
