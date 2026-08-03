const express = require('express');
const { body } = require('express-validator');
const { verifyToken, optionalAuth, requireRole } = require('../middleware/auth.middleware');
const {
  submitEnquiry,
  getReceivedEnquiries,
  updateEnquiryStatus,
} = require('../controllers/enquiry.controller');

const router = express.Router();

// ─── Validation ───────────────────────────────────────────────────────────────
const enquiryValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('phone')
    .trim()
    .notEmpty()
    .withMessage('Phone number is required')
    .matches(/^[0-9+\-\s()]{7,15}$/)
    .withMessage('Invalid phone number'),
  body('message').optional().trim().isLength({ max: 500 }).withMessage('Message too long'),
];

// ─── Routes ───────────────────────────────────────────────────────────────────

// Public — submit enquiry (optional auth to link seeker)
router.post('/:listingId', optionalAuth, enquiryValidation, submitEnquiry);

// Owner — view received enquiries
router.get('/received', verifyToken, requireRole('owner', 'admin'), getReceivedEnquiries);

// Owner — update enquiry status
router.put('/:id/status', verifyToken, requireRole('owner', 'admin'), updateEnquiryStatus);

module.exports = router;
