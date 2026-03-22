/**
 * Anthropic (Claude) Adapter
 *
 * Implements the LLM adapter interface for Anthropic's Claude models.
 * Includes prompt caching via cache_control markers for cost optimization.
 */

const Anthropic = require('@anthropic-ai/sdk');
const BaseLLMAdapter = require('../base-adapter');

class AnthropicAdapter extends BaseLLMAdapter {
  constructor(config) {
    super(config);
    this.client = new Anthropic({ apiKey: this.apiKey });
  }

  /**
   * Convert universal tool format to Anthropic's input_schema format.
   * Marks the last tool with cache_control for prompt caching.
   */
  formatTools(tools) {
    return tools.map((tool, i) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
      // Cache everything up to and including the last tool definition
      ...(i === tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
    }));
  }

  /**
   * Parse Anthropic's response into normalized format.
   */
  parseResponse(raw) {
    const content =
      raw.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('') || null;

    const toolCalls = raw.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        id: block.id,
        name: block.name,
        params: block.input,
      }));

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      usage: {
        inputTokens: raw.usage?.input_tokens || 0,
        outputTokens: raw.usage?.output_tokens || 0,
        cachedTokens: raw.usage?.cache_read_input_tokens || 0,
      },
    };
  }

  /**
   * Non-streaming chat completion.
   */
  async chat(messages, tools = [], options = {}) {
    const systemMsg = messages.find((m) => m.role === 'system');
    const chatMessages = this._convertMessages(messages.filter((m) => m.role !== 'system'));

    const params = {
      model: this.model,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature ?? this.temperature,
      messages: chatMessages,
    };

    // System prompt with cache control for prompt caching
    if (systemMsg) {
      params.system = [
        {
          type: 'text',
          text: systemMsg.content,
          cache_control: { type: 'ephemeral' },
        },
      ];
    }

    if (tools.length > 0) {
      params.tools = this.formatTools(tools);
    }

    const response = await this.client.messages.create(params);
    return this.parseResponse(response);
  }

  /**
   * Streaming chat completion — yields normalized stream chunks.
   */
  async *chatStream(messages, tools = [], options = {}) {
    const systemMsg = messages.find((m) => m.role === 'system');
    const chatMessages = this._convertMessages(messages.filter((m) => m.role !== 'system'));

    const params = {
      model: this.model,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature ?? this.temperature,
      messages: chatMessages,
      stream: true,
    };

    if (systemMsg) {
      params.system = [
        {
          type: 'text',
          text: systemMsg.content,
          cache_control: { type: 'ephemeral' },
        },
      ];
    }

    if (tools.length > 0) {
      params.tools = this.formatTools(tools);
    }

    const stream = this.client.messages.stream(params);

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text_delta', content: event.delta.text };
        } else if (event.delta.type === 'input_json_delta') {
          yield { type: 'tool_input_delta', content: event.delta.partial_json };
        }
      } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        yield { type: 'tool_start', name: event.content_block.name, id: event.content_block.id };
      } else if (event.type === 'message_delta') {
        yield {
          type: 'done',
          usage: {
            inputTokens: event.usage?.input_tokens || 0,
            outputTokens: event.usage?.output_tokens || 0,
            cachedTokens: event.usage?.cache_read_input_tokens || 0,
          },
        };
      }
    }
  }

  /**
   * Convert universal message format to Anthropic's format.
   * Anthropic uses 'user' role with tool_result content blocks for tool results.
   */
  _convertMessages(messages) {
    return messages.map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id,
              content: msg.content,
            },
          ],
        };
      }

      // Convert assistant messages with tool_calls to Anthropic format
      if (msg.role === 'assistant' && msg.tool_calls) {
        const contentBlocks = [];
        if (msg.content) {
          contentBlocks.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          });
        }
        return { role: 'assistant', content: contentBlocks };
      }

      return { role: msg.role, content: msg.content };
    });
  }
}

module.exports = AnthropicAdapter;
