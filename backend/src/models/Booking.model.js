const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    reservationId: {
      type: String,
      required: true,
      unique: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: true,
    },
    propertyName: {
      type: String,
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    roomType: {
      type: String,
      default: 'Standard Room',
    },
    moveInDate: {
      type: String,
      required: true,
    },
    guestDetails: {
      fullName: { type: String },
      email: { type: String },
      phone: { type: String },
      occupation: { type: String },
    },
    pricing: {
      monthlyRent: { type: Number, required: true },
      securityDeposit: { type: Number, required: true },
      platformFee: { type: Number, default: 0 },
      totalDueNow: { type: Number, required: true },
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'rejected', 'cancelled', 'completed'],
      default: 'pending',
    },
  },
  {
    timestamps: true,
  }
);

bookingSchema.index({ reservationId: 1 });
bookingSchema.index({ property: 1 });
bookingSchema.index({ user: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
