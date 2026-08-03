const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner is required'],
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    type: {
      type: String,
      enum: ['hostel', 'pg', 'shared-room', 'private-room'],
      required: [true, 'Listing type is required'],
    },
    gender: {
      type: String,
      enum: ['boys', 'girls', 'co-ed'],
      required: [true, 'Gender preference is required'],
    },
    description: {
      type: String,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },

    // ─── Location ──────────────────────────────────────────────────────────
    address: {
      street: { type: String, trim: true },
      area: {
        type: String,
        required: [true, 'Area is required'],
        trim: true,
      },
      city: {
        type: String,
        default: 'Indore',
        trim: true,
      },
      pincode: { type: String, trim: true },
      coordinates: {
        type: {
          type: String,
          enum: ['Point'],
          default: 'Point',
        },
        coordinates: {
          type: [Number], // [longitude, latitude]
          default: undefined,
        },
      },
    },

    // ─── Pricing ───────────────────────────────────────────────────────────
    rent: {
      monthly: {
        type: Number,
        required: [true, 'Monthly rent is required'],
        min: [0, 'Rent cannot be negative'],
      },
      deposit: {
        type: Number,
        default: 0,
        min: [0, 'Deposit cannot be negative'],
      },
      foodIncluded: {
        type: Boolean,
        default: false,
      },
    },

    // ─── Details ───────────────────────────────────────────────────────────
    amenities: {
      type: [String],
      default: [],
    },
    sharingOptions: {
      type: [Number], // e.g. [1, 2, 3] for single, double, triple
      default: [],
    },
    availableFrom: {
      type: Date,
      default: Date.now,
    },
    totalRooms: {
      type: Number,
      default: 0,
      min: 0,
    },
    availableRooms: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ─── Media ─────────────────────────────────────────────────────────────
    photos: [
      {
        url: { type: String, required: true },  // CDN/S3 public URL
        key: { type: String, required: true },  // S3 object key for deletion
      },
    ],

    // ─── Contact ───────────────────────────────────────────────────────────
    ownerWhatsapp: {
      type: String,
      trim: true,
    },

    // ─── Status & Verification ─────────────────────────────────────────────
    status: {
      type: String,
      enum: ['active', 'inactive', 'deleted'],
      default: 'active',
    },
    isVerified: {
      type: Boolean,
      default: false, // Admin sets to true → "Assured" badge
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // ─── Engagement ────────────────────────────────────────────────────────
    viewCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ────────────────────────────────────────────────────────────────
// Geospatial index for location-based queries
listingSchema.index({ 'address.coordinates': '2dsphere' });

// Compound index for common filter combinations
listingSchema.index({ 'address.area': 1, 'rent.monthly': 1, gender: 1 });

// Additional indexes for filtering
listingSchema.index({ type: 1, status: 1 });
listingSchema.index({ isVerified: 1 });
listingSchema.index({ owner: 1 });

// Text search index on title, description, area
listingSchema.index(
  { title: 'text', description: 'text', 'address.area': 'text' },
  { name: 'listing_text_search' }
);

module.exports = mongoose.model('Listing', listingSchema);
