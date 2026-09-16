const mongoose = require('mongoose');

const bedSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: true,
      trim: true,
      default: 'Bed 1',
    },
    status: {
      type: String,
      enum: ['Vacant', 'Occupied', 'Notice'],
      default: 'Vacant',
    },
    occupiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
    },
    tenantName: {
      type: String,
      default: '',
    },
  },
  { _id: true }
);

const roomInventorySchema = new mongoose.Schema(
  {
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: true,
      index: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    floorNumber: {
      type: Number,
      default: 1,
    },
    roomNumber: {
      type: String,
      required: true,
      trim: true,
    },
    roomType: {
      type: String,
      enum: ['Single Room', 'Double Sharing', 'Triple Sharing', 'Four Sharing', 'Entire Flat', 'Studio'],
      default: 'Single Room',
    },
    totalBeds: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    baseMonthlyRent: {
      type: Number,
      default: 0,
      min: 0,
    },
    attachedBathroom: {
      type: Boolean,
      default: true,
    },
    beds: [bedSchema],
  },
  {
    timestamps: true,
  }
);

roomInventorySchema.index({ propertyId: 1, roomNumber: 1 }, { unique: true });

module.exports = mongoose.model('RoomInventory', roomInventorySchema);
