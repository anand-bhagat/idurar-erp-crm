/**
 * Tests for Observability — Logger and Metrics
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const logger = require('../observability/logger');
const metrics = require('../observability/metrics');
const { createHooks, finalizeRequest } = require('../observability');
const config = require('../config');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture log output via logger sink. */
function captureLogs() {
  const logs = [];
  logger._sink = (line) => logs.push(line);
  return logs;
}

function mockContext(overrides = {}) {
  return {
    userId: 'user-123',
    role: 'owner',
    name: 'Test User',
    traceId: 'trace-abc',
    conversationId: 'conv-456',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Logger Tests
// ---------------------------------------------------------------------------

describe('Logger', () => {
  let logs;
  const origLevel = config.observability.logLevel;

  beforeEach(() => {
    logs = captureLogs();
    config.observability.logLevel = 'debug';
  });

  afterEach(() => {
    logger._sink = null;
    config.observability.logLevel = origLevel;
  });

  // ---- logToolExecution ----

  describe('logToolExecution', () => {
    it('should log a successful tool execution', () => {
      const ctx = mockContext();
      logger.logToolExecution('search_clients', { keyword: 'acme' }, ctx, { success: true }, 45);

      assert.equal(logs.length, 1);
      const log = logs[0];
      assert.equal(log.type, 'tool_execution');
      assert.equal(log.traceId, 'trace-abc');
      assert.equal(log.conversationId, 'conv-456');
      assert.equal(log.tool, 'search_clients');
      assert.equal(log.userId, 'user-123');
      assert.equal(log.role, 'owner');
      assert.equal(log.success, true);
      assert.equal(log.errorCode, null);
      assert.equal(log.durationMs, 45);
      assert.equal(log.level, 'info');
      assert.ok(log.timestamp);
    });

    it('should log a failed tool execution with error code', () => {
      const ctx = mockContext();
      logger.logToolExecution(
        'get_client',
        { id: '123' },
        ctx,
        { success: false, code: 'NOT_FOUND' },
        12
      );

      const log = logs[0];
      assert.equal(log.success, false);
      assert.equal(log.errorCode, 'NOT_FOUND');
    });

    it('should sanitize params — strip passwords and PII', () => {
      const ctx = mockContext();
      logger.logToolExecution(
        'update_settings',
        { password: 'secret123', name: 'Test', email: 'user@example.com' },
        ctx,
        { success: true },
        10
      );

      const log = logs[0];
      assert.equal(log.params.password, undefined);
      assert.equal(log.params.email, '[EMAIL_REDACTED]');
      assert.equal(log.params.name, 'Test');
    });
  });

  // ---- logLLMCall ----

  describe('logLLMCall', () => {
    it('should log an LLM call with token usage and cache hit rate', () => {
      logger.logLLMCall(
        'gpt-4o-mini',
        { inputTokens: 4200, outputTokens: 350, cachedTokens: 3800 },
        620,
        'trace-abc',
        { toolCallCount: 2, cost: 0.00035 }
      );

      assert.equal(logs.length, 1);
      const log = logs[0];
      assert.equal(log.type, 'llm_call');
      assert.equal(log.model, 'gpt-4o-mini');
      assert.equal(log.inputTokens, 4200);
      assert.equal(log.outputTokens, 350);
      assert.equal(log.cachedTokens, 3800);
      assert.equal(log.cacheHitRate, '90.5%');
      assert.equal(log.toolCallCount, 2);
      assert.equal(log.durationMs, 620);
      assert.equal(log.cost, 0.00035);
    });

    it('should handle zero input tokens gracefully', () => {
      logger.logLLMCall(
        'gpt-4o-mini',
        { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
        100,
        'trace-abc'
      );

      assert.equal(logs[0].cacheHitRate, '0%');
    });
  });

  // ---- logRouterCall ----

  describe('logRouterCall', () => {
    it('should log a router call', () => {
      logger.logRouterCall(['clients', 'invoices'], 17, 150, 'trace-abc', {
        cached: false,
        fallback: false,
      });

      const log = logs[0];
      assert.equal(log.type, 'router_call');
      assert.deepEqual(log.selectedCategories, ['clients', 'invoices']);
      assert.equal(log.toolCount, 17);
      assert.equal(log.durationMs, 150);
      assert.equal(log.cached, false);
      assert.equal(log.fallback, false);
    });
  });

  // ---- logAgentRequest ----

  describe('logAgentRequest', () => {
    it('should log a full request summary', () => {
      logger.logAgentRequest('trace-abc', {
        conversationId: 'conv-456',
        userId: 'user-123',
        messageLength: 42,
        routerUsed: true,
        routedCategories: ['clients'],
        llmCalls: 3,
        toolCalls: 2,
        tools: ['search_clients', 'get_client'],
        totalInputTokens: 12600,
        totalOutputTokens: 850,
        totalCachedTokens: 11200,
        totalCost: 0.0012,
        totalDurationMs: 2100,
      });

      const log = logs[0];
      assert.equal(log.type, 'agent_request');
      assert.equal(log.traceId, 'trace-abc');
      assert.equal(log.conversationId, 'conv-456');
      assert.equal(log.llmCalls, 3);
      assert.equal(log.toolCalls, 2);
      assert.deepEqual(log.tools, ['search_clients', 'get_client']);
      assert.equal(log.cacheHitRate, '88.9%');
      assert.equal(log.totalCost, 0.0012);
    });
  });

  // ---- Log levels ----

  describe('log levels', () => {
    it('should not emit debug logs when level is info', () => {
      config.observability.logLevel = 'info';
      logger.debug('test message');
      assert.equal(logs.length, 0);
    });

    it('should emit warn logs when level is info', () => {
      config.observability.logLevel = 'info';
      logger.warn('test warning');
      assert.equal(logs.length, 1);
      assert.equal(logs[0].level, 'warn');
    });

    it('should emit debug logs when level is debug', () => {
      config.observability.logLevel = 'debug';
      logger.debug('test debug');
      assert.equal(logs.length, 1);
      assert.equal(logs[0].level, 'debug');
    });

    it('should not emit info logs when level is error', () => {
      config.observability.logLevel = 'error';
      logger.logToolExecution('test', {}, mockContext(), { success: true }, 10);
      assert.equal(logs.length, 0);
    });

    it('should emit error logs at any level', () => {
      config.observability.logLevel = 'error';
      logger.error('test error');
      assert.equal(logs.length, 1);
    });
  });

  // ---- warn/error/debug ----

  describe('warn/error/debug helpers', () => {
    it('should log warn with custom context', () => {
      logger.warn('injection detected', { traceId: 'trace-1', pattern: 'role_override' });
      const log = logs[0];
      assert.equal(log.type, 'warning');
      assert.equal(log.message, 'injection detected');
      assert.equal(log.pattern, 'role_override');
    });

    it('should log error with custom context', () => {
      logger.error('tool handler crashed', { tool: 'search_clients', traceId: 'trace-1' });
      const log = logs[0];
      assert.equal(log.type, 'error');
      assert.equal(log.level, 'error');
    });
  });
});

// ---------------------------------------------------------------------------
// Metrics Tests
// ---------------------------------------------------------------------------

describe('Metrics', () => {
  beforeEach(() => {
    metrics.clearAll();
  });

  // ---- Tool metrics ----

  describe('recordToolCall', () => {
    it('should record tool call frequency', () => {
      metrics.recordToolCall('search_clients', 45, true);
      metrics.recordToolCall('search_clients', 52, true);
      metrics.recordToolCall('get_client', 12, true);

      const summary = metrics.getMetricsSummary();
      assert.equal(summary.tools['search_clients'].calls, 2);
      assert.equal(summary.tools['get_client'].calls, 1);
    });

    it('should record error rates', () => {
      metrics.recordToolCall('search_clients', 45, true);
      metrics.recordToolCall('search_clients', 100, false);
      metrics.recordToolCall('search_clients', 50, true);

      const summary = metrics.getMetricsSummary();
      assert.equal(summary.tools['search_clients'].errors, 1);
      assert.equal(summary.tools['search_clients'].errorRate, '33.3%');
    });

    it('should track latency percentiles', () => {
      // Add 100 samples with known values
      for (let i = 1; i <= 100; i++) {
        metrics.recordToolCall('test_tool', i, true);
      }

      const summary = metrics.getMetricsSummary();
      assert.equal(summary.tools['test_tool'].latency.p50, 50);
      assert.equal(summary.tools['test_tool'].latency.p95, 95);
      assert.equal(summary.tools['test_tool'].latency.p99, 99);
    });
  });

  // ---- LLM metrics ----

  describe('recordLLMCall', () => {
    it('should accumulate LLM token usage', () => {
      metrics.recordLLMCall({ inputTokens: 4200, outputTokens: 350, cachedTokens: 3800 }, 620, 0.00035);
      metrics.recordLLMCall({ inputTokens: 5000, outputTokens: 400, cachedTokens: 4500 }, 580, 0.0004);

      const summary = metrics.getMetricsSummary();
      assert.equal(summary.llm.calls, 2);
      assert.equal(summary.llm.totalInputTokens, 9200);
      assert.equal(summary.llm.totalOutputTokens, 750);
      assert.equal(summary.llm.totalCachedTokens, 8300);
      assert.equal(summary.llm.totalCost, 0.00035 + 0.0004);
    });

    it('should calculate cache hit rate', () => {
      metrics.recordLLMCall({ inputTokens: 1000, outputTokens: 100, cachedTokens: 900 }, 100);

      const summary = metrics.getMetricsSummary();
      assert.equal(summary.llm.cacheHitRate, '90.0%');
    });
  });

  // ---- Router metrics ----

  describe('recordRouterCall', () => {
    it('should track router calls and fallback rate', () => {
      metrics.recordRouterCall(150, false, false);
      metrics.recordRouterCall(120, true, false);
      metrics.recordRouterCall(200, false, true);

      const summary = metrics.getMetricsSummary();
      assert.equal(summary.router.calls, 3);
      assert.equal(summary.router.cacheHits, 1);
      assert.equal(summary.router.fallbacks, 1);
      assert.equal(summary.router.fallbackRate, '33.3%');
    });
  });

  // ---- Conversation metrics ----

  describe('recordConversation', () => {
    it('should accumulate per-conversation stats', () => {
      metrics.recordConversation('conv-1', 'user-1', {
        totalCost: 0.001,
        totalInputTokens: 5000,
        totalOutputTokens: 500,
        toolCalls: 3,
        llmCalls: 2,
      });
      metrics.recordConversation('conv-1', 'user-1', {
        totalCost: 0.002,
        totalInputTokens: 3000,
        totalOutputTokens: 300,
        toolCalls: 1,
        llmCalls: 1,
      });

      const summary = metrics.getMetricsSummary();
      assert.equal(summary.conversations.total, 1);
      assert.equal(summary.conversations.totalCost, 0.003);
    });

    it('should track per-user stats', () => {
      metrics.recordConversation('conv-1', 'user-1', {
        totalCost: 0.001,
        totalInputTokens: 1000,
        totalOutputTokens: 100,
        toolCalls: 1,
        llmCalls: 1,
      });
      metrics.recordConversation('conv-2', 'user-1', {
        totalCost: 0.002,
        totalInputTokens: 2000,
        totalOutputTokens: 200,
        toolCalls: 2,
        llmCalls: 1,
      });

      const summary = metrics.getMetricsSummary();
      assert.equal(summary.users.total, 1);
    });
  });

  // ---- Top tools ----

  describe('getMetricsSummary — top tools', () => {
    it('should return top tools by usage', () => {
      metrics.recordToolCall('search_clients', 50, true);
      metrics.recordToolCall('search_clients', 55, true);
      metrics.recordToolCall('search_clients', 60, true);
      metrics.recordToolCall('get_client', 20, true);

      const summary = metrics.getMetricsSummary();
      assert.equal(summary.topToolsByUsage[0].name, 'search_clients');
      assert.equal(summary.topToolsByUsage[0].calls, 3);
    });

    it('should return top tools by error rate (min 3 calls)', () => {
      // Less than 3 calls — should not appear
      metrics.recordToolCall('flaky_tool', 50, false);
      metrics.recordToolCall('flaky_tool', 50, false);

      let summary = metrics.getMetricsSummary();
      assert.equal(summary.topToolsByErrorRate.length, 0);

      // Now 3 calls — should appear
      metrics.recordToolCall('flaky_tool', 50, true);
      summary = metrics.getMetricsSummary();
      assert.equal(summary.topToolsByErrorRate.length, 1);
      assert.equal(summary.topToolsByErrorRate[0].name, 'flaky_tool');
      assert.equal(summary.topToolsByErrorRate[0].errorRate, '66.7%');
    });
  });

  // ---- Average chain length ----

  describe('average chain length', () => {
    it('should calculate average tool calls per conversation', () => {
      metrics.recordConversation('conv-1', 'user-1', {
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        toolCalls: 4,
        llmCalls: 2,
      });
      metrics.recordConversation('conv-2', 'user-1', {
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        toolCalls: 2,
        llmCalls: 1,
      });

      const summary = metrics.getMetricsSummary();
      assert.equal(summary.avgChainLength, 3.0);
    });
  });

  // ---- Percentile edge cases ----

  describe('getLatencyPercentiles', () => {
    it('should return zeros for empty array', () => {
      const result = metrics.getLatencyPercentiles([]);
      assert.deepEqual(result, { p50: 0, p95: 0, p99: 0 });
    });

    it('should handle single value', () => {
      const result = metrics.getLatencyPercentiles([42]);
      assert.equal(result.p50, 42);
      assert.equal(result.p95, 42);
      assert.equal(result.p99, 42);
    });
  });

  // ---- clearAll ----

  describe('clearAll', () => {
    it('should reset all metrics', () => {
      metrics.recordToolCall('test', 10, true);
      metrics.recordLLMCall({ inputTokens: 100, outputTokens: 10 }, 50, 0.001);
      metrics.recordRouterCall(100, false, false);
      metrics.recordConversation('conv-1', 'user-1', {
        totalCost: 0.001,
        totalInputTokens: 100,
        totalOutputTokens: 10,
        toolCalls: 1,
        llmCalls: 1,
      });

      metrics.clearAll();

      const summary = metrics.getMetricsSummary();
      assert.deepEqual(summary.tools, {});
      assert.equal(summary.llm.calls, 0);
      assert.equal(summary.router.calls, 0);
      assert.equal(summary.conversations.total, 0);
      assert.equal(summary.users.total, 0);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration: createHooks + finalizeRequest
// ---------------------------------------------------------------------------

describe('Observability Integration', () => {
  let logs;
  const origLevel = config.observability.logLevel;

  beforeEach(() => {
    logs = captureLogs();
    config.observability.logLevel = 'debug';
    metrics.clearAll();
  });

  afterEach(() => {
    logger._sink = null;
    config.observability.logLevel = origLevel;
  });

  describe('createHooks', () => {
    it('should create hooks that log and record tool executions', () => {
      const hooks = createHooks();

      hooks.onToolExecution({
        tool: 'search_clients',
        params: { keyword: 'acme' },
        result: { success: true },
        durationMs: 45,
        context: mockContext(),
      });

      // Verify log was emitted
      assert.equal(logs.length, 1);
      assert.equal(logs[0].type, 'tool_execution');

      // Verify metrics were recorded
      const summary = metrics.getMetricsSummary();
      assert.equal(summary.tools['search_clients'].calls, 1);
    });

    it('should create hooks that log and record LLM calls', () => {
      const hooks = createHooks();

      hooks.onLLMCall({
        model: 'gpt-4o-mini',
        usage: { inputTokens: 4200, outputTokens: 350, cachedTokens: 3800 },
        durationMs: 620,
        traceId: 'trace-abc',
        toolCallCount: 1,
        cost: 0.00035,
      });

      assert.equal(logs.length, 1);
      assert.equal(logs[0].type, 'llm_call');

      const summary = metrics.getMetricsSummary();
      assert.equal(summary.llm.calls, 1);
      assert.equal(summary.llm.totalInputTokens, 4200);
    });

    it('should create hooks that log and record router calls', () => {
      const hooks = createHooks();

      hooks.onRequestTrace({
        traceId: 'trace-abc',
        selectedCategories: ['clients', 'invoices'],
        toolCount: 17,
        cached: false,
        fallback: false,
        durationMs: 150,
      });

      assert.equal(logs.length, 1);
      assert.equal(logs[0].type, 'router_call');

      const summary = metrics.getMetricsSummary();
      assert.equal(summary.router.calls, 1);
    });
  });

  describe('finalizeRequest', () => {
    it('should log request summary and record conversation metrics', () => {
      finalizeRequest('trace-abc', {
        conversationId: 'conv-456',
        userId: 'user-123',
        messageLength: 42,
        routerUsed: true,
        routedCategories: ['clients'],
        llmCalls: 3,
        toolCalls: 2,
        tools: ['search_clients', 'get_client'],
        totalInputTokens: 12600,
        totalOutputTokens: 850,
        totalCachedTokens: 11200,
        totalCost: 0.0012,
        totalDurationMs: 2100,
      });

      // Verify summary log
      assert.equal(logs.length, 1);
      assert.equal(logs[0].type, 'agent_request');

      // Verify conversation metrics were recorded
      const summary = metrics.getMetricsSummary();
      assert.equal(summary.conversations.total, 1);
      assert.equal(summary.conversations.totalCost, 0.0012);
    });
  });
});
