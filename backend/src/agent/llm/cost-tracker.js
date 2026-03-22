/**
 * Cost Tracker
 *
 * Tracks token usage and calculates costs with cache-aware pricing.
 * Produces structured JSON logs for observability.
 */

const config = require('../config');

let sessionUsage = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCachedTokens: 0,
  totalCost: 0,
  callCount: 0,
};

/**
 * Track usage from an LLM call and calculate cost.
 *
 * Cost formula:
 *   inputCost  = (inputTokens - cachedTokens) / 1M × input_rate
 *   cachedCost = cachedTokens / 1M × cached_rate
 *   outputCost = outputTokens / 1M × output_rate
 *
 * @param {Object} usage - { inputTokens, outputTokens, cachedTokens }
 * @param {string} model - Model name (lowercase)
 */
function trackUsage(usage, model) {
  const pricing = config.llm.costTracking.pricing[model];
  if (!pricing) return;

  const cachedTokens = usage.cachedTokens || 0;
  const inputCost = ((usage.inputTokens - cachedTokens) / 1_000_000) * pricing.input;
  const cachedCost = (cachedTokens / 1_000_000) * (pricing.cached || pricing.input * 0.1);
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;
  const totalCost = inputCost + cachedCost + outputCost;

  sessionUsage.totalInputTokens += usage.inputTokens;
  sessionUsage.totalOutputTokens += usage.outputTokens;
  sessionUsage.totalCachedTokens += cachedTokens;
  sessionUsage.totalCost += totalCost;
  sessionUsage.callCount++;

  // Structured log
  console.log(
    JSON.stringify({
      type: 'llm_usage',
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedTokens,
      cacheHitRate:
        usage.inputTokens > 0
          ? ((cachedTokens / usage.inputTokens) * 100).toFixed(1) + '%'
          : '0%',
      cost: totalCost.toFixed(6),
      timestamp: new Date().toISOString(),
    })
  );

  return { inputCost, cachedCost, outputCost, totalCost };
}

/**
 * Get accumulated session usage stats.
 */
function getSessionUsage() {
  return { ...sessionUsage };
}

/**
 * Reset session usage counters (for testing or session boundaries).
 */
function resetSessionUsage() {
  sessionUsage = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    totalCost: 0,
    callCount: 0,
  };
}

module.exports = { trackUsage, getSessionUsage, resetSessionUsage };
