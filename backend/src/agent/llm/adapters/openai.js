/**
 * OpenAI-Compatible Adapter
 *
 * Works with any OpenAI-compatible API: OpenAI, DeepInfra, Groq, OpenRouter, Ollama.
 * Supports automatic prefix caching (keep request prefix stable for cache hits).
 */

const OpenAI = require('openai');
const BaseLLMAdapter = require('../base-adapter');

class OpenAICompatibleAdapter extends BaseLLMAdapter {
  constructor(config) {
    super(config);
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: config.baseUrl,
    });
  }

  /**
   * Convert tool definitions to OpenAI's function calling format.
   * Handles both universal format ({ name, description, parameters })
   * and already-wrapped OpenAI format ({ type: 'function', function: { ... } }).
   */
  formatTools(tools) {
    return tools.map((tool) => {
      // Already in OpenAI format (from registry)
      if (tool.type === 'function' && tool.function) {
        return tool;
      }
      // Universal format
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      };
    });
  }

  /**
   * Parse OpenAI's response into normalized format.
   */
  parseResponse(raw) {
    const message = raw.choices[0]?.message;
    const toolCalls = (message?.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      params: JSON.parse(tc.function.arguments),
    }));

    return {
      content: message?.content || null,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      usage: {
        inputTokens: raw.usage?.prompt_tokens || 0,
        outputTokens: raw.usage?.completion_tokens || 0,
        cachedTokens: raw.usage?.prompt_tokens_details?.cached_tokens || 0,
      },
    };
  }

  /**
   * Non-streaming chat completion.
   */
  async chat(messages, tools = [], options = {}) {
    const params = {
      model: this.model,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature ?? this.temperature,
      messages: this._convertMessages(messages),
    };

    if (tools.length > 0) {
      params.tools = this.formatTools(tools);
    }

    const response = await this.client.chat.completions.create(params);
    return this.parseResponse(response);
  }

  /**
   * Streaming chat completion — yields normalized stream chunks.
   */
  async *chatStream(messages, tools = [], options = {}) {
    const params = {
      model: this.model,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature ?? this.temperature,
      messages: this._convertMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
    };

    if (tools.length > 0) {
      params.tools = this.formatTools(tools);
    }

    const stream = await this.client.chat.completions.create(params);

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;

      if (delta?.content) {
        yield { type: 'text_delta', content: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.function?.name) {
            yield { type: 'tool_start', name: tc.function.name, id: tc.id };
          }
          if (tc.function?.arguments) {
            yield { type: 'tool_input_delta', content: tc.function.arguments };
          }
        }
      }

      if (chunk.usage) {
        yield {
          type: 'done',
          usage: {
            inputTokens: chunk.usage.prompt_tokens || 0,
            outputTokens: chunk.usage.completion_tokens || 0,
            cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
          },
        };
      }
    }
  }

  /**
   * Convert universal message format to OpenAI's format.
   */
  _convertMessages(messages) {
    return messages.map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: msg.tool_call_id,
          content: msg.content,
        };
      }
      const converted = { role: msg.role, content: msg.content };
      if (msg.tool_calls) {
        converted.tool_calls = msg.tool_calls;
      }
      return converted;
    });
  }
}

module.exports = OpenAICompatibleAdapter;
