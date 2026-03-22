/**
 * Guardrails Module
 *
 * Unified entry point for all guardrail components:
 * - Output sanitization
 * - Prompt injection detection
 * - Rate limiting
 * - Token budget enforcement
 * - Circuit breakers
 * - Tool result caching
 */

const sanitizer = require('./sanitizer');
const injectionDetector = require('./injection-detector');
const rateLimiter = require('./rate-limiter');
const tokenBudget = require('./token-budget');
const circuitBreaker = require('./circuit-breaker');
const resultCache = require('./result-cache');

/**
 * Clear all guardrail state (for testing).
 */
function clearAll() {
  rateLimiter.clearLimits();
  tokenBudget.clearAll();
  circuitBreaker.clearAll();
  resultCache.clearCache();
}

module.exports = {
  sanitizer,
  injectionDetector,
  rateLimiter,
  tokenBudget,
  circuitBreaker,
  resultCache,
  clearAll,
};
