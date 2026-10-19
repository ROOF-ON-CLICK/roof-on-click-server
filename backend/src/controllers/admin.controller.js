const mongoose = require('mongoose');
const Listing = require('../models/Listing.model');
const User = require('../models/User.model');
const Booking = require('../models/Booking.model');
const Review = require('../models/Review.model');
const SupportTicket = require('../models/SupportTicket.model');
const Payment = require('../models/Payment.model');
const AuditLog = require('../models/AuditLog.model');
const SystemSetting = require('../models/SystemSetting.model');
const RoomInventory = require('../models/RoomInventory.model');
const { createNotification } = require('../services/notification.service');
const { success, error } = require('../utils/apiResponse');

// Helper to record audit log
const logAdminAction = async ({ actor, action, targetType, targetId, details = {}, req, session = null }) => {
  try {
    const ipAddress = req?.headers['x-forwarded-for'] || req?.socket?.remoteAddress || '';
    const userAgent = req?.headers['user-agent'] || '';
    const logDoc = new AuditLog({
      actor,
      actorRole: 'admin',
      action,
      targetType,
      targetId,
      details,
      ipAddress,
      userAgent,
    });
    if (session) {
      await logDoc.save({ session });
    } else {
      await logDoc.save();
    }
  } catch (err) {
    console.warn('[AuditLog] Failed to log admin action:', err.message);
  }
};

// ─── GET /api/admin/stats ─────────────────────────────────────────────────────
/**
  * Summary KPIs and dashboard counters for Admin Overview.
  * Optimized using single MongoDB aggregation pipelines for fast calculation.
  */
const getDashboardStats = async (req, res, next) => {
  try {
    const [listingStats, userStats, bookingStats, paymentStats, reviewStats, recentProperties] = await Promise.all([
      // Listing counts in a single aggregation pass
      Listing.aggregate([
        {
          $facet: {
            total: [{ $count: 'count' }],
            pending: [{ $match: { status: 'pending' } }, { $count: 'count' }],
            active: [{ $match: { status: 'active' } }, { $count: 'count' }],
            rejected: [{ $match: { status: 'rejected' } }, { $count: 'count' }],
            draft: [{ $match: { status: 'draft' } }, { $count: 'count' }],
            verified: [{ $match: { isVerified: true } }, { $count: 'count' }],
            featured: [{ $match: { isFeatured: true } }, { $count: 'count' }],
          },
        },
      ]),
      // User counts in a single aggregation pass
      User.aggregate([
        {
          $facet: {
            total: [{ $count: 'count' }],
            owners: [{ $match: { role: 'owner' } }, { $count: 'count' }],
            seekers: [{ $match: { role: 'seeker' } }, { $count: 'count' }],
            admins: [{ $match: { role: 'admin' } }, { $count: 'count' }],
            verified: [{ $match: { isVerified: true } }, { $count: 'count' }],
          },
        },
      ]),
      // Booking counts
      Booking.aggregate([
        {
          $facet: {
            total: [{ $count: 'count' }],
            pending: [{ $match: { status: 'pending' } }, { $count: 'count' }],
            confirmed: [{ $match: { status: 'confirmed' } }, { $count: 'count' }],
            cancelled: [{ $match: { status: 'cancelled' } }, { $count: 'count' }],
          },
        },
      ]),
      // Payment aggregates (total volume, monthly volume)
      Payment.aggregate([
        {
          $facet: {
            totalVolume: [
              { $match: { status: 'paid' } },
              { $group: { _id: null, total: { $sum: '$amount' } } },
            ],
            thisMonth: [
              {
                $match: {
                  status: 'paid',
                  createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
                },
              },
              { $group: { _id: null, total: { $sum: '$amount' } } },
            ],
          },
        },
      ]),
      // Review count & avg rating
      Review.aggregate([
        {
          $group: {
            _id: null,
            totalReviews: { $sum: 1 },
            avgRating: { $avg: '$rating' },
          },
        },
      ]),
      // 5 most recent listings with light projection
      Listing.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select('title address type gender rent status isVerified isFeatured photos createdAt')
        .populate('owner', 'name email phone')
        .lean(),
    ]);

    const lFacet = listingStats[0] || {};
    const uFacet = userStats[0] || {};
    const bFacet = bookingStats[0] || {};
    const pFacet = paymentStats[0] || {};
    const rData = reviewStats[0] || { totalReviews: 0, avgRating: 4.8 };

    const kpis = {
      totalProperties: lFacet.total?.[0]?.count || 0,
      pendingProperties: lFacet.pending?.[0]?.count || 0,
      activeProperties: lFacet.active?.[0]?.count || 0,
      rejectedProperties: lFacet.rejected?.[0]?.count || 0,
      draftProperties: lFacet.draft?.[0]?.count || 0,
      verifiedProperties: lFacet.verified?.[0]?.count || 0,
      featuredProperties: lFacet.featured?.[0]?.count || 0,
      totalUsers: uFacet.total?.[0]?.count || 0,
      totalOwners: uFacet.owners?.[0]?.count || 0,
      totalSeekers: uFacet.seekers?.[0]?.count || 0,
      totalAdmins: uFacet.admins?.[0]?.count || 0,
      verifiedOwners: uFacet.verified?.[0]?.count || 0,
      totalBookings: bFacet.total?.[0]?.count || 0,
      pendingBookings: bFacet.pending?.[0]?.count || 0,
      confirmedBookings: bFacet.confirmed?.[0]?.count || 0,
      cancelledBookings: bFacet.cancelled?.[0]?.count || 0,
      totalRevenue: pFacet.totalVolume?.[0]?.total || 0,
      monthlyRevenue: pFacet.thisMonth?.[0]?.total || 0,
      totalReviews: rData.totalReviews || 0,
      avgRating: Number((rData.avgRating || 4.8).toFixed(1)),
    };

    return success(res, {
      message: 'Admin stats fetched successfully.',
      data: {
        kpis,
        recentProperties,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/listings ──────────────────────────────────────────────────
/**
 * All listings with single-pass aggregation facet.
 * Retrieves paginated data, status breakdown counts, and total in ONE query.
 */
const getAllListings = async (req, res, next) => {
  try {
    const {
      status,
      isVerified,
      isFeatured,
      type,
      gender,
      city,
      area,
      search,
      page = 1,
      limit = 100,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const matchQuery = {};

    if (status && status !== 'all') {
      matchQuery.status = status;
    }
    if (isVerified !== undefined && isVerified !== '') {
      matchQuery.isVerified = isVerified === 'true';
    }
    if (isFeatured !== undefined && isFeatured !== '') {
      matchQuery.isFeatured = isFeatured === 'true';
    }
    if (type && type !== 'all') {
      matchQuery.type = type.toLowerCase();
    }
    if (gender && gender !== 'all') {
      matchQuery.gender = gender.toLowerCase();
    }
    if (city) {
      matchQuery['address.city'] = { $regex: city, $options: 'i' };
    }
    if (area) {
      matchQuery['address.area'] = { $regex: area, $options: 'i' };
    }
    if (search) {
      matchQuery.$or = [
        { title: { $regex: search, $options: 'i' } },
        { 'address.area': { $regex: search, $options: 'i' } },
        { 'address.city': { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(1000, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;
    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    const sortObj = { [sortBy]: sortDirection };

    const [result] = await Listing.aggregate([
      { $match: matchQuery },
      {
        $facet: {
          paginatedResults: [
            { $sort: sortObj },
            { $skip: skip },
            { $limit: limitNum },
            {
              $lookup: {
                from: 'users',
                localField: 'owner',
                foreignField: '_id',
                as: 'ownerDoc',
                pipeline: [{ $project: { name: 1, email: 1, phone: 1, avatar: 1, isVerified: 1 } }],
              },
            },
            {
              $addFields: {
                owner: { $arrayElemAt: ['$ownerDoc', 0] },
              },
            },
            {
              $project: {
                ownerDoc: 0,
              },
            },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
    ]);

    const listings = result?.paginatedResults || [];
    const total = result?.totalCount?.[0]?.count || 0;

    return success(res, {
      message: 'Admin: All listings fetched.',
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

// ─── GET /api/admin/listings/:id ──────────────────────────────────────────────
/**
  * Full listing details for admin inspection and editing.
  */
const getListingById = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id)
      .populate('owner', 'name email phone avatar isVerified role')
      .populate('verifiedBy', 'name email')
      .lean();

    if (!listing) {
      return error(res, { message: 'Listing not found.', statusCode: 404 });
    }

    // Fetch related room inventory and audit logs in parallel
    const [rooms, auditLogs] = await Promise.all([
      RoomInventory.find({ propertyId: listing._id }).lean(),
      AuditLog.find({ targetId: listing._id }).sort({ createdAt: -1 }).limit(20).populate('actor', 'name email').lean(),
    ]);

    return success(res, {
      message: 'Listing fetched successfully.',
      data: { listing, rooms, auditLogs },
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/admin/listings/:id ──────────────────────────────────────────────
/**
  * Full in-place edit of property fields by Admin.
  */
const updateListing = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const listing = await Listing.findById(req.params.id).session(session);
    if (!listing) {
      await session.abortTransaction();
      session.endSession();
      return error(res, { message: 'Listing not found.', statusCode: 404 });
    }

    const beforeState = listing.toObject();
    const updateData = req.body;

    // Fields that admin can update
    const allowedFields = [
      'title',
      'type',
      'gender',
      'description',
      'address',
      'rent',
      'deposit',
      'amenities',
      'rules',
      'photos',
      'ownerWhatsapp',
      'status',
      'isVerified',
      'isFeatured',
      'totalRooms',
      'availableRooms',
      'roomTypes',
      'seo',
      'rejectionReason',
    ];

    allowedFields.forEach((field) => {
      if (updateData[field] !== undefined) {
        listing[field] = updateData[field];
      }
    });

    if (updateData.isVerified === true && !listing.verifiedAt) {
      listing.verifiedAt = new Date();
      listing.verifiedBy = req.user._id;
    }

    await listing.save({ session });

    // Log admin action with diff summary
    await logAdminAction({
      actor: req.user._id,
      action: 'listing_edited',
      targetType: 'Listing',
      targetId: listing._id,
      details: {
        updatedFields: Object.keys(updateData),
        previousTitle: beforeState.title,
        newTitle: listing.title,
      },
      req,
      session,
    });

    await session.commitTransaction();
    session.endSession();

    return success(res, {
      message: 'Listing updated successfully by Admin.',
      data: { listing },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

// ─── PUT /api/admin/listings/:id/verify ──────────────────────────────────────
/**
 * Toggle isVerified & confirm on-site Direct UPI verification payment (₹299).
 */
const verifyListing = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const listing = await Listing.findById(req.params.id).session(session);
    if (!listing) {
      await session.abortTransaction();
      session.endSession();
      return error(res, { message: 'Listing not found.', statusCode: 404 });
    }

    const isNowVerified = !listing.isVerified;
    listing.isVerified = isNowVerified;
    listing.verifiedAt = isNowVerified ? new Date() : null;
    listing.verifiedBy = isNowVerified ? req.user._id : null;

    if (isNowVerified) {
      const sixMonthsFromNow = new Date();
      sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
      const upiPaymentRef = req.body?.paymentRef || `upi_onsite_${Date.now()}`;

      listing.verificationService = {
        isRequested: true,
        paymentStatus: 'paid',
        paymentMode: 'onsite_upi',
        paymentId: upiPaymentRef,
        fee: 299,
        validityMonths: 6,
        paidAt: new Date(),
        verifiedAt: new Date(),
        expiresAt: sixMonthsFromNow,
      };

      // Record ₹299 Direct UPI payment transaction
      try {
        await Payment.create(
          [
            {
              orderId: `order_onsite_${Date.now()}`,
              paymentId: upiPaymentRef,
              user: listing.owner,
              listing: listing._id,
              type: 'verification_service',
              amount: 299,
              currency: 'INR',
              status: 'paid',
              gateway: 'Direct UPI (On-Site)',
              paidAt: new Date(),
              metadata: {
                verifiedByAdmin: req.user._id,
                verifiedAt: new Date().toISOString(),
                method: 'Direct UPI On-Site Audit',
              },
            },
          ],
          { session }
        );
      } catch (payErr) {
        console.warn('[Payment] Failed to record On-Site UPI transaction:', payErr.message);
      }
    } else if (listing.verificationService) {
      listing.verificationService.verifiedAt = null;
      listing.verificationService.expiresAt = null;
    }

    await listing.save({ session });

    await logAdminAction({
      actor: req.user._id,
      action: isNowVerified ? 'listing_verified' : 'listing_unverified',
      targetType: 'Listing',
      targetId: listing._id,
      details: { isVerified: isNowVerified },
      req,
      session,
    });

    await session.commitTransaction();
    session.endSession();

    if (isNowVerified) {
      createNotification({
        recipient: listing.owner,
        category: 'Verification',
        type: 'listing.verified',
        title: 'Property Verified On-Site! 🛡️',
        message: `Your property "${listing.title}" has been verified and marked Assured for 6 months!`,
        actionUrl: `/property/${listing._id}`,
      }).catch(() => {});
    }

    return success(res, {
      message: `Listing ${listing.isVerified ? 'verified (Assured)' : 'unverified'} successfully.`,
      data: { listing },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

// ─── PUT /api/admin/listings/:id/status ──────────────────────────────────────
/**
 * Set listing status — active (approved) / pending / inactive (suspended) / rejected / deleted.
 */
const setListingStatus = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { status, rejectionReason } = req.body;
    const allowedStatuses = ['pending', 'active', 'inactive', 'rejected', 'deleted'];
    if (!allowedStatuses.includes(status)) {
      await session.abortTransaction();
      session.endSession();
      return error(res, { message: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}`, statusCode: 400 });
    }

    const listing = await Listing.findById(req.params.id).session(session);
    if (!listing) {
      await session.abortTransaction();
      session.endSession();
      return error(res, { message: 'Listing not found.', statusCode: 404 });
    }

    const prevStatus = listing.status;
    listing.status = status;

    if (status === 'active') {
      listing.isVerified = true;
      listing.verifiedAt = new Date();
      listing.verifiedBy = req.user._id;
      listing.rejectionReason = '';
    } else if (status === 'rejected') {
      listing.isVerified = false;
      listing.rejectionReason = rejectionReason || 'Property details require correction.';
    }

    await listing.save({ session });

    await logAdminAction({
      actor: req.user._id,
      action: `listing_status_${status}`,
      targetType: 'Listing',
      targetId: listing._id,
      details: { prevStatus, newStatus: status, rejectionReason: listing.rejectionReason },
      req,
      session,
    });

    await session.commitTransaction();
    session.endSession();

    // Notify owner
    if (listing.owner) {
      let notifTitle = 'Property Listing Status Updated';
      let notifMessage = `Your property listing "${listing.title}" status is now '${status}'.`;
      let notifType = 'property.updated';

      if (status === 'active') {
        notifType = 'property.approved';
        notifTitle = 'Property Listing Approved! 🎉';
        notifMessage = `Your property "${listing.title}" has been reviewed, approved, and is now live!`;
      } else if (status === 'rejected') {
        notifType = 'property.rejected';
        notifTitle = 'Property Listing Requires Changes';
        notifMessage = `Your property listing "${listing.title}" was not approved: ${listing.rejectionReason}`;
      } else if (status === 'inactive') {
        notifType = 'property.suspended';
        notifTitle = 'Property Listing Suspended';
        notifMessage = `Your property listing "${listing.title}" has been temporarily suspended.`;
      }

      createNotification({
        recipient: listing.owner,
        sender: req.user._id,
        category: 'Property',
        type: notifType,
        title: notifTitle,
        message: notifMessage,
        actionUrl: '/owner/dashboard',
      }).catch(() => {});
    }

    return success(res, {
      message: `Listing status updated to '${status}'.`,
      data: { listing },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

// ─── PATCH /api/admin/listings/:id/reassign-owner ─────────────────────────────
/**
 * Reassign property to another owner.
 */
const reassignListingOwner = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { newOwnerId } = req.body;
    if (!newOwnerId) {
      await session.abortTransaction();
      session.endSession();
      return error(res, { message: 'newOwnerId is required.', statusCode: 400 });
    }

    const [listing, newOwner] = await Promise.all([
      Listing.findById(req.params.id).session(session),
      User.findById(newOwnerId).session(session),
    ]);

    if (!listing) {
      await session.abortTransaction();
      session.endSession();
      return error(res, { message: 'Listing not found.', statusCode: 404 });
    }
    if (!newOwner) {
      await session.abortTransaction();
      session.endSession();
      return error(res, { message: 'New owner user account not found.', statusCode: 404 });
    }

    const previousOwnerId = listing.owner;
    listing.owner = newOwner._id;
    await listing.save({ session });

    await logAdminAction({
      actor: req.user._id,
      action: 'listing_owner_reassigned',
      targetType: 'Listing',
      targetId: listing._id,
      details: { previousOwnerId, newOwnerId: newOwner._id },
      req,
      session,
    });

    await session.commitTransaction();
    session.endSession();

    return success(res, {
      message: `Listing ownership transferred to ${newOwner.name || newOwner.email}.`,
      data: { listing },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
/**
 * All users with single-pass facet aggregation.
 */
const getAllUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, role, search, status } = req.query;

    const matchQuery = {};
    if (role && role !== 'all') matchQuery.role = role;
    if (status && status !== 'all') matchQuery.status = status;
    if (search) {
      matchQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Number(limit));
    const skip = (pageNum - 1) * limitNum;

    const [result] = await User.aggregate([
      { $match: matchQuery },
      {
        $facet: {
          paginatedResults: [
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limitNum },
            {
              $project: {
                password: 0,
              },
            },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
    ]);

    const users = result?.paginatedResults || [];
    const total = result?.totalCount?.[0]?.count || 0;

    return success(res, {
      message: 'Admin: All users fetched.',
      data: { users },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/audit-logs ────────────────────────────────────────────────
/**
 * Fetch paginated audit logs.
 */
const getAuditLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, targetType, action } = req.query;
    const filter = {};
    if (targetType) filter.targetType = targetType;
    if (action) filter.action = action;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Number(limit));
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('actor', 'name email role')
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    return success(res, {
      message: 'Audit logs fetched.',
      data: { logs },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/system/settings ───────────────────────────────────────────
/**
 * Get all system settings.
 */
const getSystemSettings = async (req, res, next) => {
  try {
    const settings = await SystemSetting.find().lean();
    return success(res, {
      message: 'System settings fetched.',
      data: { settings },
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/admin/system/settings ───────────────────────────────────────────
/**
 * Upsert system setting.
 */
const updateSystemSetting = async (req, res, next) => {
  try {
    const { key, value, category, description } = req.body;
    if (!key) {
      return error(res, { message: 'Setting key is required.', statusCode: 400 });
    }

    const setting = await SystemSetting.findOneAndUpdate(
      { key },
      {
        $set: {
          value,
          category: category || 'general',
          description: description || '',
          updatedBy: req.user._id,
        },
      },
      { upsert: true, new: true }
    );

    await logAdminAction({
      actor: req.user._id,
      action: 'system_setting_updated',
      targetType: 'SystemSetting',
      targetId: setting._id,
      details: { key, value },
      req,
    });

    return success(res, {
      message: `Setting '${key}' updated successfully.`,
      data: { setting },
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/admin/users/:id/status ──────────────────────────────────────────
/**
 * Update user account status (active, suspended, blocked, inactive).
 */
const updateUserStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['active', 'suspended', 'blocked', 'inactive'].includes(status)) {
      return error(res, { message: 'Invalid status. Must be: active, suspended, blocked, or inactive.', statusCode: 400 });
    }

    if (req.params.id === req.user._id.toString() && status !== 'active') {
      return error(res, { message: 'Admins cannot suspend or block their own account.', statusCode: 403 });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true }
    ).select('-password');

    if (!user) {
      return error(res, { message: 'User not found.', statusCode: 404 });
    }

    // Real-time SSE alert
    createNotification({
      recipient: user._id,
      sender: req.user._id,
      category: 'System',
      type: status === 'active' ? 'system.alert' : 'system.warning',
      title: `Account ${status === 'active' ? 'Reactivated' : status === 'suspended' ? 'Suspended' : 'Status Updated'}`,
      message: `Your account status has been changed to '${status}' by administrative review.`,
      actionUrl: '/profile',
      metadata: { userId: user._id, status },
    });

    return success(res, { message: `User status updated to '${status}'.`, data: { user } });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/admin/users/:id/kyc ─────────────────────────────────────────────
/**
 * Update user KYC verification status.
 */
const updateUserKyc = async (req, res, next) => {
  try {
    const { status, documentType, documentUrl, rejectionReason } = req.body;
    if (!['unverified', 'pending', 'verified', 'rejected'].includes(status)) {
      return error(res, { message: 'Invalid KYC status.', statusCode: 400 });
    }

    const updateData = {
      'kyc.status': status,
      isVerified: status === 'verified',
    };
    if (documentType) updateData['kyc.documentType'] = documentType;
    if (documentUrl) updateData['kyc.documentUrl'] = documentUrl;
    if (rejectionReason) updateData['kyc.rejectionReason'] = rejectionReason;
    if (status === 'verified') updateData['kyc.verifiedAt'] = new Date();

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true }
    ).select('-password');

    if (!user) {
      return error(res, { message: 'User not found.', statusCode: 404 });
    }

    createNotification({
      recipient: user._id,
      sender: req.user._id,
      category: 'KYC',
      type: status === 'verified' ? 'kyc.approved' : 'kyc.rejected',
      title: `KYC Verification ${status === 'verified' ? 'Approved' : 'Status Updated'}`,
      message: status === 'verified'
        ? 'Your identity documents have been verified successfully. Your account is fully unlocked!'
        : `Your KYC verification is currently '${status}'. ${rejectionReason || ''}`,
      actionUrl: '/profile',
      metadata: { userId: user._id, kycStatus: status },
    });

    return success(res, { message: `User KYC status updated to '${status}'.`, data: { user } });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/admin/users/:id ──────────────────────────────────────────────
/**
 * Delete or purge user record.
 */
const deleteUser = async (req, res, next) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return error(res, { message: 'Admins cannot delete their own account.', statusCode: 403 });
    }

    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return error(res, { message: 'User not found.', statusCode: 404 });
    }

    return success(res, { message: 'User deleted successfully.', data: { id: req.params.id } });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/admin/users/bulk-status ────────────────────────────────────────
/**
 * Bulk approve, suspend, block, or delete users.
 */
const bulkUpdateUsersStatus = async (req, res, next) => {
  try {
    const { userIds, action, status } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return error(res, { message: 'userIds array is required.', statusCode: 400 });
    }

    const safeIds = userIds.filter((id) => id !== req.user._id.toString());

    if (action === 'delete') {
      await User.deleteMany({ _id: { $in: safeIds } });
      return success(res, { message: `Deleted ${safeIds.length} user(s).`, data: { deletedIds: safeIds } });
    }

    const targetStatus = status || (action === 'suspend' ? 'suspended' : action === 'block' ? 'blocked' : 'active');
    const updateObj = { status: targetStatus };
    if (action === 'approve') {
      updateObj.isVerified = true;
      updateObj['kyc.status'] = 'verified';
    }

    await User.updateMany({ _id: { $in: safeIds } }, { $set: updateObj });

    return success(res, {
      message: `Updated ${safeIds.length} user(s) to '${targetStatus}'.`,
      data: { updatedIds: safeIds, status: targetStatus },
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/admin/users/:id/manager ──────────────────────────────────────────
/**
 * Assign a dedicated account manager.
 */
const assignAccountManager = async (req, res, next) => {
  try {
    const { name, email, phone } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { accountManager: { name, email, phone } } },
      { new: true }
    ).select('-password');

    if (!user) {
      return error(res, { message: 'User not found.', statusCode: 404 });
    }

    return success(res, { message: 'Account manager assigned successfully.', data: { user } });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/admin/users/broadcast ──────────────────────────────────────────
/**
 * Broadcast in-app notification to filtered or selected users.
 */
const broadcastNotification = async (req, res, next) => {
  try {
    const { userIds, role, title, message, category = 'System' } = req.body;
    let targetIds = userIds;

    if (!targetIds || targetIds.length === 0) {
      const filter = role ? { role } : {};
      const found = await User.find(filter).select('_id').lean();
      targetIds = found.map((u) => u._id);
    }

    await Promise.all(
      targetIds.map((recipientId) =>
        createNotification({
          recipient: recipientId,
          sender: req.user._id,
          category,
          type: 'system.alert',
          title: title || 'Important Announcement',
          message: message || 'You have a new update from RoofOnClick Admin.',
          actionUrl: '/profile',
        })
      )
    );

    return success(res, { message: `Broadcast sent to ${targetIds.length} users.`, data: { sentCount: targetIds.length } });
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

// ─── GET /api/admin/bookings ──────────────────────────────────────────────────
/**
 * Fetch all platform bookings for Admin management.
 */
const getAllBookings = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Number(limit));
    const skip = (pageNum - 1) * limitNum;

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('property', 'title address images rent owner')
        .populate('user', 'name email phone')
        .lean(),
      Booking.countDocuments(filter),
    ]);

    return success(res, {
      message: 'Admin: Bookings fetched successfully.',
      data: { bookings },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/admin/bookings/:id/status ───────────────────────────────────────
/**
 * Admin update booking status.
 */
const updateAdminBookingStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['pending', 'confirmed', 'rejected', 'cancelled', 'completed', 'refunded'].includes(status)) {
      return error(res, { message: 'Invalid booking status.', statusCode: 400 });
    }

    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true }
    ).populate('property user');

    if (!booking) {
      return error(res, { message: 'Booking not found.', statusCode: 404 });
    }

    if (booking.user) {
      createNotification({
        recipient: booking.user._id || booking.user,
        sender: req.user._id,
        category: 'Booking',
        type: status === 'confirmed' ? 'booking.confirmed' : 'booking.cancelled',
        title: `Booking ${status === 'confirmed' ? 'Confirmed' : 'Status Updated'}`,
        message: `Your booking for '${booking.propertyName || 'Property'}' is now '${status}'.`,
        actionUrl: '/booking',
        metadata: { bookingId: booking._id, status },
      });
    }

    return success(res, { message: `Booking status updated to '${status}'.`, data: { booking } });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/admin/bookings/:id/refund ──────────────────────────────────────
/**
 * Process a booking refund.
 */
const processBookingRefund = async (req, res, next) => {
  try {
    const { amount, reason } = req.body;
    const booking = await Booking.findById(req.params.id).populate('property user');
    if (!booking) {
      return error(res, { message: 'Booking not found.', statusCode: 404 });
    }

    const refundAmount = amount || booking.pricing?.totalDueNow || booking.pricing?.securityDeposit || 5000;
    const refundTxnId = `REF-${Math.floor(100000 + Math.random() * 900000)}`;

    booking.status = 'refunded';
    booking.paymentStatus = 'refunded';
    booking.refund = {
      status: 'refunded',
      amount: refundAmount,
      reason: reason || 'Admin approved refund settlement',
      processedAt: new Date(),
      txnId: refundTxnId,
    };
    await booking.save();

    if (booking.user) {
      createNotification({
        recipient: booking.user._id || booking.user,
        sender: req.user._id,
        category: 'Payment',
        type: 'payment.success',
        title: 'Refund Processed Successfully',
        message: `₹${refundAmount.toLocaleString()} has been refunded to your original payment method for booking ${booking.reservationId || booking._id}.`,
        actionUrl: '/booking',
        metadata: { bookingId: booking._id, refundAmount, txnId: refundTxnId },
      });
    }

    return success(res, {
      message: `Refund of ₹${refundAmount} processed successfully.`,
      data: { booking, refundTxnId },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/admin/bookings/bulk-status ─────────────────────────────────────
/**
 * Bulk update booking statuses.
 */
const bulkUpdateBookings = async (req, res, next) => {
  try {
    const { bookingIds, action, status } = req.body;
    if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
      return error(res, { message: 'bookingIds array is required.', statusCode: 400 });
    }

    const targetStatus = status || (action === 'approve' ? 'confirmed' : action === 'cancel' ? 'cancelled' : 'confirmed');
    await Booking.updateMany({ _id: { $in: bookingIds } }, { $set: { status: targetStatus } });

    return success(res, {
      message: `Updated ${bookingIds.length} booking(s) to '${targetStatus}'.`,
      data: { updatedIds: bookingIds, status: targetStatus },
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/admin/bookings/:id/executive ────────────────────────────────────
/**
 * Assign a dedicated ground executive to a booking.
 */
const assignBookingExecutive = async (req, res, next) => {
  try {
    const { name, phone, email } = req.body;
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { $set: { assignedExecutive: { name, phone, email } } },
      { new: true }
    );

    if (!booking) {
      return error(res, { message: 'Booking not found.', statusCode: 404 });
    }

    return success(res, { message: 'Ground executive assigned successfully.', data: { booking } });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/reviews ───────────────────────────────────────────────────
/**
 * Fetch all property reviews for Admin moderation.
 */
const getAllReviews = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Number(limit));
    const skip = (pageNum - 1) * limitNum;

    const [reviews, total] = await Promise.all([
      Review.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('property', 'title address')
        .populate('user', 'name email avatar')
        .lean(),
      Review.countDocuments(),
    ]);

    return success(res, {
      message: 'Admin: Reviews fetched successfully.',
      data: { reviews },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/finance/stats ─────────────────────────────────────────────
/**
 * Aggregate owner subscription revenue, trial vs paid plans, verification revenue, and trends.
 */
const getFinanceStats = async (req, res, next) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [payments, listings] = await Promise.all([
      Payment.find({ status: 'paid' }).populate('user listing').lean(),
      Listing.find().select('subscription verificationService status').lean(),
    ]);

    const subscriptionPayments = payments.filter((p) => p.type === 'listing_subscription' || p.amount >= 999);
    const verificationPayments = payments.filter((p) => p.type === 'verification_service' || p.amount === 299);

    const totalSubscriptionRevenue = subscriptionPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const totalVerificationRevenue = verificationPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const totalRevenue = totalSubscriptionRevenue + totalVerificationRevenue;

    const paidToday = payments.filter((p) => p.createdAt && new Date(p.createdAt) >= startOfToday);
    const paidThisMonth = payments.filter((p) => p.createdAt && new Date(p.createdAt) >= startOfMonth);

    const todaysRevenue = paidToday.reduce((sum, p) => sum + (p.amount || 0), 0);
    const monthlyRevenue = paidThisMonth.reduce((sum, p) => sum + (p.amount || 0), 0);

    const activeSubscriptions = listings.filter((l) => l.subscription?.status === 'active' || l.subscription?.paymentStatus === 'paid').length;
    const trialSubscriptions = listings.filter((l) => l.subscription?.status === 'trial' || l.subscription?.paymentStatus === 'trial').length;
    const expiredSubscriptions = listings.filter((l) => l.subscription?.status === 'expired').length;
    const verifiedProperties = listings.filter((l) => l.verificationService?.paymentStatus === 'paid').length;

    return success(res, {
      message: 'Owner subscription financial statistics computed.',
      data: {
        kpis: {
          todaysRevenue,
          monthlyRevenue,
          totalSubscriptionRevenue,
          totalVerificationRevenue,
          totalRevenue,
          activeSubscriptions,
          trialSubscriptions,
          expiredSubscriptions,
          verifiedProperties,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/finance/transactions ──────────────────────────────────────
/**
 * Paginated list of owner subscription and verification payment transactions.
 */
const getFinanceTransactions = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Number(limit));
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (status && status !== 'all') filter.status = status;

    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('user', 'name email phone role')
        .populate('listing', 'title address type')
        .lean(),
      Payment.countDocuments(filter),
    ]);

    const transactions = payments.map((p) => {
      const isVerif = p.type === 'verification_service' || p.amount === 299;
      const typeLabel = isVerif ? 'On-Site Verification (₹299)' : 'Owner Listing Plan (₹5,999/yr)';

      return {
        id: p._id.toString(),
        orderId: p.orderId,
        paymentId: p.paymentId || p.orderId,
        ownerName: p.user?.name || 'Property Owner',
        ownerEmail: p.user?.email || 'N/A',
        ownerPhone: p.user?.phone || 'N/A',
        propertyTitle: p.listing?.title || (isVerif ? 'Physical Audit Service' : 'Annual Plan Subscription'),
        city: p.listing?.address?.city || 'Indore',
        planType: typeLabel,
        amount: p.amount,
        status: p.status === 'paid' ? 'Paid' : p.status === 'failed' ? 'Failed' : 'Pending',
        gateway: p.gateway || 'Razorpay',
        createdAt: p.createdAt ? new Date(p.createdAt).toLocaleDateString() : 'N/A',
      };
    });

    return success(res, {
      message: 'Owner subscription transactions fetched.',
      data: { transactions },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/admin/finance/transactions/:id/settle ───────────────────────────
/**
 * Settle transaction payout to owner.
 */
const settleFinanceTransaction = async (req, res, next) => {
  try {
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { $set: { status: 'completed', paymentStatus: 'paid' } },
      { new: true }
    );

    return success(res, {
      message: 'Transaction settled and marked paid.',
      data: { booking },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/admin/finance/transactions/:id/refund ──────────────────────────
/**
 * Issue refund for transaction.
 */
const refundFinanceTransaction = async (req, res, next) => {
  try {
    return processBookingRefund(req, res, next);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/support/tickets ───────────────────────────────────────────
/**
 * Fetch support tickets with filtering and pagination.
 */
const getAllSupportTickets = async (req, res, next) => {
  try {
    const { status, priority, category, page = 1, limit = 50 } = req.query;
    const filter = { type: 'ticket' };
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (category) filter.category = category;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Number(limit));
    const skip = (pageNum - 1) * limitNum;

    const [tickets, total] = await Promise.all([
      SupportTicket.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('user', 'name email phone role')
        .populate('property', 'title address images')
        .populate('booking', 'reservationId pricing')
        .lean(),
      SupportTicket.countDocuments(filter),
    ]);

    return success(res, {
      message: 'Support tickets fetched successfully.',
      data: { tickets },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/admin/support/tickets ──────────────────────────────────────────
/**
 * Create a new support ticket or ops report.
 */
const createSupportTicket = async (req, res, next) => {
  try {
    const { subject, message, priority, category, userName, userEmail, userPhone, userRole, propertyId, bookingId } = req.body;
    const ticketId = `TCK-${Math.floor(1000 + Math.random() * 9000)}`;

    const ticket = await SupportTicket.create({
      ticketId,
      type: 'ticket',
      subject: subject || 'Support Request',
      category: category || 'General',
      priority: priority || 'medium',
      status: 'open',
      userName: userName || req.user.name || 'User',
      userEmail: userEmail || req.user.email || 'user@example.com',
      userPhone: userPhone || req.user.phone || 'N/A',
      userRole: userRole || req.user.role || 'seeker',
      property: propertyId || null,
      booking: bookingId || null,
      messages: message ? [{ sender: req.user.name || 'User', senderRole: req.user.role || 'User', message, timestamp: new Date() }] : [],
    });

    return success(res, { message: 'Support ticket created successfully.', data: { ticket }, statusCode: 201 });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/admin/support/tickets/:id ────────────────────────────────────────
/**
 * Update support ticket status, priority, or reply.
 */
const updateSupportTicket = async (req, res, next) => {
  try {
    const { status, priority, resolutionNotes, replyMessage } = req.body;
    const update = {};
    if (status) update.status = status;
    if (priority) update.priority = priority;
    if (resolutionNotes) update.resolutionNotes = resolutionNotes;

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) {
      return error(res, { message: 'Support ticket not found.', statusCode: 404 });
    }

    if (replyMessage) {
      ticket.messages.push({
        sender: req.user.name || 'Admin Support',
        senderRole: 'Admin',
        message: replyMessage,
        timestamp: new Date(),
      });
    }

    Object.assign(ticket, update);
    await ticket.save();

    return success(res, { message: 'Support ticket updated successfully.', data: { ticket } });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/admin/support/tickets/bulk-status ──────────────────────────────
/**
 * Bulk resolve or close support tickets.
 */
const bulkUpdateSupportTickets = async (req, res, next) => {
  try {
    const { ticketIds, status } = req.body;
    if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
      return error(res, { message: 'ticketIds array is required.', statusCode: 400 });
    }

    await SupportTicket.updateMany({ _id: { $in: ticketIds } }, { $set: { status: status || 'resolved' } });

    return success(res, { message: `Updated ${ticketIds.length} ticket(s) to '${status || 'resolved'}'.`, data: { updatedIds: ticketIds } });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/trust-safety/reports ───────────────────────────────────────
/**
 * Fetch Trust & Safety Incident Reports.
 */
const getTrustSafetyReports = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const filter = { type: { $in: ['trust_safety_report', 'incident', 'dispute', 'fraud'] } };
    if (status) filter.status = status;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Number(limit));
    const skip = (pageNum - 1) * limitNum;

    const [reports, total] = await Promise.all([
      SupportTicket.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('user', 'name email phone')
        .populate('property', 'title address images owner')
        .lean(),
      SupportTicket.countDocuments(filter),
    ]);

    return success(res, {
      message: 'Trust & safety reports fetched successfully.',
      data: { reports },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/admin/reviews/:id/status ────────────────────────────────────────
/**
 * Update review status (publish, hide, flag, delete).
 */
const updateAdminReviewStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['published', 'pending', 'flagged', 'hidden', 'deleted'].includes(status)) {
      return error(res, { message: 'Invalid review status.', statusCode: 400 });
    }

    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true }
    );

    if (!review) {
      return error(res, { message: 'Review not found.', statusCode: 404 });
    }

    return success(res, { message: `Review marked as '${status}'.`, data: { review } });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/admin/reviews/:id ────────────────────────────────────────────
/**
 * Delete a review (Admin moderation).
 */
const deleteAdminReview = async (req, res, next) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.id);
    if (!review) {
      return error(res, { message: 'Review not found.', statusCode: 404 });
    }
    return success(res, { message: 'Review deleted successfully.' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getDashboardStats,
  getAllListings,
  getListingById,
  updateListing,
  verifyListing,
  setListingStatus,
  reassignListingOwner,
  getAllUsers,
  setUserRole,
  updateUserStatus,
  updateUserKyc,
  deleteUser,
  bulkUpdateUsersStatus,
  assignAccountManager,
  broadcastNotification,
  getAllBookings,
  updateAdminBookingStatus,
  processBookingRefund,
  bulkUpdateBookings,
  assignBookingExecutive,
  getFinanceStats,
  getFinanceTransactions,
  settleFinanceTransaction,
  refundFinanceTransaction,
  getAllSupportTickets,
  createSupportTicket,
  updateSupportTicket,
  bulkUpdateSupportTickets,
  getTrustSafetyReports,
  getAllReviews,
  updateAdminReviewStatus,
  deleteAdminReview,
  getAuditLogs,
  getSystemSettings,
  updateSystemSetting,
};

