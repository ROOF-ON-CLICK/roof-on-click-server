const User = require('../models/User.model');
const Listing = require('../models/Listing.model');
const { success, error } = require('../utils/apiResponse');

// ─── GET /api/users/profile ───────────────────────────────────────────────────
const getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    return success(res, { message: 'Profile fetched.', data: { user } });
  } catch (err) {
    next(err);
  }
};

const { uploadBase64ToR2 } = require('../utils/r2Upload');

// ─── PUT /api/users/profile ───────────────────────────────────────────────────
const updateProfile = async (req, res, next) => {
  try {
    // Only allow updating safe fields
    const { name, phone, avatar } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone;
    if (avatar !== undefined) {
      if (avatar && avatar.startsWith('data:image/')) {
        updates.avatar = await uploadBase64ToR2(avatar, `avatars/${req.user._id}`);
      } else {
        updates.avatar = avatar;
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password');

    return success(res, { message: 'Profile updated.', data: { user } });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/users/saved ─────────────────────────────────────────────────────
const getSavedListings = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select('savedListings')
      .populate({
        path: 'savedListings',
        match: { status: 'active' },
        select: 'title address rent type gender photos amenities rooms isVerified apartmentDetails nearby rules',
      });

    return success(res, {
      message: 'Saved listings fetched.',
      data: { listings: (user.savedListings || []).filter(Boolean) },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/users/saved/:listingId ────────────────────────────────────────
const saveListing = async (req, res, next) => {
  try {
    const listing = await Listing.findOne({ _id: req.params.listingId, status: { $ne: 'deleted' } });
    if (!listing) {
      return error(res, { message: 'Listing not found.', statusCode: 404 });
    }

    const user = await User.findById(req.user._id);
    if (!user.savedListings) user.savedListings = [];
    const alreadySaved = user.savedListings.some(
      (id) => id && id.toString() === req.params.listingId.toString()
    );

    if (!alreadySaved) {
      user.savedListings.push(req.params.listingId);
      await user.save();
    }

    return success(res, { message: 'Listing saved.', data: { savedListings: user.savedListings } });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/users/saved/:listingId ──────────────────────────────────────
const unsaveListing = async (req, res, next) => {
  try {
    const listingId = (req.params.listingId || '').toString();
    const user = await User.findById(req.user._id);
    if (user && user.savedListings) {
      user.savedListings = user.savedListings.filter(
        (id) => id && id.toString() !== listingId
      );
      await user.save();
    }

    return success(res, { message: 'Listing removed from saved.' });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/users/recently-viewed ──────────────────────────────────────────
const getRecentlyViewed = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select('recentlyViewed')
      .populate({
        path: 'recentlyViewed.listingId',
        match: { status: { $ne: 'deleted' } },
        select: 'title address rent type gender photos amenities rooms isVerified apartmentDetails nearby rules',
      });

    // Sort by viewedAt descending (most recent first, up to 20)
    const sorted = (user.recentlyViewed || [])
      .filter((rv) => rv && rv.listingId) // filter out deleted listings
      .sort((a, b) => new Date(b.viewedAt) - new Date(a.viewedAt))
      .slice(0, 20);

    return success(res, { message: 'Recently viewed listings fetched.', data: { listings: sorted } });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/users/recently-viewed/:listingId ────────────────────────────
const removeRecentlyViewed = async (req, res, next) => {
  try {
    const { listingId } = req.params;
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { recentlyViewed: { listingId } },
    });
    return success(res, { message: 'Property removed from recently viewed history.' });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/users/recently-viewed ───────────────────────────────────────
const clearRecentlyViewed = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $set: { recentlyViewed: [] },
    });
    return success(res, { message: 'Recently viewed history cleared.' });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/users/search-history ───────────────────────────────────────────
const getSearchHistory = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('searchHistory');
    const history = [...user.searchHistory].reverse(); // most recent first
    return success(res, { message: 'Search history fetched.', data: { history } });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/users/search-history ────────────────────────────────────────
const clearSearchHistory = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { $set: { searchHistory: [] } });
    return success(res, { message: 'Search history cleared.' });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/users/my-listings ──────────────────────────────────────────────
const getMyListings = async (req, res, next) => {
  try {
    const { page = 1, limit = 12, status } = req.query;

    const filter = { owner: req.user._id };
    if (status) {
      filter.status = status;
    } else {
      filter.status = { $ne: 'deleted' }; // exclude deleted by default
    }

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(50, Number(limit));
    const skip = (pageNum - 1) * limitNum;

    const [listings, total] = await Promise.all([
      Listing.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Listing.countDocuments(filter),
    ]);

    return success(res, {
      message: 'Your listings fetched.',
      data: { listings },
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
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
};
