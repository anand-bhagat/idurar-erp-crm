/**
 * LLM Adapter Factory
 *
 * Returns the correct adapter based on config.provider.
 * Singleton pattern — one adapter instance per process.
 * Use resetAdapter() in tests to clear the singleton.
 */

const AnthropicAdapter = require('./adapters/anthropic');
const OpenAICompatibleAdapter = require('./adapters/openai');

const ADAPTERS = {
  anthropic: AnthropicAdapter,
  'openai-compatible': OpenAICompatibleAdapter,
};

let _instance = null;

/**
 * Get or create the LLM adapter singleton.
 * @param {Object} config - { provider, model, apiKey, baseUrl, maxTokens, temperature }
 * @returns {BaseLLMAdapter} Adapter instance
 */
function getLLMAdapter(config) {
  if (_instance) return _instance;

  const AdapterClass = ADAPTERS[config.provider];
  if (!AdapterClass) {
    throw new Error(
      `Unknown LLM provider: "${config.provider}". Available: ${Object.keys(ADAPTERS).join(', ')}`
    );
  }

  _instance = new AdapterClass({
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  });

  return _instance;
}

/**
 * Reset the adapter singleton (for testing).
 */
function resetAdapter() {
  _instance = null;
}

module.exports = { getLLMAdapter, resetAdapter };
