const express = require('express');
const { verifyToken, optionalAuth, requireRole } = require('../middleware/auth.middleware');
const {
  getPropertyReviews,
  createReview,
  toggleHelpful,
  addOwnerReply,
  getRatingSummary,
} = require('../controllers/review.controller');

const router = express.Router();

router.get('/property/:propertyId', getPropertyReviews);
router.get('/summary/:propertyId', getRatingSummary);
router.post('/:propertyId', optionalAuth, createReview);
router.post('/:reviewId/helpful', optionalAuth, toggleHelpful);
router.post('/:reviewId/reply', verifyToken, requireRole('owner', 'admin'), addOwnerReply);

module.exports = router;
