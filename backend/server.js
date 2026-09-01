require('dotenv').config();
const app = require('./src/app');
const connectDB = require('./src/config/db');
const redis = require('./src/config/redis');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  // ── Step 1: MongoDB ───────────────────────────────────────────────────────
  await connectDB();

  // ── Step 2: Redis ─────────────────────────────────────────────────────────
  try {
    await redis.connect();
    await redis.ping();
    console.log('[Redis] Connected and ready');
  } catch (err) {
    console.error('[Redis] Connection failed:', err.message);
    process.exit(1);
  }

  // ── Step 3: HTTP Server ───────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`[Server] RoofOnClick API running on port ${PORT} [${process.env.NODE_ENV}]`);
  });
};

startServer().catch((err) => {
  console.error('❌ Startup failed:', err.message);
  process.exit(1);
});
