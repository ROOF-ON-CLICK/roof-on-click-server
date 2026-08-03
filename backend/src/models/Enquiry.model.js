const mongoose = require('mongoose');

const enquirySchema = new mongoose.Schema(
  {
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: [true, 'Listing reference is required'],
    },
    seeker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null, // null if submitted without login
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    message: {
      type: String,
      trim: true,
      maxlength: [500, 'Message cannot exceed 500 characters'],
    },
    status: {
      type: String,
      enum: ['new', 'seen', 'closed'],
      default: 'new',
    },
  },
  {
    timestamps: true,
  }
);

// Index for owner to quickly fetch enquiries on their listings
enquirySchema.index({ listing: 1, status: 1 });
enquirySchema.index({ seeker: 1 });

module.exports = mongoose.model('Enquiry', enquirySchema);
