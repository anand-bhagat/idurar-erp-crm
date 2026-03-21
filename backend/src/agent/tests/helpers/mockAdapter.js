/**
 * Mock LLM adapter for testing without real API calls.
 *
 * Configurable responses via setNextResponse() / setNextResponses().
 */

class MockLLMAdapter {
  constructor() {
    this._responses = [];
    this._calls = [];
  }

  /**
   * Set a single response for the next chat() call.
   */
  setNextResponse(response) {
    this._responses.push(response);
  }

  /**
   * Set a sequence of responses for successive chat() calls.
   */
  setNextResponses(responses) {
    this._responses.push(...responses);
  }

  /**
   * Get all calls made to chat().
   */
  getCalls() {
    return this._calls;
  }

  /**
   * Reset all state.
   */
  reset() {
    this._responses = [];
    this._calls = [];
  }

  async chat(messages, tools, options = {}) {
    this._calls.push({ messages, tools, options });

    if (this._responses.length === 0) {
      return {
        content: 'Mock response',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 0 },
      };
    }

    return this._responses.shift();
  }

  async chatStream(messages, tools, options = {}) {
    const response = await this.chat(messages, tools, options);
    return {
      async *[Symbol.asyncIterator]() {
        if (response.content) {
          yield { type: 'text_delta', content: response.content };
        }
        if (response.toolCalls) {
          for (const tc of response.toolCalls) {
            yield { type: 'tool_call', ...tc };
          }
        }
        yield { type: 'done', usage: response.usage };
      },
    };
  }

  formatTools(tools) {
    return tools;
  }

  parseResponse(raw) {
    return raw;
  }
}

module.exports = { MockLLMAdapter };
