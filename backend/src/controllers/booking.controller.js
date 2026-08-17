const { randomUUID } = require('crypto');
const Booking = require('../models/Booking.model');
const Listing = require('../models/Listing.model');
const { createNotification } = require('../services/notification.service');
const { success, error } = require('../utils/apiResponse');

// ─── POST /api/bookings ───────────────────────────────────────────────────────
const createBooking = async (req, res, next) => {
  try {
    if (req.user && req.user.role === 'admin') {
      return error(res, { message: 'Admins are platform overseers and cannot place tenant bookings.', statusCode: 403 });
    }

    const { propertyId, propertyName, roomType, moveInDate, guestDetails, pricing } = req.body;

    if (!propertyId || !pricing) {
      return error(res, { message: 'Property ID and pricing details are required.', statusCode: 400 });
    }

    const listing = await Listing.findById(propertyId);
    if (!listing) {
      return error(res, { message: 'Property not found.', statusCode: 404 });
    }

    const reservationId = `RES-${Math.floor(100000 + Math.random() * 900000)}`;

    const booking = await Booking.create({
      reservationId,
      property: listing._id,
      propertyName: propertyName || listing.title,
      user: req.user ? req.user._id : null,
      roomType: roomType || 'Standard Room',
      moveInDate: moveInDate || new Date().toISOString(),
      guestDetails: guestDetails || {},
      pricing: {
        monthlyRent: pricing.monthlyRent || listing.rent.monthly,
        securityDeposit: pricing.securityDeposit || listing.rent.deposit,
        platformFee: pricing.platformFee || 0,
        totalDueNow: pricing.totalDueNow || (pricing.monthlyRent + (pricing.securityDeposit || 0)),
      },
      status: 'pending',
    });

    // ── Notify Property Owner ──
    if (listing.owner) {
      createNotification({
        recipient: listing.owner,
        sender: req.user?._id || null,
        category: 'Booking',
        type: 'booking.created',
        title: 'New Booking Reservation Received',
        message: `New reservation (${reservationId}) received for "${booking.propertyName}" from ${guestDetails?.fullName || 'a guest'}.`,
        actionUrl: '/owner/bookings',
        metadata: {
          bookingId: booking._id,
          reservationId,
          listingId: listing._id,
          totalDueNow: booking.pricing.totalDueNow,
          guestName: guestDetails?.fullName,
          guestPhone: guestDetails?.phone,
        },
      });
    }

    // ── Notify Seeker / Tenant (if logged in) ──
    if (req.user?._id) {
      createNotification({
        recipient: req.user._id,
        category: 'Booking',
        type: 'booking.submitted',
        title: 'Booking Request Submitted',
        message: `Your booking reservation (${reservationId}) for "${booking.propertyName}" was submitted and is pending owner confirmation.`,
        actionUrl: '/profile/bookings',
        metadata: {
          bookingId: booking._id,
          reservationId,
          listingId: listing._id,
          propertyName: booking.propertyName,
        },
      });
    }

    return success(res, {
      message: 'Booking reservation submitted and pending owner confirmation.',
      data: { booking },
      statusCode: 201,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/bookings/my-bookings ───────────────────────────────────────────
const getUserBookings = async (req, res, next) => {
  try {
    const bookings = await Booking.find({ user: req.user._id })
      .populate('property', 'title address photos rent')
      .sort({ createdAt: -1 });

    return success(res, { message: 'User bookings fetched.', data: { bookings } });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/bookings/received ──────────────────────────────────────────────
const getOwnerBookings = async (req, res, next) => {
  try {
    const ownerListings = await Listing.find({ owner: req.user._id }).select('_id');
    const listingIds = ownerListings.map((l) => l._id);

    const bookings = await Booking.find({ property: { $in: listingIds } })
      .populate('property', 'title address')
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 });

    return success(res, { message: 'Owner received bookings fetched.', data: { bookings } });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/bookings/:id/status ────────────────────────────────────────────
const updateBookingStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['pending', 'confirmed', 'rejected', 'cancelled', 'completed'].includes(status)) {
      return error(res, { message: 'Invalid status value.', statusCode: 400 });
    }

    const booking = await Booking.findById(req.params.id).populate('property', 'owner title');
    if (!booking) {
      return error(res, { message: 'Booking not found.', statusCode: 404 });
    }

    if (
      req.user.role !== 'admin' &&
      booking.property?.owner?.toString() !== req.user._id.toString()
    ) {
      return error(res, { message: 'Access denied.', statusCode: 403 });
    }

    booking.status = status;
    await booking.save();

    // ── Notify Tenant / Seeker if linked ──
    if (booking.user) {
      const statusTitle = status.charAt(0).toUpperCase() + status.slice(1);
      createNotification({
        recipient: booking.user,
        sender: req.user._id,
        category: 'Booking',
        type: `booking.${status}`,
        title: `Booking Reservation ${statusTitle}`,
        message: `Your reservation (${booking.reservationId}) for "${booking.propertyName}" has been marked as ${status}.`,
        actionUrl: '/profile/bookings',
        metadata: {
          bookingId: booking._id,
          reservationId: booking.reservationId,
          status,
        },
      });
    }

    return success(res, { message: `Booking status updated to ${status}.`, data: { booking } });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/bookings/:id/cancel ────────────────────────────────────────────
const cancelBooking = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('property', 'owner');
    if (!booking) {
      return error(res, { message: 'Booking not found.', statusCode: 404 });
    }

    if (req.user.role !== 'admin' && booking.user?.toString() !== req.user._id.toString()) {
      return error(res, { message: 'Access denied.', statusCode: 403 });
    }

    booking.status = 'cancelled';
    await booking.save();

    // ── Notify Property Owner ──
    if (booking.property?.owner && booking.property.owner.toString() !== req.user._id.toString()) {
      createNotification({
        recipient: booking.property.owner,
        sender: req.user._id,
        category: 'Booking',
        type: 'booking.cancelled',
        title: 'Booking Reservation Cancelled',
        message: `Reservation (${booking.reservationId}) for "${booking.propertyName}" was cancelled by the tenant.`,
        actionUrl: '/owner/bookings',
        metadata: {
          bookingId: booking._id,
          reservationId: booking.reservationId,
        },
      });
    }

    // ── If Admin cancelled, notify tenant ──
    if (req.user.role === 'admin' && booking.user) {
      createNotification({
        recipient: booking.user,
        sender: req.user._id,
        category: 'Booking',
        type: 'booking.cancelled',
        title: 'Booking Cancelled by Admin',
        message: `Your reservation (${booking.reservationId}) for "${booking.propertyName}" was cancelled by the platform administrator.`,
        actionUrl: '/profile/bookings',
        metadata: {
          bookingId: booking._id,
          reservationId: booking.reservationId,
        },
      });
    }

    return success(res, { message: 'Booking cancelled successfully.', data: { booking } });
  } catch (err) {
    next(err);
  }
};

module.exports = { createBooking, getUserBookings, getOwnerBookings, updateBookingStatus, cancelBooking };
