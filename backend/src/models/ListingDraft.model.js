const mongoose = require('mongoose');

const listingDraftSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner is required'],
      unique: true, // 1 active wizard draft per owner
    },
    currentStep: {
      type: Number,
      default: 1,
      min: 1,
      max: 4,
    },
    formValues: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('ListingDraft', listingDraftSchema);
