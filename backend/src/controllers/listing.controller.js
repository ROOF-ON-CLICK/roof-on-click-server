const { validationResult } = require('express-validator');
const Listing = require('../models/Listing.model');
const User = require('../models/User.model');
const { createNotification, createBulkNotifications } = require('../services/notification.service');
const { success, error } = require('../utils/apiResponse');

// ─── GET /api/listings ────────────────────────────────────────────────────────
/**
 * Browse all active listings with filters + pagination.
 * Saves search query to authenticated user's searchHistory (max 10, FIFO).
 */
const getListings = async (req, res, next) => {
  try {
    const {
      city,
      area,
      type,
      gender,
      minRent,
      maxRent,
      amenities,
      sharing,
      verified,
      page = 1,
      limit = 12,
      sort = 'newest',
      q, // text search
    } = req.query;

    // Build filter — always only show active listings
    const filter = { status: 'active' };
    
    if (city) {
      const cleanCity = decodeURIComponent(city).replace(/\+/g, ' ').trim();
      filter['address.city'] = { $regex: cleanCity, $options: 'i' };
    }
    if (area) {
      const cleanArea = decodeURIComponent(area).replace(/\+/g, ' ').trim();
      filter['address.area'] = { $regex: cleanArea, $options: 'i' };
    }
    if (type) {
      const cleanType = type.trim().replace(/-/g, '[- ]?');
      filter.type = { $regex: `^${cleanType}$`, $options: 'i' };
    }
    if (gender) filter.gender = { $regex: `^${gender.trim()}$`, $options: 'i' };
    if (verified === 'true' || verified === true) filter.isVerified = true;

    // Rent range
    if (minRent || maxRent) {
      filter['rent.monthly'] = {};
      if (minRent) filter['rent.monthly'].$gte = Number(minRent);
      if (maxRent) filter['rent.monthly'].$lte = Number(maxRent);
    }

    // Amenities — must include ALL specified
    if (amenities) {
      const amenitiesList = amenities.split(',').map((a) => a.trim());
      filter.amenities = { $all: amenitiesList };
    }

    // Sharing options — any of the specified
    if (sharing) {
      const sharingList = sharing.split(',').map(Number).filter(Boolean);
      filter.sharingOptions = { $in: sharingList };
    }

    // Text search
    if (q) {
      filter.$text = { $search: q };
    }

    // Sort
    let sortObj = {};
    switch (sort) {
      case 'rent_asc':
        sortObj = { 'rent.monthly': 1 };
        break;
      case 'rent_desc':
        sortObj = { 'rent.monthly': -1 };
        break;
      case 'newest':
      default:
        sortObj = { createdAt: -1 };
        break;
    }

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(50, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [listings, total] = await Promise.all([
      Listing.find(filter)
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .populate('owner', 'name avatar phone')
        .lean(),
      Listing.countDocuments(filter),
    ]);

    // Save search history for authenticated users
    if (req.user) {
      const searchEntry = {
        query: q || '',
        filters: { city, area, type, gender, minRent, maxRent, amenities, sharing, verified },
        searchedAt: new Date(),
      };

      await User.findByIdAndUpdate(req.user._id, {
        $push: {
          searchHistory: {
            $each: [searchEntry],
            $slice: -10, // keep last 10 (FIFO)
          },
        },
      });
    }

    return success(res, {
      message: 'Listings fetched successfully.',
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

// ─── GET /api/listings/:id ────────────────────────────────────────────────────
/**
 * Single listing detail.
 * Side effects: increments viewCount, pushes to recentlyViewed if authenticated.
 */
const getListing = async (req, res, next) => {
  try {
    const listing = await Listing.findOne({ _id: req.params.id, status: { $ne: 'deleted' } })
      .populate('owner', 'name avatar phone email')
      .populate('verifiedBy', 'name');

    if (!listing) {
      return error(res, { message: 'Listing not found.', statusCode: 404 });
    }

    // Increment view count
    listing.viewCount += 1;
    await listing.save({ validateBeforeSave: false });

    // Push to recently viewed (max 20, FIFO) if authenticated
    if (req.user) {
      const viewEntry = { listingId: listing._id, viewedAt: new Date() };

      await User.findByIdAndUpdate(req.user._id, {
        $pull: { recentlyViewed: { listingId: listing._id } }, // remove if already there
      });

      await User.findByIdAndUpdate(req.user._id, {
        $push: {
          recentlyViewed: {
            $each: [viewEntry],
            $slice: -20, // keep last 20 (FIFO)
          },
        },
      });
    }

    return success(res, { message: 'Listing fetched successfully.', data: { listing } });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/listings ───────────────────────────────────────────────────────
/**
 * Create a new listing.
 * Auto-promotes seeker → owner role if they create their first listing.
 */
const createListing = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, { message: 'Validation failed', statusCode: 422, errors: errors.array() });
    }

    // Auto-promote seeker → owner
    if (req.user.role === 'seeker') {
      await User.findByIdAndUpdate(req.user._id, { role: 'owner' });
      req.user.role = 'owner';
    }

    const listing = await Listing.create({
      ...req.body,
      owner: req.user._id,
      status: 'pending',
      isVerified: false,
    });

    // ── 1. Notify Owner of Successful Submission ──
    createNotification({
      recipient: req.user._id,
      category: 'Property',
      type: 'property.submitted',
      title: 'Property Submitted for Review',
      message: `Your property listing "${listing.title}" has been submitted and is currently pending admin verification.`,
      actionUrl: '/owner/properties',
      metadata: {
        listingId: listing._id,
        title: listing.title,
      },
    });

    // ── 2. Notify all Platform Admins in Real-Time ──
    (async () => {
      try {
        const admins = await User.find({ role: 'admin' }).select('_id');
        if (admins.length > 0) {
          createBulkNotifications(
            admins.map((admin) => ({
              recipient: admin._id,
              sender: req.user._id,
              category: 'Property',
              type: 'property.review_needed',
              title: 'New Property Pending Approval',
              message: `New listing "${listing.title}" in ${listing.address?.city || 'Indore'} submitted by ${req.user.name || 'an owner'} requires verification.`,
              actionUrl: '/admin/properties',
              metadata: {
                listingId: listing._id,
                ownerId: req.user._id,
                ownerName: req.user.name,
              },
            }))
          );
        }
      } catch (adminNotifErr) {
        console.error('[listing.controller] Failed to notify admins:', adminNotifErr.message);
      }
    })();

    return success(res, {
      message: 'Property submitted for admin examination & site verification.',
      data: { listing },
      statusCode: 201,
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/listings/:id ────────────────────────────────────────────────────
/**
 * Update listing — owner (own) or admin only.
 * Verified status can only be changed by admin via admin routes.
 */
const updateListing = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, { message: 'Validation failed', statusCode: 422, errors: errors.array() });
    }

    // Prevent changing sensitive fields via this route
    const { isVerified, verifiedAt, verifiedBy, owner, viewCount, ...updateData } = req.body;

    const listing = await Listing.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!listing) {
      return error(res, { message: 'Listing not found.', statusCode: 404 });
    }

    return success(res, { message: 'Listing updated successfully.', data: { listing } });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/listings/:id ─────────────────────────────────────────────────
/**
 * Soft delete — sets status to 'deleted'.
 * Also cleans up R2 photos (batch delete).
 */
const deleteListing = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      return error(res, { message: 'Listing not found.', statusCode: 404 });
    }

    // Check ownership (admin bypasses)
    if (req.user.role !== 'admin' && listing.owner.toString() !== req.user._id.toString()) {
      return error(res, { message: 'Access denied. You do not own this listing.', statusCode: 403 });
    }

    // Batch delete R2 photos if any
    if (listing.photos && listing.photos.length > 0) {
      try {
        const { DeleteObjectsCommand } = require('@aws-sdk/client-s3');
        const r2Client = require('../config/r2');

        const objects = listing.photos.map((p) => ({ Key: p.key }));
        await r2Client.send(
          new DeleteObjectsCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Delete: { Objects: objects },
          })
        );
      } catch (r2Err) {
        console.error('R2 batch delete error (non-fatal):', r2Err.message);
        // Continue with soft-delete even if R2 cleanup fails
      }
    }

    listing.status = 'deleted';
    await listing.save();

    return success(res, { message: 'Listing deleted successfully.' });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/listings/:id/whatsapp-link ──────────────────────────────────────
/**
 * Returns a pre-built wa.me WhatsApp URL for the listing owner.
 */
const getWhatsAppLink = async (req, res, next) => {
  try {
    const listing = await Listing.findOne({ _id: req.params.id, status: 'active' }).lean();
    if (!listing) {
      return error(res, { message: 'Listing not found.', statusCode: 404 });
    }

    if (!listing.ownerWhatsapp) {
      return error(res, { message: 'Owner WhatsApp number not available for this listing.', statusCode: 400 });
    }

    const { buildWhatsAppUrl } = require('../utils/whatsapp');
    const url = buildWhatsAppUrl(listing.ownerWhatsapp, {
      title: listing.title,
      type: listing.type,
      area: listing.address?.area,
    });

    return success(res, { message: 'WhatsApp link generated.', data: { url } });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/listings/:id/photos ───────────────────────────────────────────
/**
 * Upload photos to R2 — handled after upload middleware runs.
 * Middleware attaches req.uploadedPhotos = [{url, key}]
 */
const uploadPhotos = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return error(res, { message: 'Listing not found.', statusCode: 404 });
    }

    // Check total photo limit
    if (listing.photos.length + req.uploadedPhotos.length > 10) {
      return error(res, {
        message: `Cannot exceed 10 photos per listing. Currently has ${listing.photos.length}.`,
        statusCode: 400,
      });
    }

    listing.photos.push(...req.uploadedPhotos);
    await listing.save();

    return success(res, {
      message: `${req.uploadedPhotos.length} photo(s) uploaded successfully.`,
      data: { photos: listing.photos },
    });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/listings/:id/photos/:photoKey ────────────────────────────────
/**
 * Delete a specific photo by its R2 key.
 */
const deletePhoto = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return error(res, { message: 'Listing not found.', statusCode: 404 });
    }

    const photoKey = decodeURIComponent(req.params.photoKey);
    const photo = listing.photos.find((p) => p.key === photoKey);

    if (!photo) {
      return error(res, { message: 'Photo not found in this listing.', statusCode: 404 });
    }

    // Delete from R2
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const r2Client = require('../config/r2');

    await r2Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: photoKey,
      })
    );

    // Remove from listing
    listing.photos = listing.photos.filter((p) => p.key !== photoKey);
    await listing.save();

    return success(res, { message: 'Photo deleted successfully.', data: { photos: listing.photos } });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/listings/cities ──────────────────────────────────────────────────
/**
 * Return supported and active cities with listing counts.
 */
const getAvailableCities = async (req, res, next) => {
  try {
    const registry = [
      { id: 'indore', name: 'Indore', state: 'Madhya Pradesh', isLive: true },
      { id: 'bhopal', name: 'Bhopal', state: 'Madhya Pradesh', isLive: false },
      { id: 'kota', name: 'Kota', state: 'Rajasthan', isLive: false },
      { id: 'pune', name: 'Pune', state: 'Maharashtra', isLive: false },
      { id: 'jaipur', name: 'Jaipur', state: 'Rajasthan', isLive: false },
      { id: 'bangalore', name: 'Bangalore', state: 'Karnataka', isLive: false },
    ];

    const citiesWithCounts = await Promise.all(
      registry.map(async (c) => {
        const count = await Listing.countDocuments({
          status: 'active',
          'address.city': { $regex: new RegExp(`^${c.name}$`, 'i') },
        });
        return {
          ...c,
          isLive: c.isLive || count > 0,
          listingCount: count,
        };
      })
    );

    return success(res, { data: { cities: citiesWithCounts } });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getListings,
  getListing,
  createListing,
  updateListing,
  deleteListing,
  getWhatsAppLink,
  uploadPhotos,
  deletePhoto,
  getAvailableCities,
};
