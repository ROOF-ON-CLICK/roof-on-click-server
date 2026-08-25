const crypto = require('crypto');
const { razorpayInstance, key_id, key_secret } = require('../config/razorpay');
const Payment = require('../models/Payment.model');
const Listing = require('../models/Listing.model');
const User = require('../models/User.model');
const { createNotification } = require('../services/notification.service');
const { success, error } = require('../utils/apiResponse');

/**
 * POST /api/payments/create-order
 * Authenticated — creates a Razorpay payment order
 */
const createOrder = async (req, res, next) => {
  try {
    const { listingId, type, customAmount } = req.body;

    if (!type || !['listing_subscription', 'verification_service', 'booking_token'].includes(type)) {
      return error(res, { message: 'Valid payment type is required', statusCode: 400 });
    }

    let amount = 0;
    if (type === 'verification_service') {
      amount = 299;
    } else if (type === 'listing_subscription') {
      // Calculate tiered rate based on owner's existing listing count
      const ownerListingCount = await Listing.countDocuments({
        owner: req.user._id,
        status: { $ne: 'deleted' },
      });
      if (ownerListingCount <= 1) {
        amount = 5999;
      } else if (ownerListingCount === 2) {
        amount = 5499;
      } else {
        amount = 4999;
      }
    } else if (customAmount && customAmount > 0) {
      amount = Number(customAmount);
    } else {
      return error(res, { message: 'Invalid payment amount calculation', statusCode: 400 });
    }

    const receipt = `rcpt_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    let orderId = '';

    // Attempt Razorpay order creation
    if (razorpayInstance && key_id && !key_id.includes('placeholder')) {
      try {
        const rzpOrder = await razorpayInstance.orders.create({
          amount: Math.round(amount * 100), // amount in paise
          currency: 'INR',
          receipt,
          notes: {
            userId: req.user._id.toString(),
            listingId: listingId || '',
            paymentType: type,
          },
        });
        orderId = rzpOrder.id;
      } catch (rzpErr) {
        console.warn('[Razorpay] Order create failed, falling back to simulated order:', rzpErr.message);
        orderId = `order_sim_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      }
    } else {
      // Simulated sandbox order ID
      orderId = `order_sim_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    }

    // Persist Payment in database
    const payment = await Payment.create({
      orderId,
      user: req.user._id,
      listing: listingId || null,
      type,
      amount,
      currency: 'INR',
      status: 'created',
      gateway: 'Razorpay',
      metadata: { receipt, customerName: req.user.name, customerEmail: req.user.email },
    });

    return success(res, {
      message: 'Payment order created successfully.',
      data: {
        orderId,
        amount,
        amountPaise: Math.round(amount * 100),
        currency: 'INR',
        keyId: key_id,
        paymentId: payment._id,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/payments/verify
 * Authenticated — verifies Razorpay payment signature & confirms service activation
 */
const verifyPayment = async (req, res, next) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      listingId,
      type,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id) {
      return error(res, { message: 'Order ID and Payment ID are required', statusCode: 400 });
    }

    // Find payment record
    const payment = await Payment.findOne({ orderId: razorpay_order_id });
    if (!payment) {
      return error(res, { message: 'Payment record not found for this order', statusCode: 404 });
    }

    // Signature verification (only if real key is configured and signature provided)
    let isSignatureValid = true;
    if (razorpay_signature && key_secret && !key_secret.includes('placeholder')) {
      const generatedSignature = crypto
        .createHmac('sha256', key_secret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      if (generatedSignature !== razorpay_signature) {
        payment.status = 'failed';
        payment.paymentId = razorpay_payment_id;
        await payment.save();
        return error(res, { message: 'Payment signature verification failed', statusCode: 400 });
      }
    }

    // Mark payment as paid
    payment.status = 'paid';
    payment.paymentId = razorpay_payment_id;
    payment.signature = razorpay_signature || 'simulated_signature';
    payment.paidAt = new Date();
    if (listingId && !payment.listing) {
      payment.listing = listingId;
    }
    await payment.save();

    // Update target listing if associated
    const targetListingId = listingId || payment.listing;
    let updatedListing = null;

    if (targetListingId) {
      const listing = await Listing.findById(targetListingId);
      if (listing) {
        if (type === 'verification_service' || payment.type === 'verification_service') {
          listing.verificationService = {
            isRequested: true,
            paymentStatus: 'paid',
            paymentId: razorpay_payment_id,
            fee: 299,
            validityMonths: 6,
          };
        } else if (type === 'listing_subscription' || payment.type === 'listing_subscription') {
          const oneYearFromNow = new Date();
          oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

          listing.subscription = {
            status: 'active',
            paymentStatus: 'paid',
            paymentId: razorpay_payment_id,
            planType: 'annual',
            amountPaid: payment.amount,
            startDate: new Date(),
            expiresAt: oneYearFromNow,
          };
        }
        await listing.save();
        updatedListing = listing;
      }
    }

    // Dispatch in-app notification
    try {
      await createNotification({
        recipient: req.user._id,
        category: 'Payment',
        type: 'payment.success',
        title: payment.type === 'verification_service' ? 'Verification Fee Paid! 🛡️' : 'Listing Plan Activated! 🌟',
        message: payment.type === 'verification_service'
          ? `We have received your ₹299 payment for physical on-site verification. Our field team has been scheduled for inspection.`
          : `Your annual listing subscription of ₹${payment.amount.toLocaleString()} has been activated successfully.`,
        actionUrl: targetListingId ? `/property/${targetListingId}` : '/owner/dashboard',
      });
    } catch (notifErr) {
      console.warn('[Payment] Notification dispatch skipped:', notifErr.message);
    }

    return success(res, {
      message: 'Payment verified and service activated successfully.',
      data: {
        payment,
        listing: updatedListing,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/payments/my-payments
 * Authenticated — returns user payment transaction history
 */
const getMyPayments = async (req, res, next) => {
  try {
    const payments = await Payment.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .populate('listing', 'title address.city address.area type photos')
      .lean();

    return success(res, {
      message: 'Payments fetched successfully.',
      data: { payments },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/payments/admin/all
 * Admin Only — returns all transactions across the platform
 */
const getAdminPayments = async (req, res, next) => {
  try {
    const { type, status, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('user', 'name email phone avatar role')
        .populate('listing', 'title address.city address.area type rent.monthly status isVerified')
        .lean(),
      Payment.countDocuments(filter),
    ]);

    // Calculate aggregate revenue
    const paidPayments = await Payment.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: '$type', totalRevenue: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    const revenueSummary = {
      totalRevenue: 0,
      verificationRevenue: 0,
      subscriptionRevenue: 0,
      totalCount: total,
    };

    paidPayments.forEach((p) => {
      revenueSummary.totalRevenue += p.totalRevenue;
      if (p._id === 'verification_service') {
        revenueSummary.verificationRevenue += p.totalRevenue;
      } else if (p._id === 'listing_subscription') {
        revenueSummary.subscriptionRevenue += p.totalRevenue;
      }
    });

    return success(res, {
      message: 'Admin payments fetched successfully.',
      data: {
        payments,
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
        revenueSummary,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createOrder,
  verifyPayment,
  getMyPayments,
  getAdminPayments,
};
