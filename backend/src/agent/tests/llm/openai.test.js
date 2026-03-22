/**
 * Tests for agent/llm/adapters/openai.js
 */

const OpenAICompatibleAdapter = require('../../llm/adapters/openai');

// Mock the OpenAI SDK
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }));
});

const OpenAI = require('openai');

describe('OpenAICompatibleAdapter', () => {
  let adapter;
  let mockClient;

  beforeEach(() => {
    adapter = new OpenAICompatibleAdapter({
      model: 'gpt-4o-mini',
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
      maxTokens: 4096,
      temperature: 0,
    });
    mockClient = adapter.client;
  });

  describe('formatTools()', () => {
    it('should convert universal format to OpenAI function calling format', () => {
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
          type: 'function',
          function: {
            name: 'search_products',
            description: 'Search products',
            parameters: {
              type: 'object',
              properties: { keyword: { type: 'string' } },
              required: ['keyword'],
            },
          },
        },
      ]);
    });

    it('should handle multiple tools', () => {
      const tools = [
        { name: 'a', description: 'A', parameters: { type: 'object', properties: {} } },
        { name: 'b', description: 'B', parameters: { type: 'object', properties: {} } },
      ];

      const result = adapter.formatTools(tools);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('function');
      expect(result[1].type).toBe('function');
    });
  });

  describe('parseResponse()', () => {
    it('should parse text-only response', () => {
      const raw = {
        choices: [{ message: { content: 'Hello world', tool_calls: undefined } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      };

      const result = adapter.parseResponse(raw);

      expect(result).toEqual({
        content: 'Hello world',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 0 },
      });
    });

    it('should parse tool call response', () => {
      const raw = {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_123',
                  function: { name: 'search_products', arguments: '{"keyword":"laptop"}' },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 100,
          prompt_tokens_details: { cached_tokens: 150 },
        },
      };

      const result = adapter.parseResponse(raw);

      expect(result.content).toBeNull();
      expect(result.toolCalls).toEqual([
        { id: 'call_123', name: 'search_products', params: { keyword: 'laptop' } },
      ]);
      expect(result.usage.cachedTokens).toBe(150);
    });

    it('should return null toolCalls when none present', () => {
      const raw = {
        choices: [{ message: { content: 'OK' } }],
        usage: { prompt_tokens: 50, completion_tokens: 25 },
      };

      const result = adapter.parseResponse(raw);
      expect(result.toolCalls).toBeNull();
    });

    it('should handle empty choices gracefully', () => {
      const raw = {
        choices: [{}],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      };

      const result = adapter.parseResponse(raw);
      expect(result.content).toBeNull();
      expect(result.toolCalls).toBeNull();
    });

    it('should handle multiple tool calls', () => {
      const raw = {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'call_1', function: { name: 'tool_a', arguments: '{}' } },
                { id: 'call_2', function: { name: 'tool_b', arguments: '{"x":1}' } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      };

      const result = adapter.parseResponse(raw);
      expect(result.toolCalls).toHaveLength(2);
    });
  });

  describe('chat()', () => {
    it('should call OpenAI API with correct params', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      };
      mockClient.chat.completions.create.mockResolvedValue(mockResponse);

      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ];

      const result = await adapter.chat(messages, []);

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o-mini',
          max_tokens: 4096,
          temperature: 0,
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Hello' },
          ],
        })
      );

      expect(result.content).toBe('Response');
    });

    it('should include tools when provided', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'OK' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      };
      mockClient.chat.completions.create.mockResolvedValue(mockResponse);

      const tools = [
        { name: 'test_tool', description: 'Test', parameters: { type: 'object', properties: {} } },
      ];

      await adapter.chat([{ role: 'user', content: 'Hi' }], tools);

      const callArgs = mockClient.chat.completions.create.mock.calls[0][0];
      expect(callArgs.tools).toBeDefined();
      expect(callArgs.tools[0].type).toBe('function');
    });

    it('should not include tools key when tools array is empty', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'OK' } }],
        usage: { prompt_tokens: 50, completion_tokens: 25 },
      };
      mockClient.chat.completions.create.mockResolvedValue(mockResponse);

      await adapter.chat([{ role: 'user', content: 'Hi' }], []);

      const callArgs = mockClient.chat.completions.create.mock.calls[0][0];
      expect(callArgs.tools).toBeUndefined();
    });

    it('should respect options overrides', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'OK' } }],
        usage: { prompt_tokens: 50, completion_tokens: 25 },
      };
      mockClient.chat.completions.create.mockResolvedValue(mockResponse);

      await adapter.chat([{ role: 'user', content: 'Hi' }], [], {
        maxTokens: 2048,
        temperature: 0.7,
      });

      const callArgs = mockClient.chat.completions.create.mock.calls[0][0];
      expect(callArgs.max_tokens).toBe(2048);
      expect(callArgs.temperature).toBe(0.7);
    });
  });

  describe('_convertMessages()', () => {
    it('should convert tool messages to OpenAI format', () => {
      const messages = [
        { role: 'tool', tool_call_id: 'call_1', content: '{"success":true}' },
      ];

      const result = adapter._convertMessages(messages);

      expect(result).toEqual([
        { role: 'tool', tool_call_id: 'call_1', content: '{"success":true}' },
      ]);
    });

    it('should pass through regular messages', () => {
      const messages = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hello' },
      ];

      const result = adapter._convertMessages(messages);
      expect(result).toEqual(messages);
    });
  });

  describe('chatStream()', () => {
    it('should yield normalized stream chunks', async () => {
      const mockChunks = [
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: { content: ' world' } }] },
        {
          choices: [
            { delta: { tool_calls: [{ id: 'call_1', function: { name: 'search' } }] } },
          ],
        },
        {
          choices: [
            { delta: { tool_calls: [{ function: { arguments: '{"q":"test"}' } }] } },
          ],
        },
        {
          choices: [{ delta: {} }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        },
      ];

      // Mock stream as async iterable
      mockClient.chat.completions.create.mockResolvedValue({
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            async next() {
              if (i < mockChunks.length) {
                return { value: mockChunks[i++], done: false };
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
        { type: 'tool_input_delta', content: '{"q":"test"}' },
        { type: 'done', usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 0 } },
      ]);
    });

    it('should request stream_options with include_usage', async () => {
      mockClient.chat.completions.create.mockResolvedValue({
        [Symbol.asyncIterator]() {
          return { async next() { return { done: true }; } };
        },
      });

      // Consume the generator
      for await (const _ of adapter.chatStream([{ role: 'user', content: 'Hi' }])) {}

      const callArgs = mockClient.chat.completions.create.mock.calls[0][0];
      expect(callArgs.stream).toBe(true);
      expect(callArgs.stream_options).toEqual({ include_usage: true });
    });
  });
});
