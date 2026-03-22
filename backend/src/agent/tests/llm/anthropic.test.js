/**
 * Tests for agent/llm/adapters/anthropic.js
 */

const AnthropicAdapter = require('../../llm/adapters/anthropic');

// Mock the Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn(),
      stream: jest.fn(),
    },
  }));
});

const Anthropic = require('@anthropic-ai/sdk');

describe('AnthropicAdapter', () => {
  let adapter;
  let mockClient;

  beforeEach(() => {
    adapter = new AnthropicAdapter({
      model: 'claude-sonnet-4-20250514',
      apiKey: 'test-key',
      maxTokens: 4096,
      temperature: 0,
    });
    mockClient = adapter.client;
  });

  describe('formatTools()', () => {
    it('should convert universal format to Anthropic input_schema format', () => {
      const tools = [
        {
          name: 'search_products',
          description: 'Search products',
          parameters: {
            type: 'object',
            properties: { keyword: { type: 'string' } },
            required: ['keyword'],
          },
        },
      ];

      const result = adapter.formatTools(tools);

      expect(result).toEqual([
        {
          name: 'search_products',
          description: 'Search products',
          input_schema: {
            type: 'object',
            properties: { keyword: { type: 'string' } },
            required: ['keyword'],
          },
          cache_control: { type: 'ephemeral' },
        },
      ]);
    });

    it('should only add cache_control to the last tool', () => {
      const tools = [
        { name: 'tool_a', description: 'A', parameters: { type: 'object', properties: {} } },
        { name: 'tool_b', description: 'B', parameters: { type: 'object', properties: {} } },
        { name: 'tool_c', description: 'C', parameters: { type: 'object', properties: {} } },
      ];

      const result = adapter.formatTools(tools);

      expect(result[0].cache_control).toBeUndefined();
      expect(result[1].cache_control).toBeUndefined();
      expect(result[2].cache_control).toEqual({ type: 'ephemeral' });
    });
  });

  describe('parseResponse()', () => {
    it('should parse text-only response', () => {
      const raw = {
        content: [{ type: 'text', text: 'Hello world' }],
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 80 },
      };

      const result = adapter.parseResponse(raw);

      expect(result).toEqual({
        content: 'Hello world',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 80 },
      });
    });

    it('should parse tool_use response', () => {
      const raw = {
        content: [
          { type: 'text', text: 'Let me search...' },
          {
            type: 'tool_use',
            id: 'call_123',
            name: 'search_products',
            input: { keyword: 'laptop' },
          },
        ],
        usage: { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 0 },
      };

      const result = adapter.parseResponse(raw);

      expect(result.content).toBe('Let me search...');
      expect(result.toolCalls).toEqual([
        { id: 'call_123', name: 'search_products', params: { keyword: 'laptop' } },
      ]);
      expect(result.usage.cachedTokens).toBe(0);
    });

    it('should return null content when only tool_use blocks', () => {
      const raw = {
        content: [
          { type: 'tool_use', id: 'call_1', name: 'get_order', input: { id: '123' } },
        ],
        usage: { input_tokens: 50, output_tokens: 30 },
      };

      const result = adapter.parseResponse(raw);
      expect(result.content).toBeNull();
      expect(result.toolCalls).toHaveLength(1);
    });

    it('should handle missing usage fields gracefully', () => {
      const raw = {
        content: [{ type: 'text', text: 'OK' }],
        usage: {},
      };

      const result = adapter.parseResponse(raw);
      expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
    });

    it('should handle multiple tool calls', () => {
      const raw = {
        content: [
          { type: 'tool_use', id: 'call_1', name: 'search_clients', input: { keyword: 'acme' } },
          { type: 'tool_use', id: 'call_2', name: 'list_orders', input: { page: 1 } },
        ],
        usage: { input_tokens: 300, output_tokens: 150 },
      };

      const result = adapter.parseResponse(raw);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('search_clients');
      expect(result.toolCalls[1].name).toBe('list_orders');
    });
  });

  describe('chat()', () => {
    it('should call Anthropic API with correct params', async () => {
      const mockResponse = {
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 80 },
      };
      mockClient.messages.create.mockResolvedValue(mockResponse);

      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ];

      const result = await adapter.chat(messages, []);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          temperature: 0,
          system: [
            {
              type: 'text',
              text: 'You are a helpful assistant.',
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: 'Hello' }],
        })
      );

      expect(result.content).toBe('Response');
    });

    it('should include tools when provided', async () => {
      const mockResponse = {
        content: [{ type: 'text', text: 'OK' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      };
      mockClient.messages.create.mockResolvedValue(mockResponse);

      const tools = [
        {
          name: 'test_tool',
          description: 'Test',
          parameters: { type: 'object', properties: {} },
        },
      ];

      await adapter.chat([{ role: 'user', content: 'Hi' }], tools);

      const callArgs = mockClient.messages.create.mock.calls[0][0];
      expect(callArgs.tools).toBeDefined();
      expect(callArgs.tools[0].name).toBe('test_tool');
      expect(callArgs.tools[0].input_schema).toBeDefined();
    });

    it('should respect options overrides', async () => {
      const mockResponse = {
        content: [{ type: 'text', text: 'OK' }],
        usage: { input_tokens: 50, output_tokens: 25 },
      };
      mockClient.messages.create.mockResolvedValue(mockResponse);

      await adapter.chat([{ role: 'user', content: 'Hi' }], [], {
        maxTokens: 2048,
        temperature: 0.7,
      });

      const callArgs = mockClient.messages.create.mock.calls[0][0];
      expect(callArgs.max_tokens).toBe(2048);
      expect(callArgs.temperature).toBe(0.7);
    });
  });

  describe('_convertMessages()', () => {
    it('should convert tool role to user role with tool_result', () => {
      const messages = [
        { role: 'tool', tool_call_id: 'call_1', content: '{"success":true}' },
      ];

      const result = adapter._convertMessages(messages);

      expect(result).toEqual([
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_1', content: '{"success":true}' },
          ],
        },
      ]);
    });

    it('should convert assistant messages with tool_calls to Anthropic format', () => {
      const messages = [
        {
          role: 'assistant',
          content: 'Searching...',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'search_products', arguments: '{"keyword":"laptop"}' },
            },
          ],
        },
      ];

      const result = adapter._convertMessages(messages);

      expect(result[0].role).toBe('assistant');
      expect(result[0].content).toEqual([
        { type: 'text', text: 'Searching...' },
        { type: 'tool_use', id: 'call_1', name: 'search_products', input: { keyword: 'laptop' } },
      ]);
    });

    it('should pass through regular user messages', () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      const result = adapter._convertMessages(messages);
      expect(result).toEqual([{ role: 'user', content: 'Hello' }]);
    });
  });

  describe('chatStream()', () => {
    it('should yield normalized stream chunks', async () => {
      const mockEvents = [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } },
        {
          type: 'content_block_start',
          content_block: { type: 'tool_use', name: 'search', id: 'call_1' },
        },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"q":' } },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '"test"}' } },
        {
          type: 'message_delta',
          usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 80 },
        },
      ];

      // Mock the stream method to return an async iterable
      mockClient.messages.stream.mockReturnValue({
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            async next() {
              if (i < mockEvents.length) {
                return { value: mockEvents[i++], done: false };
              }
              return { done: true };
            },
          };
        },
      });

      const chunks = [];
      for await (const chunk of adapter.chatStream([{ role: 'user', content: 'Hi' }])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { type: 'text_delta', content: 'Hello' },
        { type: 'text_delta', content: ' world' },
        { type: 'tool_start', name: 'search', id: 'call_1' },
        { type: 'tool_input_delta', content: '{"q":' },
        { type: 'tool_input_delta', content: '"test"}' },
        { type: 'done', usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 80 } },
      ]);
    });
  });
});
