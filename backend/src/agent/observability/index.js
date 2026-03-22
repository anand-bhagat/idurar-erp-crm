/**
 * Observability Module
 *
 * Unified entry point for agent logging, metrics, and tracing.
 * Wires structured logging and metrics collection into the engine's
 * observability hooks.
 */

const logger = require('./logger');
const metrics = require('./metrics');

/**
 * Create observability hooks for the engine.
 *
 * Returns an object compatible with engine.setHooks() that logs and records
 * metrics for every tool execution, LLM call, and router decision.
 *
 * @returns {object} Hooks object for engine.setHooks()
 */
function createHooks() {
  return {
    onToolExecution({ tool, params, result, durationMs, context }) {
      const success = result.success !== false;

      // Log
      logger.logToolExecution(tool, params, context, result, durationMs);

      // Metrics
      metrics.recordToolCall(tool, durationMs, success);
    },

    onLLMCall({ model, usage, durationMs, traceId, toolCallCount, cost }) {
      // Log
      logger.logLLMCall(model, usage, durationMs, traceId, { toolCallCount, cost });

      // Metrics
      metrics.recordLLMCall(usage, durationMs, cost);
    },

    onRequestTrace({ traceId, selectedCategories, toolCount, cached, fallback, durationMs }) {
      // Log
      logger.logRouterCall(selectedCategories, toolCount, durationMs || 0, traceId, {
        cached,
        fallback,
      });

      // Metrics
      metrics.recordRouterCall(durationMs || 0, cached, fallback);
    },
  };
}

/**
 * Log a request summary and record conversation metrics.
 *
 * Call this at the end of each agent request after the agentic loop completes.
 *
 * @param {string} traceId
 * @param {object} summary - Accumulated request stats
 */
function finalizeRequest(traceId, summary) {
  logger.logAgentRequest(traceId, summary);

  if (summary.conversationId && summary.userId) {
    metrics.recordConversation(summary.conversationId, summary.userId, summary);
  }
}

module.exports = {
  logger,
  metrics,
  createHooks,
  finalizeRequest,
};
