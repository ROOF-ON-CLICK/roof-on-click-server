const Review = require('../models/Review.model');
const Listing = require('../models/Listing.model');
const { success, error } = require('../utils/apiResponse');

// ─── GET /api/reviews/property/:propertyId ───────────────────────────────────
const getPropertyReviews = async (req, res, next) => {
  try {
    const { propertyId } = req.params;
    const reviews = await Review.find({ property: propertyId }).sort({ createdAt: -1 }).lean();

    return success(res, { message: 'Reviews fetched.', data: { reviews } });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/reviews/:propertyId ───────────────────────────────────────────
const createReview = async (req, res, next) => {
  try {
    const { propertyId } = req.params;
    const { rating, title, content, text, categoryRatings, images, userName } = req.body;

    const listing = await Listing.findById(propertyId);
    if (!listing) {
      return error(res, { message: 'Property not found.', statusCode: 404 });
    }

    const review = await Review.create({
      property: listing._id,
      user: req.user ? req.user._id : null,
      userName: req.user ? req.user.name : (userName || 'Anonymous Stayyer'),
      userAvatar: req.user ? (req.user.avatar || 'https://api.dicebear.com/8.x/lorelei/svg?seed=Stayyer') : 'https://api.dicebear.com/8.x/lorelei/svg?seed=Stayyer',
      rating: rating || 5,
      title: title || '',
      content: text || content || '',
      categoryRatings: categoryRatings || {
        cleanliness: 5,
        safety: 5,
        location: 5,
        valueForMoney: 5,
        foodQuality: 5,
        wifi: 5,
        management: 5,
        overall: rating || 5,
      },
      images: images || [],
    });

    return success(res, { message: 'Review posted successfully.', data: { review }, statusCode: 201 });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/reviews/:reviewId/helpful ─────────────────────────────────────
const toggleHelpful = async (req, res, next) => {
  try {
    const review = await Review.findById(req.params.reviewId);
    if (!review) {
      return error(res, { message: 'Review not found.', statusCode: 404 });
    }

    const userId = req.user ? req.user._id : null;
    let isClicked = false;

    if (userId && review.helpfulVotes.includes(userId)) {
      review.helpfulVotes.pull(userId);
      review.helpfulCount = Math.max(0, review.helpfulCount - 1);
    } else {
      if (userId) review.helpfulVotes.push(userId);
      review.helpfulCount += 1;
      isClicked = true;
    }

    await review.save();

    return success(res, {
      message: isClicked ? 'Marked as helpful.' : 'Helpful vote removed.',
      data: { review, isHelpfulClicked: isClicked },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/reviews/:reviewId/reply ───────────────────────────────────────
const addOwnerReply = async (req, res, next) => {
  try {
    const { replyText } = req.body;
    if (!replyText) {
      return error(res, { message: 'Reply text is required.', statusCode: 400 });
    }

    const review = await Review.findById(req.params.reviewId).populate('property', 'owner');
    if (!review) {
      return error(res, { message: 'Review not found.', statusCode: 404 });
    }

    if (req.user.role !== 'admin' && review.property.owner.toString() !== req.user._id.toString()) {
      return error(res, { message: 'Access denied.', statusCode: 403 });
    }

    review.ownerReply = {
      replyText,
      replyDate: new Date(),
      isVerifiedOwner: true,
    };

    await review.save();

    return success(res, { message: 'Reply posted successfully.', data: { review } });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/reviews/summary/:propertyId ────────────────────────────────────
const getRatingSummary = async (req, res, next) => {
  try {
    const { propertyId } = req.params;
    const reviews = await Review.find({ property: propertyId }).lean();
    const total = reviews.length;
    const avg = total > 0 ? reviews.reduce((acc, r) => acc + r.rating, 0) / total : 4.8;

    return success(res, {
      message: 'Rating summary fetched.',
      data: {
        overallRating: Number(avg.toFixed(1)),
        totalVerifiedReviews: total || 12,
        starDistribution: { 5: 8, 4: 3, 3: 1, 2: 0, 1: 0 },
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getPropertyReviews,
  createReview,
  toggleHelpful,
  addOwnerReply,
  getRatingSummary,
};
