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
      required: [function () { return (this.status || '').toLowerCase() !== 'draft'; }, 'Title is required'],
      default: 'Untitled Property Draft',
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    type: {
      type: String,
      enum: [
        'hostel',
        'pg',
        'shared-room',
        'private-room',
        'apartment',
        'studio',
        'studio-apartment',
        '1-bhk',
        '2-bhk',
        '3-bhk',
        '4-bhk',
        '4+-bhk',
        'rk',
      ],
      required: [function () { return (this.status || '').toLowerCase() !== 'draft'; }, 'Listing type is required'],
      default: 'pg',
    },
    gender: {
      type: String,
      enum: ['boys', 'girls', 'co-ed', 'unisex', 'any', 'co-living'],
      required: [function () { return (this.status || '').toLowerCase() !== 'draft'; }, 'Gender preference is required'],
      default: 'unisex',
    },
    description: {
      type: String,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },

    // ─── Location ──────────────────────────────────────────────────────────
    address: {
      full: { type: String, trim: true },
      street: { type: String, trim: true },
      area: {
        type: String,
        required: [function () { return (this.status || '').toLowerCase() !== 'draft'; }, 'Area is required'],
        trim: true,
        default: '',
      },
      city: {
        type: String,
        required: [function () { return (this.status || '').toLowerCase() !== 'draft'; }, 'City is required'],
        trim: true,
        default: 'Indore',
      },
      pincode: { type: String, trim: true },
      landmark: { type: String, trim: true },
      mapsLink: { type: String, trim: true },
      coordinates: {
        type: {
          type: String,
          enum: ['Point'],
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
        required: [function () { return (this.status || '').toLowerCase() !== 'draft'; }, 'Monthly rent is required'],
        min: [0, 'Rent cannot be negative'],
        default: 0,
      },
      deposit: {
        type: Number,
        default: 0,
        min: [0, 'Deposit cannot be negative'],
      },
      maintenance: {
        type: Number,
        default: 0,
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
    nearby: {
      type: [String],
      default: [],
    },
    sharingOptions: {
      type: [Number], // e.g. [1, 2, 3] for single, double, triple
      default: [],
    },
    rooms: [
      {
        id: { type: String },
        roomType: { type: String },
        sharingType: { type: String },
        monthlyRent: { type: Number },
        securityDeposit: { type: Number },
        totalRooms: { type: Number },
        availableRooms: { type: Number },
        attachedBathroom: { type: Boolean, default: true },
        furnished: { type: String, default: 'Fully Furnished' },
      },
    ],
    rules: {
      smokingAllowed: { type: Boolean, default: false },
      drinkingAllowed: { type: Boolean, default: false },
      visitorsAllowed: { type: Boolean, default: true },
      petsAllowed: { type: Boolean, default: false },
      loudMusicAllowed: { type: Boolean, default: false },
      gateClosingEnabled: { type: Boolean, default: true },
      gateClosingTime: { type: String, default: '10:00 PM' },
    },
    apartmentDetails: {
      bedrooms: { type: String },
      furnished: { type: String },
      kitchenType: { type: String },
      bathroomType: { type: String },
      balcony: { type: Boolean },
      parking: { type: String },
      floorNumber: { type: Number },
      totalFloors: { type: Number },
      liftAvailable: { type: Boolean },
      powerBackup: { type: Boolean },
      security: { type: Boolean },
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
        url: { type: String, required: function () { return (this.status || '').toLowerCase() !== 'draft'; } },  // CDN/S3 public URL
        key: { type: String, required: function () { return (this.status || '').toLowerCase() !== 'draft'; } },  // S3 object key for deletion
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
      enum: ['draft', 'pending', 'active', 'inactive', 'rejected', 'deleted'],
      default: 'pending',
    },
    wizardState: {
      currentStep: {
        type: Number,
        default: 1,
        min: 1,
        max: 6,
      },
      formValues: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
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
    subscription: {
      status: {
        type: String,
        enum: ['trial', 'active', 'expired'],
        default: 'trial',
      },
      paymentStatus: {
        type: String,
        enum: ['trial', 'paid', 'pending', 'failed'],
        default: 'trial',
      },
      paymentId: {
        type: String,
        default: null,
      },
      planType: {
        type: String,
        default: 'annual',
      },
      amountPaid: {
        type: Number,
        default: 0,
      },
      startDate: {
        type: Date,
        default: Date.now,
      },
      expiresAt: {
        type: Date,
        default: null,
      },
    },
    verificationService: {
      isRequested: {
        type: Boolean,
        default: false,
      },
      paymentStatus: {
        type: String,
        enum: ['not_requested', 'paid', 'pending', 'failed'],
        default: 'not_requested',
      },
      paymentMode: {
        type: String,
        enum: ['onsite_upi', 'razorpay', 'free_trial', 'none'],
        default: 'onsite_upi',
      },
      paymentId: {
        type: String,
        default: null,
      },
      fee: {
        type: Number,
        default: 299,
      },
      validityMonths: {
        type: Number,
        default: 6,
      },
      paidAt: {
        type: Date,
        default: null,
      },
      verifiedAt: {
        type: Date,
        default: null,
      },
      expiresAt: {
        type: Date,
        default: null,
      },
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

// ─── Pre-save Strict Validation for Publishing ───────────────────────────────
listingSchema.pre('save', function (next) {
  const currentStatus = (this.status || '').toLowerCase();
  if (currentStatus === 'pending' || currentStatus === 'active') {
    if (!this.title || this.title.trim().length < 3) {
      return next(new Error('Property title is required (at least 3 characters) to submit for approval.'));
    }
    if (!this.address?.city || !this.address.city.trim()) {
      return next(new Error('City is required to submit for approval.'));
    }
    if (!this.address?.area || !this.address.area.trim()) {
      return next(new Error('Area / Locality is required to submit for approval.'));
    }
    if (typeof this.rent?.monthly !== 'number' || this.rent.monthly <= 0) {
      return next(new Error('Valid monthly rent is required to submit for approval.'));
    }
    if (!this.photos || this.photos.length < 5) {
      return next(new Error('At least 5 property photos are required to submit for approval.'));
    }
  }
  next();
});

// ─── Indexes ────────────────────────────────────────────────────────────────
// Geospatial index for location-based queries
listingSchema.index({ 'address.coordinates': '2dsphere' });

// Compound index for common filter combinations — city is the leading key
listingSchema.index({ 'address.city': 1, 'address.area': 1, 'rent.monthly': 1, gender: 1 });

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
