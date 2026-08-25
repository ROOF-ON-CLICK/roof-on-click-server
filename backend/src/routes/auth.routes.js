const express = require('express');
const passport = require('passport');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');

const {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  getMe,
  googleCallback,
  forgotPassword,
  verifyResetToken,
  resetPassword,
  changePassword,
} = require('../controllers/auth.controller');
const { verifyToken } = require('../middleware/auth.middleware');

const router = express.Router();

// ─── Rate Limiter for auth endpoints ─────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { success: false, message: 'Too many attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Tighter limiter for password reset — 5 requests per 15 min per IP
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many password reset attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
  body('phone')
    .trim()
    .notEmpty()
    .withMessage('Mobile number is required')
    .matches(/^[6-9]\d{9}$|^\+?[1-9]\d{9,14}$/)
    .withMessage('Please enter a valid 10-digit mobile number'),
];

const loginValidation = [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
];

// ─── OAuth Guard ──────────────────────────────────────────────────────────────
// Returns 503 if Google OAuth credentials are not configured yet
const oauthGuard = (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({
      success: false,
      message: 'Google OAuth is not configured on this server. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file.',
    });
  }
  next();
};

// ─── Routes ───────────────────────────────────────────────────────────────────

// Email/password auth
router.post('/register', authLimiter, registerValidation, register);
router.post('/login', authLimiter, loginValidation, login);
router.post('/logout', verifyToken, logout);
router.post('/logout-all', verifyToken, logoutAll);
router.get('/me', verifyToken, getMe);
router.post('/change-password', verifyToken, authLimiter, changePassword);

// Token refresh — rate-limited to prevent abuse
router.post(
  '/refresh',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { success: false, message: 'Too many refresh attempts.' } }),
  body('refreshToken').notEmpty().withMessage('refreshToken is required'),
  refresh
);

// Google OAuth (guarded — returns 503 if not configured)
router.get(
  '/google',
  oauthGuard,
  (req, res, next) => {
    const { intent = 'login', role = 'seeker' } = req.query;
    const state = Buffer.from(JSON.stringify({ intent, role })).toString('base64');
    passport.authenticate('google', {
      scope: ['profile', 'email'],
      session: false,
      state,
    })(req, res, next);
  }
);

router.get(
  '/google/callback',
  oauthGuard,
  (req, res, next) => {
    passport.authenticate('google', { session: false }, (err, user) => {
      if (err) {
        if (err.message === 'ACCOUNT_NOT_FOUND' || err.code === 'ACCOUNT_NOT_FOUND') {
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=account_not_found`);
        }
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_failed`);
      }
      if (!user) {
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_failed`);
      }
      req.user = user;
      next();
    })(req, res, next);
  },
  googleCallback
);

// Password reset
router.post('/forgot-password', resetLimiter, forgotPassword);
router.get('/verify-reset-token', verifyResetToken);
router.post('/reset-password', resetLimiter, resetPassword);

module.exports = router;
