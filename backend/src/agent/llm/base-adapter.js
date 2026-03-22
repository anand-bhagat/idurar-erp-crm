/**
 * Base LLM Adapter — Abstract interface contract.
 *
 * Every adapter MUST extend this class and implement all methods.
 * The engine calls these methods and expects the normalized response format —
 * it should never see provider-specific shapes.
 *
 * Universal tool format (input):
 *   { name, description, parameters: { type: 'object', properties, required } }
 *
 * Normalized response format (output of chat/parseResponse):
 *   { content: string|null, toolCalls: [{ id, name, params }], usage: { inputTokens, outputTokens, cachedTokens } }
 *
 * Normalized stream chunk types (output of chatStream):
 *   { type: 'text_delta', content: string }
 *   { type: 'tool_start', name: string, id: string }
 *   { type: 'tool_input_delta', content: string }
 *   { type: 'done', usage: { inputTokens, outputTokens, cachedTokens } }
 */

class BaseLLMAdapter {
  constructor(config) {
    if (new.target === BaseLLMAdapter) {
      throw new Error('BaseLLMAdapter is abstract and cannot be instantiated directly');
    }
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature || 0;
  }

  /**
   * Send a chat completion request with tool definitions.
   * @param {Array} messages - [{ role, content }]
   * @param {Array} tools - Tool definitions in universal format
   * @param {Object} options - { temperature, maxTokens, cacheOptions }
   * @returns {Promise<Object>} Normalized response: { content, toolCalls, usage }
   */
  async chat(messages, tools = [], options = {}) {
    throw new Error('chat() must be implemented by adapter');
  }

  /**
   * Send a streaming chat completion request.
   * @param {Array} messages - [{ role, content }]
   * @param {Array} tools - Tool definitions in universal format
   * @param {Object} options - { temperature, maxTokens, cacheOptions }
   * @returns {AsyncGenerator} Yields normalized stream chunks
   */
  async *chatStream(messages, tools = [], options = {}) {
    throw new Error('chatStream() must be implemented by adapter');
  }

  /**
   * Convert universal tool definitions to provider-specific format.
   * @param {Array} tools - Universal format tools
   * @returns {Array} Provider-specific tool definitions
   */
  formatTools(tools) {
    throw new Error('formatTools() must be implemented by adapter');
  }

  /**
   * Parse provider's raw response into normalized format.
   * @param {Object} rawResponse - Provider-specific response
   * @returns {Object} { content, toolCalls: [{ id, name, params }], usage: { inputTokens, outputTokens, cachedTokens } }
   */
  parseResponse(rawResponse) {
    throw new Error('parseResponse() must be implemented by adapter');
  }
}

module.exports = BaseLLMAdapter;
