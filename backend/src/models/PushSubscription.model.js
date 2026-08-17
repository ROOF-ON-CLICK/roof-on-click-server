const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    endpoint: {
      type: String,
      required: [true, 'Push endpoint is required'],
      unique: true,
      trim: true,
    },
    keys: {
      p256dh: {
        type: String,
        required: [true, 'p256dh key is required'],
      },
      auth: {
        type: String,
        required: [true, 'auth key is required'],
      },
    },
    userAgent: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

pushSubscriptionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
