const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    actorRole: {
      type: String,
      default: 'admin',
    },
    action: {
      type: String,
      required: true, // e.g., 'listing_approved', 'listing_rejected', 'listing_edited', 'user_banned', 'user_verified'
      trim: true,
    },
    targetType: {
      type: String,
      required: true, // e.g., 'Listing', 'User', 'Booking', 'Review', 'SupportTicket', 'Payment', 'SystemSetting'
      enum: ['Listing', 'User', 'Booking', 'Review', 'SupportTicket', 'Payment', 'SystemSetting'],
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'targetType',
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
      default: '',
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

auditLogSchema.index({ targetId: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
