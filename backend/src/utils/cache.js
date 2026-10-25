const crypto = require('crypto');
const redis = require('../config/redis');

/**
 * Cache-Aside wrapper.
 * Returns cached value if available in Redis; otherwise executes `fetcher()`,
 * stores the result in Redis with `ttlSeconds`, and returns the fresh data.
 *
 * Safe-by-design: If Redis fails or is unreachable, it logs a warning and
 * transparently executes the fetcher directly against the database.
 *
 * @param {string} key - Cache key (environment prefix is auto-applied by ioredis)
 * @param {number} ttlSeconds - Expiration time in seconds
 * @param {Function} fetcher - Async callback querying MongoDB
 * @returns {Promise<any>}
 */
async function getOrSetCache(key, ttlSeconds, fetcher) {
  try {
    const cached = await redis.get(key);
    if (cached !== null && cached !== undefined) {
      return JSON.parse(cached);
    }
  } catch (err) {
    console.warn(`[Cache] Redis read failure on key "${key}":`, err.message);
  }

  // Cache miss or Redis unavailable
  const freshData = await fetcher();

  if (freshData !== null && freshData !== undefined) {
    try {
      await redis.setex(key, ttlSeconds, JSON.stringify(freshData));
    } catch (err) {
      console.warn(`[Cache] Redis write failure on key "${key}":`, err.message);
    }
  }

  return freshData;
}

/**
 * Deletes one or more specific cache keys.
 *
 * @param {string|string[]} keys - One or more exact cache keys
 */
async function deleteCacheKeys(keys) {
  if (!keys) return;
  const targetKeys = Array.isArray(keys) ? keys.filter(Boolean) : [keys];
  if (targetKeys.length === 0) return;

  try {
    await redis.del(...targetKeys);
  } catch (err) {
    console.warn('[Cache] Failed to delete cache keys:', err.message);
  }
}

/**
 * Retrieves the current listing version tag.
 * Used to partition search cache keys so that incrementing the version tag
 * instantly invalidates all previous search query caches with zero latency (O(1)).
 */
async function getListingsVersion() {
  try {
    let version = await redis.get('listings:version');
    if (!version) {
      version = '1';
      await redis.set('listings:version', version);
    }
    return version;
  } catch (err) {
    return '1';
  }
}

/**
 * Bumps the global listings version tag.
 * Call this whenever any listing is created, updated, status-changed, or deleted.
 * Instantly invalidates all public listing search caches.
 */
async function bumpListingsVersion() {
  try {
    await redis.incr('listings:version');
  } catch (err) {
    console.warn('[Cache] Failed to bump listings version:', err.message);
  }
}

/**
 * Generates an MD5 deterministic hash of query params for search caching.
 *
 * @param {Object} query - Express req.query object
 * @returns {string}
 */
function hashQuery(query = {}) {
  // Normalize by sorting keys
  const sorted = Object.keys(query)
    .sort()
    .reduce((acc, key) => {
      acc[key] = query[key];
      return acc;
    }, {});
  return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex');
}

/**
 * Master zero-stale invalidator for a property/listing.
 * Clears detail cache, review caches, and bumps search version.
 *
 * @param {string|mongoose.Types.ObjectId} listingId
 */
async function invalidateListingCache(listingId) {
  const idStr = listingId ? listingId.toString() : '';
  const keysToDelete = ['cities:registry'];
  if (idStr) {
    keysToDelete.push(`listing:detail:${idStr}`);
    keysToDelete.push(`reviews:summary:${idStr}`);
    keysToDelete.push(`reviews:list:${idStr}`);
  }

  await Promise.all([
    deleteCacheKeys(keysToDelete),
    bumpListingsVersion(),
  ]);
}

module.exports = {
  getOrSetCache,
  deleteCacheKeys,
  getListingsVersion,
  bumpListingsVersion,
  hashQuery,
  invalidateListingCache,
};
