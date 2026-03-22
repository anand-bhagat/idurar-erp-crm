/**
 * Tests for agent/engine.js
 */

const { runAgent, checkTokenBudget, getToolStatusMessage, clearEngineState, setHooks, _tokenBudget, _circuitBreaker } = require('../engine');
const registry = require('../registry');
const { MockLLMAdapter } = require('./helpers/mockAdapter');
const { mockContext } = require('./helpers/mockContext');

let adapter;
let ctx;

beforeEach(() => {
  adapter = new MockLLMAdapter();
  ctx = mockContext();
  registry.clearTools();
  clearEngineState();

  // Register a sample tool for engine tests
  registry.registerTool('get_item', {
    handler: async (params) => ({ success: true, data: { id: params.id, name: 'Widget' } }),
    schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    description: 'Get an item by ID',
    execution: 'backend',
    access: 'authenticated',
    category: 'testing',
  });
});

describe('engine', () => {
  describe('runAgent — text response', () => {
    it('should return text response from LLM', async () => {
      adapter.setNextResponse({
        content: 'Here is your answer!',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 0 },
      });

      const tools = registry.getToolDefinitions(ctx.role);
      const result = await runAgent({
        message: 'Hello',
        conversationHistory: [],
        userContext: ctx,
        adapter,
        tools,
      });

      expect(result.type).toBe('response');
      expect(result.message).toBe('Here is your answer!');
    });
  });

  describe('runAgent — tool call', () => {
    it('should execute tool and return final LLM response', async () => {
      // First LLM call: tool call
      adapter.setNextResponse({
        content: null,
        toolCalls: [{ id: 'tc-1', name: 'get_item', params: { id: 'abc' } }],
        usage: { inputTokens: 200, outputTokens: 30, cachedTokens: 0 },
      });
      // Second LLM call: text response
      adapter.setNextResponse({
        content: 'Found the widget for you!',
        toolCalls: null,
        usage: { inputTokens: 250, outputTokens: 40, cachedTokens: 180 },
      });

      const tools = registry.getToolDefinitions(ctx.role);
      const result = await runAgent({
        message: 'Find item abc',
        conversationHistory: [],
        userContext: ctx,
        adapter,
        tools,
      });

      expect(result.type).toBe('response');
      expect(result.message).toBe('Found the widget for you!');

      // Verify the LLM received the tool result
      const calls = adapter.getCalls();
      expect(calls).toHaveLength(2);
      // Second call should have tool result in messages
      const secondCallMessages = calls[1].messages;
      const toolMessage = secondCallMessages.find((m) => m.role === 'tool');
      expect(toolMessage).toBeTruthy();
      expect(JSON.parse(toolMessage.content).data.name).toBe('Widget');
    });
  });

  describe('runAgent — frontend tool', () => {
    beforeEach(() => {
      registry.registerTool('navigate_home', {
        schema: { type: 'object', properties: {} },
        description: 'Navigate to home page',
        execution: 'frontend',
        access: 'authenticated',
        category: 'navigation',
        frontendAction: { type: 'navigate', route: '/home' },
      });
    });

    it('should return frontend_action when LLM calls a frontend tool', async () => {
      adapter.setNextResponse({
        content: null,
        toolCalls: [{ id: 'tc-2', name: 'navigate_home', params: {} }],
        usage: { inputTokens: 150, outputTokens: 20, cachedTokens: 0 },
      });

      const tools = registry.getToolDefinitions(ctx.role);
      const result = await runAgent({
        message: 'Go to home',
        conversationHistory: [],
        userContext: ctx,
        adapter,
        tools,
      });

      expect(result.type).toBe('frontend_action');
      expect(result.tool).toBe('navigate_home');
      expect(result.toolCallId).toBe('tc-2');
    });
  });

  describe('runAgent — frontend result continuation', () => {
    it('should continue from frontend result', async () => {
      adapter.setNextResponse({
        content: 'Navigated successfully!',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 0 },
      });

      const tools = registry.getToolDefinitions(ctx.role);
      const result = await runAgent({
        frontendResult: { toolCallId: 'tc-2', success: true, message: 'Done' },
        conversationHistory: [],
        userContext: ctx,
        adapter,
        tools,
      });

      expect(result.type).toBe('response');
      expect(result.message).toBe('Navigated successfully!');
    });
  });

  describe('runAgent — max iterations', () => {
    it('should stop after max iterations with fallback message', async () => {
      // Set up adapter to always return tool calls (infinite loop)
      for (let i = 0; i < 15; i++) {
        adapter.setNextResponse({
          content: null,
          toolCalls: [{ id: `tc-${i}`, name: 'get_item', params: { id: 'loop' } }],
          usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 0 },
        });
      }

      const tools = registry.getToolDefinitions(ctx.role);
      const result = await runAgent({
        message: 'Loop forever',
        conversationHistory: [],
        userContext: ctx,
        adapter,
        tools,
      });

      expect(result.type).toBe('response');
      expect(result.message).toContain('unable to complete');
    });
  });

  describe('runAgent — error recovery', () => {
    it('should feed tool error back to LLM for self-correction', async () => {
      // Register a tool that returns an error
      registry.registerTool('bad_tool', {
        handler: async () => ({ success: false, error: 'Item not found', code: 'NOT_FOUND' }),
        schema: { type: 'object', properties: {} },
        description: 'A tool that fails',
        execution: 'backend',
        access: 'authenticated',
        category: 'testing',
      });

      adapter.setNextResponse({
        content: null,
        toolCalls: [{ id: 'tc-err', name: 'bad_tool', params: {} }],
        usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 0 },
      });
      adapter.setNextResponse({
        content: 'Sorry, I could not find that item.',
        toolCalls: null,
        usage: { inputTokens: 150, outputTokens: 30, cachedTokens: 0 },
      });

      const tools = registry.getToolDefinitions(ctx.role);
      const result = await runAgent({
        message: 'Find thing',
        conversationHistory: [],
        userContext: ctx,
        adapter,
        tools,
      });

      expect(result.type).toBe('response');
      expect(result.message).toContain('could not find');
    });
  });

  describe('token budget', () => {
    it('should allow requests within budget', () => {
      const result = checkTokenBudget('conv-test');
      expect(result.allowed).toBe(true);
    });

    it('should reject requests that exceed budget', () => {
      _tokenBudget._conversationTokenUsage.set('conv-over', 200000);
      const result = checkTokenBudget('conv-over');
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('limit');
    });

    it('should track cumulative token usage', async () => {
      adapter.setNextResponse({
        content: 'Response 1',
        toolCalls: null,
        usage: { inputTokens: 50000, outputTokens: 10000, cachedTokens: 0 },
      });

      const tools = registry.getToolDefinitions(ctx.role);
      await runAgent({
        message: 'Test',
        conversationHistory: [],
        userContext: ctx,
        adapter,
        tools,
      });

      const usage = _tokenBudget._conversationTokenUsage.get(ctx.conversationId);
      expect(usage).toBe(60000);
    });
  });

  describe('circuit breaker', () => {
    it('should disable tool after repeated failures', async () => {
      registry.registerTool('flaky_tool', {
        handler: async () => { throw new Error('DB down'); },
        schema: { type: 'object', properties: {} },
        description: 'Flaky tool',
        execution: 'backend',
        access: 'authenticated',
        category: 'testing',
      });

      // Simulate repeated failures
      for (let i = 0; i < 6; i++) {
        adapter.setNextResponse({
          content: null,
          toolCalls: [{ id: `tc-f-${i}`, name: 'flaky_tool', params: {} }],
          usage: { inputTokens: 50, outputTokens: 10, cachedTokens: 0 },
        });
      }
      adapter.setNextResponse({
        content: 'Gave up',
        toolCalls: null,
        usage: { inputTokens: 50, outputTokens: 10, cachedTokens: 0 },
      });

      const tools = registry.getToolDefinitions(ctx.role);
      const result = await runAgent({
        message: 'Use flaky tool',
        conversationHistory: [],
        userContext: ctx,
        adapter,
        tools,
      });

      // After 5+ failures, the circuit should be open
      const state = _circuitBreaker.getState('flaky_tool');
      expect(state).toBe('open');
    });
  });

  describe('observability hooks', () => {
    it('should call onToolExecution hook', async () => {
      const toolHook = jest.fn();
      setHooks({ onToolExecution: toolHook });

      adapter.setNextResponse({
        content: null,
        toolCalls: [{ id: 'tc-h', name: 'get_item', params: { id: 'x' } }],
        usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 0 },
      });
      adapter.setNextResponse({
        content: 'Done',
        toolCalls: null,
        usage: { inputTokens: 150, outputTokens: 20, cachedTokens: 0 },
      });

      const tools = registry.getToolDefinitions(ctx.role);
      await runAgent({
        message: 'Get item x',
        conversationHistory: [],
        userContext: ctx,
        adapter,
        tools,
      });

      expect(toolHook).toHaveBeenCalledTimes(1);
      expect(toolHook.mock.calls[0][0].tool).toBe('get_item');
    });

    it('should call onLLMCall hook', async () => {
      const llmHook = jest.fn();
      setHooks({ onLLMCall: llmHook });

      adapter.setNextResponse({
        content: 'Hello',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 0 },
      });

      const tools = registry.getToolDefinitions(ctx.role);
      await runAgent({
        message: 'Hi',
        conversationHistory: [],
        userContext: ctx,
        adapter,
        tools,
      });

      expect(llmHook).toHaveBeenCalledTimes(1);
      expect(llmHook.mock.calls[0][0].model).toBeTruthy();
    });
  });

  describe('getToolStatusMessage', () => {
    it('should return specific message for known tools', () => {
      expect(getToolStatusMessage('search_products')).toContain('Searching');
    });

    it('should return default message for unknown tools', () => {
      expect(getToolStatusMessage('unknown_tool')).toContain('Processing');
    });
  });
});
