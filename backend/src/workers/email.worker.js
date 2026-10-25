'use strict';

const emailService = require('../services/email.service');
const User = require('../models/User.model');

/**
 * Handles transactional notification emails and auth-related emails.
 */
async function processEmailNotification({ type, payload }) {
  switch (type) {
    case 'NOTIFICATION_EMAIL': {
      const { notification, recipientId } = payload;
      const recipientUser = await User.findById(recipientId).select('name email phone role');
      if (!recipientUser || !recipientUser.email) return;
      await emailService.dispatchNotificationEmail(notification, recipientUser);
      break;
    }

    case 'PASSWORD_RESET': {
      const { email, name, rawToken } = payload;
      await emailService.sendPasswordResetEmail(email, name, rawToken);
      break;
    }

    case 'WELCOME_EMAIL': {
      const { email, name, role } = payload;
      await emailService.sendWelcomeEmail(email, name, role);
      break;
    }

    case 'OAUTH_ACCOUNT_EMAIL': {
      const { email, name } = payload;
      await emailService.sendOAuthAccountEmail(email, name);
      break;
    }

    default:
      console.warn(`[email.worker] Unrecognized email task type: ${type}`);
  }
}

module.exports = {
  processEmailNotification,
};
