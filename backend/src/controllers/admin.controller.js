const Listing = require('../models/Listing.model');
const User = require('../models/User.model');
const { success, error } = require('../utils/apiResponse');

// ─── GET /api/admin/listings ──────────────────────────────────────────────────
/**
 * All listings — including inactive and unverified.
 * Supports filtering by status and verification.
 */
const getAllListings = async (req, res, next) => {
  try {
    const { status, isVerified, page = 1, limit = 20, area } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (isVerified !== undefined) filter.isVerified = isVerified === 'true';
    if (area) filter['address.area'] = { $regex: area, $options: 'i' };

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Number(limit));
    const skip = (pageNum - 1) * limitNum;

    const [listings, total] = await Promise.all([
      Listing.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('owner', 'name email phone')
        .lean(),
      Listing.countDocuments(filter),
    ]);

    return success(res, {
      message: 'Admin: All listings fetched.',
      data: { listings },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/admin/listings/:id/verify ──────────────────────────────────────
/**
 * Toggle isVerified — grants "Assured" badge.
 */
const verifyListing = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return error(res, { message: 'Listing not found.', statusCode: 404 });
    }

    listing.isVerified = !listing.isVerified;
    listing.verifiedAt = listing.isVerified ? new Date() : null;
    listing.verifiedBy = listing.isVerified ? req.user._id : null;
    await listing.save();

    return success(res, {
      message: `Listing ${listing.isVerified ? 'verified (Assured)' : 'unverified'} successfully.`,
      data: { listing },
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/admin/listings/:id/status ──────────────────────────────────────
/**
 * Set listing status — active / inactive / deleted.
 */
const setListingStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive', 'deleted'].includes(status)) {
      return error(res, { message: 'Invalid status.', statusCode: 400 });
    }

    const listing = await Listing.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true }
    );

    if (!listing) {
      return error(res, { message: 'Listing not found.', statusCode: 404 });
    }

    return success(res, { message: `Listing status set to '${status}'.`, data: { listing } });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
/**
 * All users with pagination.
 */
const getAllUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, role, search } = req.query;

    const filter = {};
    if (role) filter.role = role;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Number(limit));
    const skip = (pageNum - 1) * limitNum;

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(filter),
    ]);

    return success(res, {
      message: 'Admin: All users fetched.',
      data: { users },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/admin/users/:id/role ────────────────────────────────────────────
/**
 * Change a user's role.
 */
const setUserRole = async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!['seeker', 'owner', 'admin'].includes(role)) {
      return error(res, { message: 'Invalid role. Must be: seeker, owner, or admin.', statusCode: 400 });
    }

    // Prevent admin from demoting themselves
    if (req.params.id === req.user._id.toString() && role !== 'admin') {
      return error(res, { message: 'Admins cannot demote themselves.', statusCode: 403 });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { role, requestedOwnerRole: false } },
      { new: true }
    ).select('-password');

    if (!user) {
      return error(res, { message: 'User not found.', statusCode: 404 });
    }

    return success(res, { message: `User role updated to '${role}'.`, data: { user } });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAllListings, verifyListing, setListingStatus, getAllUsers, setUserRole };
