const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      required: true,
      unique: true,
    },
    type: {
      type: String,
      enum: ['ticket', 'trust_safety_report', 'incident', 'dispute', 'fraud'],
      default: 'ticket',
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    userName: {
      type: String,
      required: true,
    },
    userEmail: {
      type: String,
      default: 'N/A',
    },
    userPhone: {
      type: String,
      default: 'N/A',
    },
    userRole: {
      type: String,
      enum: ['seeker', 'buyer', 'owner', 'guest', 'admin'],
      default: 'seeker',
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      default: null,
    },
    propertyName: {
      type: String,
      default: null,
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    subject: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      enum: [
        'Payment',
        'Listing Accuracy',
        'Harassment',
        'Property Condition',
        'Refund',
        'General',
        'Verification',
        'Safety',
      ],
      default: 'General',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed', 'investigating', 'action_taken'],
      default: 'open',
    },
    messages: [
      {
        sender: { type: String, required: true },
        senderRole: { type: String, default: 'User' },
        message: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    assignedAgent: {
      name: { type: String, default: 'Support Executive' },
      email: { type: String, default: 'support@roofonclick.com' },
    },
    resolutionNotes: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

supportTicketSchema.index({ ticketId: 1 });
supportTicketSchema.index({ type: 1 });
supportTicketSchema.index({ status: 1 });
supportTicketSchema.index({ user: 1 });
supportTicketSchema.index({ property: 1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
