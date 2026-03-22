/**
 * Tool Result Cache
 *
 * In-memory TTL cache for read-only tool results. Caches identical calls
 * (same tool name + params) for a short configurable TTL to avoid redundant
 * database queries within the same agentic loop.
 *
 * Only tools registered with `cacheable: true` are cached.
 * Write tools (create/update/delete) are NEVER cached.
 */

const config = require('../config');

// ---------------------------------------------------------------------------
// Internal Storage
// ---------------------------------------------------------------------------

/**
 * Cache store: Map<cacheKey, { result, expiresAt }>
 */
const cache = new Map();

/** Metrics counters */
let hits = 0;
let misses = 0;

// ---------------------------------------------------------------------------
// Cache Key
// ---------------------------------------------------------------------------

/**
 * Build a deterministic cache key from tool name and params.
 * Sorts object keys to ensure identical params produce the same key.
 *
 * @param {string} toolName
 * @param {object} params
 * @returns {string}
 */
function buildCacheKey(toolName, params) {
  const sortedParams = sortObject(params || {});
  return `${toolName}:${JSON.stringify(sortedParams)}`;
}

/**
 * Recursively sort object keys for deterministic serialization.
 */
function sortObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sortObject);
  if (typeof obj !== 'object') return obj;

  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortObject(obj[key]);
  }
  return sorted;
}

// ---------------------------------------------------------------------------
// Cache Operations
// ---------------------------------------------------------------------------

/**
 * Get a cached result for a tool call.
 *
 * @param {string} toolName
 * @param {object} params
 * @returns {{ hit: boolean, result?: object }}
 */
function get(toolName, params) {
  const key = buildCacheKey(toolName, params);
  const entry = cache.get(key);

  if (!entry) {
    misses++;
    return { hit: false };
  }

  // Check TTL
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    misses++;
    return { hit: false };
  }

  hits++;
  return { hit: true, result: entry.result };
}

/**
 * Store a tool result in the cache.
 *
 * @param {string} toolName
 * @param {object} params
 * @param {object} result
 * @param {number} [ttlMs] - Override TTL in milliseconds
 */
function set(toolName, params, result, ttlMs) {
  const ttl = ttlMs ?? config.guardrails.cacheTTL;
  const key = buildCacheKey(toolName, params);

  cache.set(key, {
    result,
    expiresAt: Date.now() + ttl,
  });
}

/**
 * Invalidate all cached results for a specific tool.
 *
 * @param {string} toolName
 */
function invalidateTool(toolName) {
  const prefix = `${toolName}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Clear the entire cache.
 */
function clearCache() {
  cache.clear();
  hits = 0;
  misses = 0;
}

/**
 * Get cache statistics.
 */
function getStats() {
  // Evict expired entries for accurate size
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now > entry.expiresAt) {
      cache.delete(key);
    }
  }

  return {
    size: cache.size,
    hits,
    misses,
    hitRate: hits + misses > 0 ? ((hits / (hits + misses)) * 100).toFixed(1) + '%' : '0%',
  };
}

module.exports = {
  get,
  set,
  invalidateTool,
  clearCache,
  getStats,
  buildCacheKey,
  // Exposed for testing
  _cache: cache,
};
