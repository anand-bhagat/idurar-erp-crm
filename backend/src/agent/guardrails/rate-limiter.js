/**
 * Rate Limiter
 *
 * Per-user, per-conversation, and per-tool sliding window rate limiting.
 * Uses a token bucket variant with timestamp arrays.
 */

const config = require('../config');

/**
 * Sliding window stores.
 * Key format: "type:identifier" → array of timestamps.
 */
const windows = new Map();

/**
 * Get or create a sliding window for a key.
 *
 * @param {string} key - Window key
 * @param {number} windowMs - Window duration in ms
 * @returns {number[]} Array of timestamps (mutated in place)
 */
function getWindow(key, windowMs) {
  const now = Date.now();
  let timestamps = windows.get(key);

  if (!timestamps) {
    timestamps = [];
    windows.set(key, timestamps);
  }

  // Evict expired timestamps
  const cutoff = now - windowMs;
  while (timestamps.length > 0 && timestamps[0] <= cutoff) {
    timestamps.shift();
  }

  return timestamps;
}

/**
 * Check if a request is allowed under rate limits.
 * Records the request if allowed.
 *
 * @param {string} key - Rate limit key
 * @param {number} windowMs - Window duration in ms
 * @param {number} maxRequests - Max requests per window
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs?: number }}
 */
function checkLimit(key, windowMs, maxRequests) {
  const timestamps = getWindow(key, windowMs);

  if (timestamps.length >= maxRequests) {
    const oldestInWindow = timestamps[0];
    const retryAfterMs = oldestInWindow + windowMs - Date.now();
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, retryAfterMs),
    };
  }

  timestamps.push(Date.now());
  return {
    allowed: true,
    remaining: maxRequests - timestamps.length,
  };
}

/**
 * Check per-user rate limit.
 *
 * @param {string} userId - User identifier
 * @returns {{ allowed: boolean, error?: string, remaining?: number, retryAfterMs?: number }}
 */
function checkUserLimit(userId) {
  if (!config.guardrails.rateLimiting.enabled || !userId) {
    return { allowed: true };
  }

  const { windowMs, maxRequests } = config.guardrails.rateLimiting.perUser;
  const result = checkLimit(`user:${userId}`, windowMs, maxRequests);

  if (!result.allowed) {
    return {
      allowed: false,
      error: `Rate limit exceeded. Please wait ${Math.ceil(result.retryAfterMs / 1000)} seconds before trying again.`,
      remaining: 0,
      retryAfterMs: result.retryAfterMs,
    };
  }

  return { allowed: true, remaining: result.remaining };
}

/**
 * Check per-conversation rate limit.
 *
 * @param {string} conversationId - Conversation identifier
 * @returns {{ allowed: boolean, error?: string, remaining?: number, retryAfterMs?: number }}
 */
function checkConversationLimit(conversationId) {
  if (!config.guardrails.rateLimiting.enabled || !conversationId) {
    return { allowed: true };
  }

  const { windowMs, maxRequests } = config.guardrails.rateLimiting.perConversation;
  const result = checkLimit(`conv:${conversationId}`, windowMs, maxRequests);

  if (!result.allowed) {
    return {
      allowed: false,
      error: `Too many messages in this conversation. Please wait ${Math.ceil(result.retryAfterMs / 1000)} seconds.`,
      remaining: 0,
      retryAfterMs: result.retryAfterMs,
    };
  }

  return { allowed: true, remaining: result.remaining };
}

/**
 * Check per-tool rate limit.
 *
 * @param {string} toolName - Tool name
 * @param {string} userId - User identifier (scoped per user)
 * @returns {{ allowed: boolean, error?: string, remaining?: number, retryAfterMs?: number }}
 */
function checkToolLimit(toolName, userId) {
  if (!config.guardrails.rateLimiting.enabled || !toolName) {
    return { allowed: true };
  }

  const { windowMs, maxRequests } = config.guardrails.rateLimiting.perTool;
  const key = userId ? `tool:${toolName}:${userId}` : `tool:${toolName}`;
  const result = checkLimit(key, windowMs, maxRequests);

  if (!result.allowed) {
    return {
      allowed: false,
      error: `Tool "${toolName}" rate limit exceeded. Please wait ${Math.ceil(result.retryAfterMs / 1000)} seconds.`,
      remaining: 0,
      retryAfterMs: result.retryAfterMs,
    };
  }

  return { allowed: true, remaining: result.remaining };
}

/**
 * Check all applicable rate limits for a request.
 *
 * @param {object} context - { userId, conversationId }
 * @returns {{ allowed: boolean, error?: string, type?: string }}
 */
function checkAllLimits(context) {
  if (!config.guardrails.rateLimiting.enabled) {
    return { allowed: true };
  }

  const userCheck = checkUserLimit(context.userId);
  if (!userCheck.allowed) {
    return { ...userCheck, type: 'user' };
  }

  const convCheck = checkConversationLimit(context.conversationId);
  if (!convCheck.allowed) {
    return { ...convCheck, type: 'conversation' };
  }

  return { allowed: true };
}

/**
 * Clear all rate limit windows (for testing).
 */
function clearLimits() {
  windows.clear();
}

module.exports = {
  checkUserLimit,
  checkConversationLimit,
  checkToolLimit,
  checkAllLimits,
  clearLimits,
  // Exposed for testing
  _windows: windows,
};
