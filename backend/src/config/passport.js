const passport = require('passport');
const User = require('../models/User.model');
const { sendWelcomeEmail } = require('../services/email.service');
const { createNotification } = require('../services/notification.service');

const isOAuthConfigured =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

if (isOAuthConfigured) {
  const GoogleStrategy = require('passport-google-oauth20').Strategy;

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
        passReqToCallback: true,
      },
      async (req, accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase();
          const googleId = profile.id;
          const name = profile.displayName;
          const avatar = profile.photos?.[0]?.value;

          if (!email) {
            return done(new Error('No email returned from Google'), null);
          }

          // Parse state (holds intent and role if passed)
          let state = {};
          try {
            if (req.query.state) {
              state = JSON.parse(Buffer.from(req.query.state, 'base64').toString('utf-8'));
            }
          } catch {
            state = {};
          }

          const intent = state.intent || 'login'; // 'login' or 'signup'
          const role = state.role === 'owner' ? 'owner' : 'seeker';

          // Try to find existing user by googleId first, then by email
          let user = await User.findOne({ googleId });

          if (!user) {
            user = await User.findOne({ email });
          }

          if (user) {
            // User exists - link Google account if needed
            if (!user.googleId) user.googleId = googleId;
            if (!user.avatar) user.avatar = avatar;
            if (intent === 'signup' && role === 'owner' && user.role !== 'admin') {
              user.role = 'owner';
              user.isTrialActive = true;
              user.trialEndsAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
            }
            await user.save();
            return done(null, user);
          }

          // User does NOT exist
          if (intent === 'login') {
            // Do NOT create an account on login attempt
            const notFoundErr = new Error('ACCOUNT_NOT_FOUND');
            notFoundErr.code = 'ACCOUNT_NOT_FOUND';
            return done(notFoundErr, null);
          }

          // If intent is signup, create brand new user
          const isOwner = role === 'owner';
          const trialEndsAt = isOwner ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) : null;

          user = await User.create({
            name,
            email,
            googleId,
            avatar,
            role,
            isVerified: true, // Google-verified email
            trialEndsAt,
            isTrialActive: isOwner,
          });

          // Send Welcome Email & Notification asynchronously
          (async () => {
            try {
              await sendWelcomeEmail(user.email, user.name, user.role);
              await createNotification({
                recipient: user._id,
                category: 'System',
                type: 'system.welcome',
                title: 'Welcome to RoofOnClick! 🏠',
                message: user.role === 'owner'
                  ? 'Welcome to the RoofOnClick partner network! You can now list verified student accommodations with zero brokerage.'
                  : 'Welcome to RoofOnClick! Start exploring verified student hostels, PGs, and apartments across Indore.',
                actionUrl: user.role === 'owner' ? '/owner/properties' : '/properties',
              });
            } catch (welcomeErr) {
              console.error('[passport] Failed to send welcome email:', welcomeErr.message);
            }
          })();

          return done(null, user);
        } catch (err) {
          return done(err, null);
        }
      }
    )
  );
} else {
  console.warn(
    '⚠️  Google OAuth is NOT configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing). ' +
    'OAuth routes will return 503 until credentials are added to .env'
  );
}

// JWT strategy is stateless — no session serialization needed
module.exports = passport;
