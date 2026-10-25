const Redis = require('ioredis');

const currentEnv = (process.env.NODE_ENV || process.env.ENV || 'development').toLowerCase();
const ENV_PREFIX = currentEnv === 'production' || currentEnv === 'prod' ? 'prod' : 'dev';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true, // connect() is called explicitly in server.js startup sequence
  keyPrefix: `${ENV_PREFIX}:`, // Transparently isolates keys on shared Redis instance
});

redis.on('connect', () => console.log(`[Redis] Connected with prefix [${ENV_PREFIX}:]`));
redis.on('error', (err) => console.error('[Redis] Error:', err.message));

module.exports = redis;
