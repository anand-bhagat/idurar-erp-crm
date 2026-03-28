/**
 * Token Budget Enforcement
 *
 * Tracks cumulative token usage per conversation and rejects requests
 * when the budget is exceeded. Budget is configurable in config.js.
 */

const config = require('../config');

/**
 * Per-conversation token usage tracking.
 */
const conversationTokenUsage = new Map();

/**
 * Check if a conversation is within its token budget.
 *
 * @param {string} conversationId - Conversation identifier
 * @param {number} [additionalTokens=0] - Tokens to check against budget (before committing)
 * @returns {{ allowed: boolean, error?: string, used: number, budget: number, remaining: number }}
 */
function checkBudget(conversationId, additionalTokens = 0) {
  if (!config.guardrails.tokenBudget.enabled) {
    return { allowed: true, used: 0, budget: Infinity, remaining: Infinity };
  }

  const budget = config.guardrails.tokenBudget.perConversation;
  const used = conversationTokenUsage.get(conversationId) || 0;
  const projected = used + additionalTokens;

  if (projected > budget) {
    return {
      allowed: false,
      error: 'This conversation has reached its processing limit. Please start a new conversation.',
      used,
      budget,
      remaining: Math.max(0, budget - used),
    };
  }

  return {
    allowed: true,
    used,
    budget,
    remaining: budget - projected,
  };
}

/**
 * Record token usage for a conversation.
 *
 * @param {string} conversationId - Conversation identifier
 * @param {object} usage - { inputTokens, outputTokens, cachedTokens }
 * @returns {number} New total usage
 */
function trackUsage(conversationId, usage) {
  // Only count NEW tokens — subtract cached input tokens which are repeated
  // context (system prompt, tool schemas, prior messages) resent every call.
  // Without this, a 5-message conversation can exhaust the budget because
  // the full context is re-counted on every LLM call.
  const inputTokens = (usage.inputTokens || 0) - (usage.cachedTokens || 0);
  const tokens = Math.max(0, inputTokens) + (usage.outputTokens || 0);
  const current = conversationTokenUsage.get(conversationId) || 0;
  const total = current + tokens;
  conversationTokenUsage.set(conversationId, total);
  return total;
}

/**
 * Get current usage for a conversation.
 *
 * @param {string} conversationId - Conversation identifier
 * @returns {number} Current token usage
 */
function getUsage(conversationId) {
  return conversationTokenUsage.get(conversationId) || 0;
}

/**
 * Reset usage for a conversation.
 *
 * @param {string} conversationId - Conversation identifier
 */
function resetUsage(conversationId) {
  conversationTokenUsage.delete(conversationId);
}

/**
 * Clear all token usage tracking (for testing).
 */
function clearAll() {
  conversationTokenUsage.clear();
}

module.exports = {
  checkBudget,
  trackUsage,
  getUsage,
  resetUsage,
  clearAll,
  // Exposed for testing
  _conversationTokenUsage: conversationTokenUsage,
};
