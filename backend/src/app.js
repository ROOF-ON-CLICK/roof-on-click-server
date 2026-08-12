const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const passport = require('passport');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

// Route imports
const authRoutes = require('./routes/auth.routes');
const listingRoutes = require('./routes/listing.routes');
const userRoutes = require('./routes/user.routes');
const enquiryRoutes = require('./routes/enquiry.routes');
const adminRoutes = require('./routes/admin.routes');
const bookingRoutes = require('./routes/booking.routes');
const reviewRoutes = require('./routes/review.routes');

// Middleware imports
const errorHandler = require('./middleware/errorHandler.middleware');

// Passport config
require('./config/passport');

const app = express();

// ─── Security & Utility Middleware ───────────────────────────────────────────
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── CORS ─────────────────────────────────────────────────────────────────────
// ENV=dev  → allow all origins (for local development)
// ENV=prod → restrict to FRONTEND_URL only
const corsOrigin =
  process.env.ENV === 'prod' ? process.env.FRONTEND_URL : '*';

app.use(
  cors({
    origin: corsOrigin,
    credentials: process.env.ENV === 'prod', // credentials require a specific origin
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  })
);

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Passport ─────────────────────────────────────────────────────────────────
app.use(passport.initialize());

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'RoofOnClick API is running 🏠', timestamp: new Date() });
});

// ─── Swagger UI ───────────────────────────────────────────────────────────────
// Available at: http://localhost:5000/api/docs
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'RoofOnClick API Docs',
    customCss: '.swagger-ui .topbar { background-color: #1a1a2e; }',
    swaggerOptions: { persistAuthorization: true },
  })
);

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/users', userRoutes);
app.use('/api/enquiries', enquiryRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/reviews', reviewRoutes);

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
