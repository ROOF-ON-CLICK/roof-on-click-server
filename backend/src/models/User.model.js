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
    trialEndsAt: {
      type: Date,
      default: null,
    },
    isTrialActive: {
      type: Boolean,
      default: false,
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
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    isPhoneVerified: {
      type: Boolean,
      default: false,
    },
    dob: {
      type: Date,
      default: null,
    },
    gender: {
      type: String,
      default: null,
    },
    // Owner role request flag
    requestedOwnerRole: {
      type: Boolean,
      default: false,
    },
    // Account Status
    status: {
      type: String,
      enum: ['active', 'suspended', 'blocked', 'inactive'],
      default: 'active',
    },
    // KYC Verification Object
    kyc: {
      status: {
        type: String,
        enum: ['unverified', 'pending', 'verified', 'rejected'],
        default: 'unverified',
      },
      documentType: {
        type: String,
        default: null,
      },
      documentUrl: {
        type: String,
        default: null,
      },
      verifiedAt: {
        type: Date,
        default: null,
      },
      rejectionReason: {
        type: String,
        default: null,
      },
    },
    // Dedicated Account Manager
    accountManager: {
      name: { type: String, default: null },
      email: { type: String, default: null },
      phone: { type: String, default: null },
    },
    // Subscription Plan
    subscriptionPlan: {
      type: String,
      enum: ['Free Tier', 'Silver Tier', 'Gold Tier', 'Enterprise'],
      default: 'Free Tier',
    },
    // Location & Organization profile
    city: {
      type: String,
      default: 'Indore',
    },
    address: {
      type: String,
      default: null,
    },
    institutionOrCompany: {
      type: String,
      default: null,
    },
    // Password Reset — token stored as SHA-256 hash; never the raw token
    resetPasswordToken: {
      type: String,
      default: null,
      select: false, // never returned in normal queries
    },
    resetPasswordExpires: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Removed duplicate index because email has unique: true
userSchema.index({ googleId: 1 });

module.exports = mongoose.model('User', userSchema);
