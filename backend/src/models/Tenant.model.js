const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: true,
      index: true,
    },
    roomId: {
      type: String,
      trim: true,
    },
    roomNumber: {
      type: String,
      required: true,
      trim: true,
    },
    bedLabel: {
      type: String,
      trim: true,
      default: 'Bed 1',
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      default: '',
    },
    avatar: {
      type: String,
      trim: true,
      default: '',
    },
    documents: [
      {
        name: { type: String, trim: true, required: true },
        url: { type: String, trim: true, required: true },
        type: { type: String, trim: true, default: 'ID Proof' },
        key: { type: String, trim: true, default: '' },
        size: { type: Number, default: 0 },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    emergencyContact: {
      name: { type: String, trim: true, default: '' },
      phone: { type: String, trim: true, default: '' },
      relation: { type: String, trim: true, default: '' },
    },
    moveInDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    monthlyRent: {
      type: Number,
      required: true,
      min: 0,
    },
    securityDeposit: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ['Active', 'Notice', 'Moved Out'],
      default: 'Active',
      index: true,
    },
    noticeDate: {
      type: Date,
      default: null,
    },
    expectedVacateDate: {
      type: Date,
      default: null,
    },
    moveOutDate: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

tenantSchema.index({ ownerId: 1, propertyId: 1, status: 1 });

module.exports = mongoose.model('Tenant', tenantSchema);
