const passport = require('passport');
const User = require('../models/User.model');

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
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase();
          const googleId = profile.id;
          const name = profile.displayName;
          const avatar = profile.photos?.[0]?.value;

          if (!email) {
            return done(new Error('No email returned from Google'), null);
          }

          // Try to find existing user by googleId first, then by email
          let user = await User.findOne({ googleId });

          if (!user) {
            // Check if an email/password account exists for this email
            user = await User.findOne({ email });

            if (user) {
              // Link Google account to existing email account
              user.googleId = googleId;
              if (!user.avatar) user.avatar = avatar;
              await user.save();
            } else {
              // Create brand new user
              user = await User.create({
                name,
                email,
                googleId,
                avatar,
                role: 'seeker',
                isVerified: true, // Google-verified email
              });
            }
          }

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
