/**
 * Guardrails Module
 *
 * Unified entry point for all guardrail components:
 * - Output sanitization
 * - Prompt injection detection
 * - Rate limiting
 * - Token budget enforcement
 * - Circuit breakers
 */

const sanitizer = require('./sanitizer');
const injectionDetector = require('./injection-detector');
const rateLimiter = require('./rate-limiter');
const tokenBudget = require('./token-budget');
const circuitBreaker = require('./circuit-breaker');

/**
 * Clear all guardrail state (for testing).
 */
function clearAll() {
  rateLimiter.clearLimits();
  tokenBudget.clearAll();
  circuitBreaker.clearAll();
}

module.exports = {
  sanitizer,
  injectionDetector,
  rateLimiter,
  tokenBudget,
  circuitBreaker,
  clearAll,
};
