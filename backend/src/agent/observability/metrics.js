/**
 * Metrics Collection
 *
 * In-memory metrics for agent observability. Tracks tool call frequency,
 * latency percentiles, error rates, LLM token usage, and cost.
 *
 * Designed for easy upgrade to OpenTelemetry or Prometheus later.
 */

const config = require('../config');
const logger = require('./logger');

// ---------------------------------------------------------------------------
// Internal Storage
// ---------------------------------------------------------------------------

/** Tool-level metrics: { [toolName]: { calls, errors, latencies[] } } */
const toolMetrics = new Map();

/** LLM call metrics */
const llmMetrics = {
  calls: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCachedTokens: 0,
  totalCost: 0,
  latencies: [],
};

/** Router metrics */
const routerMetrics = {
  calls: 0,
  fallbacks: 0,
  cacheHits: 0,
  latencies: [],
};

/** Per-conversation cost tracking: { [conversationId]: { cost, tokens, toolCalls, llmCalls } } */
const conversationMetrics = new Map();

/** Per-user cost tracking: { [userId]: { cost, tokens, conversations } } */
const userMetrics = new Map();

/** Max latency samples to keep per tool (ring buffer) */
const MAX_LATENCY_SAMPLES = 1000;

// ---------------------------------------------------------------------------
// Recording Functions
// ---------------------------------------------------------------------------

/**
 * Record a tool execution.
 */
function recordToolCall(toolName, durationMs, success) {
  let entry = toolMetrics.get(toolName);
  if (!entry) {
    entry = { calls: 0, errors: 0, latencies: [] };
    toolMetrics.set(toolName, entry);
  }

  entry.calls++;
  if (!success) entry.errors++;

  if (entry.latencies.length >= MAX_LATENCY_SAMPLES) {
    entry.latencies.shift();
  }
  entry.latencies.push(durationMs);
}

/**
 * Record an LLM call.
 */
function recordLLMCall(usage, durationMs, cost = 0) {
  llmMetrics.calls++;
  llmMetrics.totalInputTokens += usage.inputTokens || 0;
  llmMetrics.totalOutputTokens += usage.outputTokens || 0;
  llmMetrics.totalCachedTokens += usage.cachedTokens || 0;
  llmMetrics.totalCost += cost;

  if (llmMetrics.latencies.length >= MAX_LATENCY_SAMPLES) {
    llmMetrics.latencies.shift();
  }
  llmMetrics.latencies.push(durationMs);
}

/**
 * Record a router call.
 */
function recordRouterCall(durationMs, cached, fallback) {
  routerMetrics.calls++;
  if (cached) routerMetrics.cacheHits++;
  if (fallback) routerMetrics.fallbacks++;

  if (routerMetrics.latencies.length >= MAX_LATENCY_SAMPLES) {
    routerMetrics.latencies.shift();
  }
  routerMetrics.latencies.push(durationMs);
}

/**
 * Record per-conversation stats (called at request end).
 */
function recordConversation(conversationId, userId, stats) {
  // Conversation
  let conv = conversationMetrics.get(conversationId);
  if (!conv) {
    conv = { cost: 0, tokens: 0, toolCalls: 0, llmCalls: 0, userId };
    conversationMetrics.set(conversationId, conv);
  }
  conv.cost += stats.totalCost || 0;
  conv.tokens += (stats.totalInputTokens || 0) + (stats.totalOutputTokens || 0);
  conv.toolCalls += stats.toolCalls || 0;
  conv.llmCalls += stats.llmCalls || 0;

  // User
  let user = userMetrics.get(userId);
  if (!user) {
    user = { cost: 0, tokens: 0, conversations: new Set() };
    userMetrics.set(userId, user);
  }
  user.cost += stats.totalCost || 0;
  user.tokens += (stats.totalInputTokens || 0) + (stats.totalOutputTokens || 0);
  user.conversations.add(conversationId);
}

// ---------------------------------------------------------------------------
// Percentile Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate a percentile from a sorted array of values.
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Get latency percentiles from an array of latencies.
 */
function getLatencyPercentiles(latencies) {
  if (latencies.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

// ---------------------------------------------------------------------------
// Summary / Dashboard Data
// ---------------------------------------------------------------------------

/**
 * Get a full metrics snapshot.
 */
function getMetricsSummary() {
  // Tool metrics
  const tools = {};
  for (const [name, entry] of toolMetrics) {
    tools[name] = {
      calls: entry.calls,
      errors: entry.errors,
      errorRate: entry.calls > 0 ? ((entry.errors / entry.calls) * 100).toFixed(1) + '%' : '0%',
      latency: getLatencyPercentiles(entry.latencies),
    };
  }

  // Top tools by usage
  const topToolsByUsage = [...toolMetrics.entries()]
    .sort((a, b) => b[1].calls - a[1].calls)
    .slice(0, 10)
    .map(([name, entry]) => ({ name, calls: entry.calls }));

  // Top tools by error rate
  const topToolsByErrorRate = [...toolMetrics.entries()]
    .filter(([, entry]) => entry.calls >= 3) // Minimum 3 calls to qualify
    .sort((a, b) => b[1].errors / b[1].calls - a[1].errors / a[1].calls)
    .slice(0, 10)
    .map(([name, entry]) => ({
      name,
      errorRate: ((entry.errors / entry.calls) * 100).toFixed(1) + '%',
      calls: entry.calls,
      errors: entry.errors,
    }));

  // Average chain length (tool calls per conversation)
  let totalToolCalls = 0;
  let totalConvs = 0;
  for (const conv of conversationMetrics.values()) {
    totalToolCalls += conv.toolCalls;
    totalConvs++;
  }
  const avgChainLength = totalConvs > 0 ? (totalToolCalls / totalConvs).toFixed(1) : '0';

  // Cost per conversation
  let totalConvCost = 0;
  for (const conv of conversationMetrics.values()) {
    totalConvCost += conv.cost;
  }
  const avgCostPerConversation =
    totalConvs > 0 ? (totalConvCost / totalConvs).toFixed(6) : '0';

  return {
    tools,
    topToolsByUsage,
    topToolsByErrorRate,
    avgChainLength: parseFloat(avgChainLength),
    avgCostPerConversation: parseFloat(avgCostPerConversation),
    llm: {
      calls: llmMetrics.calls,
      totalInputTokens: llmMetrics.totalInputTokens,
      totalOutputTokens: llmMetrics.totalOutputTokens,
      totalCachedTokens: llmMetrics.totalCachedTokens,
      totalCost: llmMetrics.totalCost,
      cacheHitRate:
        llmMetrics.totalInputTokens > 0
          ? (
              (llmMetrics.totalCachedTokens / llmMetrics.totalInputTokens) *
              100
            ).toFixed(1) + '%'
          : '0%',
      latency: getLatencyPercentiles(llmMetrics.latencies),
    },
    router: {
      calls: routerMetrics.calls,
      fallbacks: routerMetrics.fallbacks,
      cacheHits: routerMetrics.cacheHits,
      fallbackRate:
        routerMetrics.calls > 0
          ? ((routerMetrics.fallbacks / routerMetrics.calls) * 100).toFixed(1) + '%'
          : '0%',
      latency: getLatencyPercentiles(routerMetrics.latencies),
    },
    conversations: {
      total: conversationMetrics.size,
      totalCost: totalConvCost,
    },
    users: {
      total: userMetrics.size,
    },
  };
}

/**
 * Periodic log dump — logs current metrics summary.
 */
let dumpInterval = null;

function startPeriodicDump(intervalMs = 300000) {
  stopPeriodicDump();
  dumpInterval = setInterval(() => {
    logger.debug('Metrics periodic dump', {
      type: 'metrics_dump',
      metrics: getMetricsSummary(),
    });
  }, intervalMs);
  // Don't prevent process exit
  if (dumpInterval.unref) dumpInterval.unref();
}

function stopPeriodicDump() {
  if (dumpInterval) {
    clearInterval(dumpInterval);
    dumpInterval = null;
  }
}

/**
 * Reset all metrics (for testing).
 */
function clearAll() {
  toolMetrics.clear();
  llmMetrics.calls = 0;
  llmMetrics.totalInputTokens = 0;
  llmMetrics.totalOutputTokens = 0;
  llmMetrics.totalCachedTokens = 0;
  llmMetrics.totalCost = 0;
  llmMetrics.latencies = [];
  routerMetrics.calls = 0;
  routerMetrics.fallbacks = 0;
  routerMetrics.cacheHits = 0;
  routerMetrics.latencies = [];
  conversationMetrics.clear();
  userMetrics.clear();
  stopPeriodicDump();
}

module.exports = {
  recordToolCall,
  recordLLMCall,
  recordRouterCall,
  recordConversation,
  getMetricsSummary,
  getLatencyPercentiles,
  startPeriodicDump,
  stopPeriodicDump,
  clearAll,
  // Exposed for testing
  _toolMetrics: toolMetrics,
  _llmMetrics: llmMetrics,
  _routerMetrics: routerMetrics,
  _conversationMetrics: conversationMetrics,
  _userMetrics: userMetrics,
};
