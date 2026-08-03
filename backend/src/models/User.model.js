const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      default: null, // null for OAuth users
      select: false,
    },
    googleId: {
      type: String,
      default: null,
    },
    avatar: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      enum: ['seeker', 'owner', 'admin'],
      default: 'seeker',
    },
    phone: {
      type: String,
      default: null,
    },
    savedListings: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Listing',
      },
    ],
    // Max 20 entries, FIFO — managed in controller
    recentlyViewed: [
      {
        listingId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Listing',
        },
        viewedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Max 10 entries — managed in controller
    searchHistory: [
      {
        query: String,
        filters: mongoose.Schema.Types.Mixed,
        searchedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    isVerified: {
      type: Boolean,
      default: false,
    },
    // Owner role request flag
    requestedOwnerRole: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster email lookups
userSchema.index({ email: 1 });
userSchema.index({ googleId: 1 });

module.exports = mongoose.model('User', userSchema);
