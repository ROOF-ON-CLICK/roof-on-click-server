const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth.middleware');
const {
  getProfile,
  updateProfile,
  getSavedListings,
  saveListing,
  unsaveListing,
  getRecentlyViewed,
  removeRecentlyViewed,
  clearRecentlyViewed,
  getSearchHistory,
  clearSearchHistory,
  getMyListings,
} = require('../controllers/user.controller');

const router = express.Router();

// All routes require authentication
router.use(verifyToken);

// Profile
router.get('/profile', getProfile);
router.put('/profile', updateProfile);

// Saved listings (seeker + owner can save)
router.get('/saved', getSavedListings);
router.post('/saved/:listingId', saveListing);
router.delete('/saved/:listingId', unsaveListing);

// Recently viewed (persisted in DB, max 20)
router.get('/recently-viewed', getRecentlyViewed);
router.delete('/recently-viewed', clearRecentlyViewed);
router.delete('/recently-viewed/:listingId', removeRecentlyViewed);

// Search history
router.get('/search-history', getSearchHistory);
router.delete('/search-history', clearSearchHistory);

// Owner's own listings
router.get('/my-listings', requireRole('owner', 'admin'), getMyListings);

module.exports = router;
