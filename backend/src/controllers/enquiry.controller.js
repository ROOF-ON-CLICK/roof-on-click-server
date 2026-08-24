const { validationResult } = require('express-validator');
const Enquiry = require('../models/Enquiry.model');
const Listing = require('../models/Listing.model');
const { createNotification } = require('../services/notification.service');
const { success, error } = require('../utils/apiResponse');

// ─── POST /api/enquiries/:listingId ──────────────────────────────────────────
/**
 * Submit an enquiry — public endpoint, optional authentication.
 * If authenticated, seeker reference is saved.
 */
const submitEnquiry = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, { message: 'Validation failed', statusCode: 422, errors: errors.array() });
    }

    const listing = await Listing.findOne({
      _id: req.params.listingId,
      status: 'active',
    });

    if (!listing) {
      return error(res, { message: 'Listing not found or no longer active.', statusCode: 404 });
    }

    const { name, phone, message: msg, requestType, preferredDate, preferredTime, notes } = req.body;

    const enquiry = await Enquiry.create({
      listing: listing._id,
      seeker: req.user?._id || null,
      name,
      phone,
      message: msg,
      requestType: requestType || 'Enquiry',
      preferredDate: preferredDate || null,
      preferredTime: preferredTime || null,
      notes: notes || null,
    });

    // ── Notify Property Owner ──
    if (listing.owner) {
      const typeLabel = requestType === 'Visit' ? 'Scheduled Visit' : 'Enquiry';
      createNotification({
        recipient: listing.owner,
        sender: req.user?._id || null,
        category: requestType === 'Visit' ? 'Visit' : 'Enquiry',
        type: 'enquiry.created',
        title: `New ${typeLabel} Request`,
        message: `${name} (${phone}) submitted a ${typeLabel.toLowerCase()} request for "${listing.title}".`,
        actionUrl: '/owner/dashboard',
        metadata: {
          enquiryId: enquiry._id,
          listingId: listing._id,
          name,
          phone,
          requestType: enquiry.requestType,
          preferredDate: enquiry.preferredDate,
          preferredTime: enquiry.preferredTime,
        },
      });
    }

    // ── Notify Seeker if authenticated ──
    if (req.user?._id) {
      createNotification({
        recipient: req.user._id,
        category: requestType === 'Visit' ? 'Visit' : 'Enquiry',
        type: 'enquiry.submitted',
        title: `${requestType || 'Enquiry'} Request Sent`,
        message: `Your ${requestType || 'enquiry'} request for "${listing.title}" was submitted to the owner.`,
        actionUrl: '/profile',
        metadata: {
          enquiryId: enquiry._id,
          listingId: listing._id,
        },
      });
    }

    return success(res, {
      message: 'Enquiry submitted successfully. The owner will get in touch with you.',
      data: { enquiry },
      statusCode: 201,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/enquiries/received ─────────────────────────────────────────────
/**
 * Owner sees all enquiries received on their listings.
 * Filters by listing (optional), status (optional), paginated.
 */
const getReceivedEnquiries = async (req, res, next) => {
  try {
    const { listingId, status, page = 1, limit = 20 } = req.query;

    // Get all listings owned by this user
    const ownerListings = await Listing.find({ owner: req.user._id }).select('_id');
    const listingIds = ownerListings.map((l) => l._id);

    const filter = { listing: { $in: listingIds } };
    if (listingId) filter.listing = listingId;
    if (status) filter.status = status;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(50, Number(limit));
    const skip = (pageNum - 1) * limitNum;

    const [enquiries, total] = await Promise.all([
      Enquiry.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('listing', 'title address.area')
        .populate('seeker', 'name email')
        .lean(),
      Enquiry.countDocuments(filter),
    ]);

    return success(res, {
      message: 'Enquiries fetched.',
      data: { enquiries },
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

// ─── PUT /api/enquiries/:id/status ────────────────────────────────────────────
/**
 * Owner marks an enquiry as seen or closed.
 * Validates that the enquiry belongs to one of the owner's listings.
 */
const updateEnquiryStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['new', 'seen', 'closed'].includes(status)) {
      return error(res, { message: 'Invalid status. Must be: new, seen, or closed.', statusCode: 400 });
    }

    const enquiry = await Enquiry.findById(req.params.id).populate('listing', 'owner');

    if (!enquiry) {
      return error(res, { message: 'Enquiry not found.', statusCode: 404 });
    }

    // Ensure the owner of the listing is the current user (admin bypasses)
    if (
      req.user.role !== 'admin' &&
      enquiry.listing.owner.toString() !== req.user._id.toString()
    ) {
      return error(res, { message: 'Access denied.', statusCode: 403 });
    }

    enquiry.status = status;
    await enquiry.save();

    return success(res, { message: `Enquiry marked as ${status}.`, data: { enquiry } });
  } catch (err) {
    next(err);
  }
};

module.exports = { submitEnquiry, getReceivedEnquiries, updateEnquiryStatus };
