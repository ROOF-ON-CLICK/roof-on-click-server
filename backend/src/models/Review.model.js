const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    userName: {
      type: String,
      required: true,
      trim: true,
    },
    userAvatar: {
      type: String,
      default: 'https://api.dicebear.com/8.x/lorelei/svg?seed=Stayyer',
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    title: {
      type: String,
      trim: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    categoryRatings: {
      cleanliness: { type: Number, default: 5 },
      safety: { type: Number, default: 5 },
      location: { type: Number, default: 5 },
      valueForMoney: { type: Number, default: 5 },
      foodQuality: { type: Number, default: 5 },
      wifi: { type: Number, default: 5 },
      management: { type: Number, default: 5 },
      overall: { type: Number, default: 5 },
    },
    isVerifiedStay: {
      type: Boolean,
      default: true,
    },
    helpfulCount: {
      type: Number,
      default: 0,
    },
    helpfulVotes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    images: [{ type: String }],
    ownerReply: {
      replyText: { type: String },
      replyDate: { type: Date },
      isVerifiedOwner: { type: Boolean, default: true },
    },
  },
  {
    timestamps: true,
  }
);

reviewSchema.index({ property: 1 });
reviewSchema.index({ user: 1 });

module.exports = mongoose.model('Review', reviewSchema);
