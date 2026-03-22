/**
 * Structured Logger
 *
 * JSON structured logging for agent observability. Every tool call, LLM request,
 * router call, and request summary is logged as a single JSON line.
 *
 * Never logs passwords, tokens, API keys, or PII beyond userId.
 */

const config = require('../config');
const { sanitizeForLog } = require('../guardrails/sanitizer');

// ---------------------------------------------------------------------------
// Log Levels
// ---------------------------------------------------------------------------

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Get the current minimum log level from config.
 */
function getLogLevel() {
  return LOG_LEVELS[config.observability.logLevel] ?? LOG_LEVELS.info;
}

/**
 * Internal log emitter. Writes a JSON line to stdout if the event level
 * meets the configured minimum.
 *
 * @param {string} level - Log level (debug, info, warn, error)
 * @param {object} event - Structured event data
 */
function emit(level, event) {
  if ((LOG_LEVELS[level] ?? LOG_LEVELS.info) < getLogLevel()) return;

  const line = {
    ...event,
    level,
    timestamp: event.timestamp || new Date().toISOString(),
  };

  // Allow output sink override for testing
  if (logger._sink) {
    logger._sink(line);
  } else {
    console.log(JSON.stringify(line));
  }
}

// ---------------------------------------------------------------------------
// Logging Functions
// ---------------------------------------------------------------------------

/**
 * Log a tool execution event.
 *
 * @param {string} toolName - Name of the tool
 * @param {object} params - Tool parameters (will be sanitized)
 * @param {object} context - { traceId, conversationId, userId, role }
 * @param {object} result - { success, code?, error? }
 * @param {number} durationMs - Execution time in milliseconds
 */
function logToolExecution(toolName, params, context, result, durationMs) {
  emit('info', {
    type: 'tool_execution',
    traceId: context.traceId,
    conversationId: context.conversationId,
    tool: toolName,
    userId: context.userId,
    role: context.role,
    params: sanitizeForLog(params),
    success: result.success !== false,
    errorCode: result.code || null,
    durationMs,
  });
}

/**
 * Log an LLM call event.
 *
 * @param {string} model - Model identifier
 * @param {object} usage - { inputTokens, outputTokens, cachedTokens }
 * @param {number} durationMs - Call duration in milliseconds
 * @param {string} traceId - Request trace ID
 * @param {object} [extra] - Optional extra fields (provider, toolCallCount, cost)
 */
function logLLMCall(model, usage, durationMs, traceId, extra = {}) {
  const inputTokens = usage.inputTokens || 0;
  const outputTokens = usage.outputTokens || 0;
  const cachedTokens = usage.cachedTokens || 0;
  const cacheHitRate =
    inputTokens > 0 ? ((cachedTokens / inputTokens) * 100).toFixed(1) + '%' : '0%';

  emit('info', {
    type: 'llm_call',
    traceId,
    provider: extra.provider || config.llm.provider,
    model,
    inputTokens,
    outputTokens,
    cachedTokens,
    cacheHitRate,
    toolCallCount: extra.toolCallCount ?? 0,
    durationMs,
    cost: extra.cost ?? null,
  });
}

/**
 * Log a router invocation event.
 *
 * @param {string[]} categories - Selected categories
 * @param {number} toolCount - Number of tools loaded
 * @param {number} durationMs - Router call duration in milliseconds
 * @param {string} traceId - Request trace ID
 * @param {object} [extra] - Optional extra fields (cached, fallback)
 */
function logRouterCall(categories, toolCount, durationMs, traceId, extra = {}) {
  emit('info', {
    type: 'router_call',
    traceId,
    selectedCategories: categories,
    toolCount,
    cached: extra.cached ?? false,
    fallback: extra.fallback ?? false,
    durationMs,
  });
}

/**
 * Log a full agent request summary (emitted at the end of each request).
 *
 * @param {string} traceId - Request trace ID
 * @param {object} summary - Aggregated request stats
 */
function logAgentRequest(traceId, summary) {
  const totalInput = summary.totalInputTokens || 0;
  const totalCached = summary.totalCachedTokens || 0;
  const cacheHitRate =
    totalInput > 0 ? ((totalCached / totalInput) * 100).toFixed(1) + '%' : '0%';

  emit('info', {
    type: 'agent_request',
    traceId,
    conversationId: summary.conversationId,
    userId: summary.userId,
    messageLength: summary.messageLength ?? 0,
    routerUsed: summary.routerUsed ?? false,
    routedCategories: summary.routedCategories || [],
    llmCalls: summary.llmCalls || 0,
    toolCalls: summary.toolCalls || 0,
    tools: summary.tools || [],
    totalInputTokens: totalInput,
    totalOutputTokens: summary.totalOutputTokens || 0,
    totalCachedTokens: totalCached,
    cacheHitRate,
    totalCost: summary.totalCost || 0,
    totalDurationMs: summary.totalDurationMs || 0,
  });
}

/**
 * Log a warning event.
 */
function warn(message, context = {}) {
  emit('warn', { type: 'warning', message, ...context });
}

/**
 * Log an error event.
 */
function error(message, context = {}) {
  emit('error', { type: 'error', message, ...context });
}

/**
 * Log a debug event.
 */
function debug(message, context = {}) {
  emit('debug', { type: 'debug', message, ...context });
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const logger = {
  logToolExecution,
  logLLMCall,
  logRouterCall,
  logAgentRequest,
  warn,
  error,
  debug,
  LOG_LEVELS,
  // Test support
  _sink: null,
};

module.exports = logger;
