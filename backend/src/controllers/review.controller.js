const mongoose = require('mongoose');
const Review = require('../models/Review.model');
const Listing = require('../models/Listing.model');
const { success, error } = require('../utils/apiResponse');
const { getOrSetCache, deleteCacheKeys } = require('../utils/cache');

// ─── GET /api/reviews/property/:propertyId ───────────────────────────────────
const getPropertyReviews = async (req, res, next) => {
  try {
    const { propertyId } = req.params;
    const cacheKey = `reviews:list:${propertyId}`;

    const reviews = await getOrSetCache(cacheKey, 600, async () => {
      return await Review.find({ property: propertyId, status: { $ne: 'deleted' } })
        .sort({ createdAt: -1 })
        .lean();
    });

    return success(res, { message: 'Reviews fetched.', data: { reviews } });
  } catch (err) {
    next(err);
  }
};

const { uploadBase64ToR2 } = require('../utils/r2Upload');

// ─── POST /api/reviews/:propertyId ───────────────────────────────────────────
const createReview = async (req, res, next) => {
  try {
    const { propertyId } = req.params;
    const { rating, title, content, text, categoryRatings, images, userName } = req.body;

    const listing = await Listing.findById(propertyId);
    if (!listing) {
      return error(res, { message: 'Property not found.', statusCode: 404 });
    }

    const uploadedImages = await Promise.all(
      (images || []).map((img) => uploadBase64ToR2(img, `reviews/${propertyId}`))
    );

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
      images: uploadedImages,
    });

    // Zero-stale cache invalidation for both list and rating summary
    await deleteCacheKeys([`reviews:list:${listing._id}`, `reviews:summary:${listing._id}`]);

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

    // Invalidate review list cache for this property
    await deleteCacheKeys(`reviews:list:${review.property}`);

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

    // Invalidate review list cache for this property
    await deleteCacheKeys(`reviews:list:${review.property._id || review.property}`);

    return success(res, { message: 'Reply posted successfully.', data: { review } });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/reviews/summary/:propertyId ────────────────────────────────────
const getRatingSummary = async (req, res, next) => {
  try {
    const { propertyId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(propertyId)) {
      return error(res, { message: 'Invalid property ID.', statusCode: 400 });
    }

    const cacheKey = `reviews:summary:${propertyId}`;

    const summaryData = await getOrSetCache(cacheKey, 1800, async () => {
      const [aggResult] = await Review.aggregate([
        {
          $match: {
            property: new mongoose.Types.ObjectId(propertyId),
            status: { $ne: 'deleted' },
          },
        },
        {
          $facet: {
            stats: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  avgRating: { $avg: '$rating' },
                },
              },
            ],
            starDistribution: [
              {
                $group: {
                  _id: '$rating',
                  count: { $sum: 1 },
                },
              },
            ],
          },
        },
      ]);

      const stats = aggResult?.stats?.[0];
      const total = stats?.total || 0;
      const avg = total > 0 ? stats.avgRating : 5.0;

      const starDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      if (aggResult?.starDistribution) {
        aggResult.starDistribution.forEach((item) => {
          const star = Math.round(item._id);
          if (star >= 1 && star <= 5) {
            starDistribution[star] = item.count;
          }
        });
      }

      return {
        overallRating: Number(avg.toFixed(1)),
        totalVerifiedReviews: total,
        starDistribution,
      };
    });

    return success(res, {
      message: 'Rating summary fetched.',
      data: summaryData,
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
