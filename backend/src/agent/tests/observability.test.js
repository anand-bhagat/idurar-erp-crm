/**
 * Tests for Observability — Logger and Metrics
 */


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

      expect(logs.length).toBe(1);
      const log = logs[0];
      expect(log.type).toBe('tool_execution');
      expect(log.traceId).toBe('trace-abc');
      expect(log.conversationId).toBe('conv-456');
      expect(log.tool).toBe('search_clients');
      expect(log.userId).toBe('user-123');
      expect(log.role).toBe('owner');
      expect(log.success).toBe(true);
      expect(log.errorCode).toBe(null);
      expect(log.durationMs).toBe(45);
      expect(log.level).toBe('info');
      expect(log.timestamp).toBeTruthy();
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
      expect(log.success).toBe(false);
      expect(log.errorCode).toBe('NOT_FOUND');
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
      expect(log.params.password).toBe(undefined);
      expect(log.params.email).toBe('[EMAIL_REDACTED]');
      expect(log.params.name).toBe('Test');
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

      expect(logs.length).toBe(1);
      const log = logs[0];
      expect(log.type).toBe('llm_call');
      expect(log.model).toBe('gpt-4o-mini');
      expect(log.inputTokens).toBe(4200);
      expect(log.outputTokens).toBe(350);
      expect(log.cachedTokens).toBe(3800);
      expect(log.cacheHitRate).toBe('90.5%');
      expect(log.toolCallCount).toBe(2);
      expect(log.durationMs).toBe(620);
      expect(log.cost).toBe(0.00035);
    });

    it('should handle zero input tokens gracefully', () => {
      logger.logLLMCall(
        'gpt-4o-mini',
        { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
        100,
        'trace-abc'
      );

      expect(logs[0].cacheHitRate).toBe('0%');
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
      expect(log.type).toBe('router_call');
      expect(log.selectedCategories).toEqual(['clients', 'invoices']);
      expect(log.toolCount).toBe(17);
      expect(log.durationMs).toBe(150);
      expect(log.cached).toBe(false);
      expect(log.fallback).toBe(false);
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
      expect(log.type).toBe('agent_request');
      expect(log.traceId).toBe('trace-abc');
      expect(log.conversationId).toBe('conv-456');
      expect(log.llmCalls).toBe(3);
      expect(log.toolCalls).toBe(2);
      expect(log.tools).toEqual(['search_clients', 'get_client']);
      expect(log.cacheHitRate).toBe('88.9%');
      expect(log.totalCost).toBe(0.0012);
    });
  });

  // ---- Log levels ----

  describe('log levels', () => {
    it('should not emit debug logs when level is info', () => {
      config.observability.logLevel = 'info';
      logger.debug('test message');
      expect(logs.length).toBe(0);
    });

    it('should emit warn logs when level is info', () => {
      config.observability.logLevel = 'info';
      logger.warn('test warning');
      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe('warn');
    });

    it('should emit debug logs when level is debug', () => {
      config.observability.logLevel = 'debug';
      logger.debug('test debug');
      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe('debug');
    });

    it('should not emit info logs when level is error', () => {
      config.observability.logLevel = 'error';
      logger.logToolExecution('test', {}, mockContext(), { success: true }, 10);
      expect(logs.length).toBe(0);
    });

    it('should emit error logs at any level', () => {
      config.observability.logLevel = 'error';
      logger.error('test error');
      expect(logs.length).toBe(1);
    });
  });

  // ---- warn/error/debug ----

  describe('warn/error/debug helpers', () => {
    it('should log warn with custom context', () => {
      logger.warn('injection detected', { traceId: 'trace-1', pattern: 'role_override' });
      const log = logs[0];
      expect(log.type).toBe('warning');
      expect(log.message).toBe('injection detected');
      expect(log.pattern).toBe('role_override');
    });

    it('should log error with custom context', () => {
      logger.error('tool handler crashed', { tool: 'search_clients', traceId: 'trace-1' });
      const log = logs[0];
      expect(log.type).toBe('error');
      expect(log.level).toBe('error');
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
      expect(summary.tools['search_clients'].calls).toBe(2);
      expect(summary.tools['get_client'].calls).toBe(1);
    });

    it('should record error rates', () => {
      metrics.recordToolCall('search_clients', 45, true);
      metrics.recordToolCall('search_clients', 100, false);
      metrics.recordToolCall('search_clients', 50, true);

      const summary = metrics.getMetricsSummary();
      expect(summary.tools['search_clients'].errors).toBe(1);
      expect(summary.tools['search_clients'].errorRate).toBe('33.3%');
    });

    it('should track latency percentiles', () => {
      // Add 100 samples with known values
      for (let i = 1; i <= 100; i++) {
        metrics.recordToolCall('test_tool', i, true);
      }

      const summary = metrics.getMetricsSummary();
      expect(summary.tools['test_tool'].latency.p50).toBe(50);
      expect(summary.tools['test_tool'].latency.p95).toBe(95);
      expect(summary.tools['test_tool'].latency.p99).toBe(99);
    });
  });

  // ---- LLM metrics ----

  describe('recordLLMCall', () => {
    it('should accumulate LLM token usage', () => {
      metrics.recordLLMCall({ inputTokens: 4200, outputTokens: 350, cachedTokens: 3800 }, 620, 0.00035);
      metrics.recordLLMCall({ inputTokens: 5000, outputTokens: 400, cachedTokens: 4500 }, 580, 0.0004);

      const summary = metrics.getMetricsSummary();
      expect(summary.llm.calls).toBe(2);
      expect(summary.llm.totalInputTokens).toBe(9200);
      expect(summary.llm.totalOutputTokens).toBe(750);
      expect(summary.llm.totalCachedTokens).toBe(8300);
      expect(summary.llm.totalCost).toBe(0.00035 + 0.0004);
    });

    it('should calculate cache hit rate', () => {
      metrics.recordLLMCall({ inputTokens: 1000, outputTokens: 100, cachedTokens: 900 }, 100);

      const summary = metrics.getMetricsSummary();
      expect(summary.llm.cacheHitRate).toBe('90.0%');
    });
  });

  // ---- Router metrics ----

  describe('recordRouterCall', () => {
    it('should track router calls and fallback rate', () => {
      metrics.recordRouterCall(150, false, false);
      metrics.recordRouterCall(120, true, false);
      metrics.recordRouterCall(200, false, true);

      const summary = metrics.getMetricsSummary();
      expect(summary.router.calls).toBe(3);
      expect(summary.router.cacheHits).toBe(1);
      expect(summary.router.fallbacks).toBe(1);
      expect(summary.router.fallbackRate).toBe('33.3%');
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
      expect(summary.conversations.total).toBe(1);
      expect(summary.conversations.totalCost).toBe(0.003);
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
      expect(summary.users.total).toBe(1);
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
      expect(summary.topToolsByUsage[0].name).toBe('search_clients');
      expect(summary.topToolsByUsage[0].calls).toBe(3);
    });

    it('should return top tools by error rate (min 3 calls)', () => {
      // Less than 3 calls — should not appear
      metrics.recordToolCall('flaky_tool', 50, false);
      metrics.recordToolCall('flaky_tool', 50, false);

      let summary = metrics.getMetricsSummary();
      expect(summary.topToolsByErrorRate.length).toBe(0);

      // Now 3 calls — should appear
      metrics.recordToolCall('flaky_tool', 50, true);
      summary = metrics.getMetricsSummary();
      expect(summary.topToolsByErrorRate.length).toBe(1);
      expect(summary.topToolsByErrorRate[0].name).toBe('flaky_tool');
      expect(summary.topToolsByErrorRate[0].errorRate).toBe('66.7%');
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
      expect(summary.avgChainLength).toBe(3.0);
    });
  });

  // ---- Percentile edge cases ----

  describe('getLatencyPercentiles', () => {
    it('should return zeros for empty array', () => {
      const result = metrics.getLatencyPercentiles([]);
      expect(result).toEqual({ p50: 0, p95: 0, p99: 0 });
    });

    it('should handle single value', () => {
      const result = metrics.getLatencyPercentiles([42]);
      expect(result.p50).toBe(42);
      expect(result.p95).toBe(42);
      expect(result.p99).toBe(42);
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
      expect(summary.tools).toEqual({});
      expect(summary.llm.calls).toBe(0);
      expect(summary.router.calls).toBe(0);
      expect(summary.conversations.total).toBe(0);
      expect(summary.users.total).toBe(0);
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
      expect(logs.length).toBe(1);
      expect(logs[0].type).toBe('tool_execution');

      // Verify metrics were recorded
      const summary = metrics.getMetricsSummary();
      expect(summary.tools['search_clients'].calls).toBe(1);
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

      expect(logs.length).toBe(1);
      expect(logs[0].type).toBe('llm_call');

      const summary = metrics.getMetricsSummary();
      expect(summary.llm.calls).toBe(1);
      expect(summary.llm.totalInputTokens).toBe(4200);
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

      expect(logs.length).toBe(1);
      expect(logs[0].type).toBe('router_call');

      const summary = metrics.getMetricsSummary();
      expect(summary.router.calls).toBe(1);
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
      expect(logs.length).toBe(1);
      expect(logs[0].type).toBe('agent_request');

      // Verify conversation metrics were recorded
      const summary = metrics.getMetricsSummary();
      expect(summary.conversations.total).toBe(1);
      expect(summary.conversations.totalCost).toBe(0.0012);
    });
  });
});
