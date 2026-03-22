/**
 * Agent Configuration
 *
 * All settings are configurable via environment variables.
 * Every setting has a sensible default.
 */

const config = {
  llm: {
    provider: process.env.AGENT_LLM_PROVIDER || 'openai',
    model: process.env.AGENT_LLM_MODEL || 'gpt-4o-mini',
    temperature: parseFloat(process.env.AGENT_LLM_TEMPERATURE) || 0.2,
    maxTokens: parseInt(process.env.AGENT_LLM_MAX_TOKENS, 10) || 4096,
    streaming: process.env.AGENT_LLM_STREAMING !== 'false',
    timeout: parseInt(process.env.AGENT_LLM_TIMEOUT, 10) || 30000,
    maxIterations: parseInt(process.env.AGENT_MAX_ITERATIONS, 10) || 10,
    costTracking: {
      enabled: process.env.AGENT_COST_TRACKING !== 'false',
    },
  },

  routing: {
    enabled: process.env.AGENT_ROUTING_ENABLED === 'true',
    threshold: parseInt(process.env.AGENT_ROUTING_THRESHOLD, 10) || 30,
    coreCategories: (process.env.AGENT_CORE_CATEGORIES || 'navigation').split(',').map((s) => s.trim()),
    cacheMessages: parseInt(process.env.AGENT_ROUTING_CACHE_MESSAGES, 10) || 5,
  },

  features: {
    enabledCategories: process.env.AGENT_ENABLED_CATEGORIES
      ? process.env.AGENT_ENABLED_CATEGORIES.split(',').map((s) => s.trim())
      : null, // null = all categories enabled
  },

  rateLimiting: {
    windowMs: parseInt(process.env.AGENT_RATE_LIMIT_WINDOW, 10) || 60000,
    maxRequests: parseInt(process.env.AGENT_RATE_LIMIT_MAX, 10) || 20,
  },

  observability: {
    logLevel: process.env.AGENT_LOG_LEVEL || 'info',
    traceSampling: parseFloat(process.env.AGENT_TRACE_SAMPLING) || 1.0,
  },

  guardrails: {
    circuitBreaker: {
      enabled: process.env.AGENT_CIRCUIT_BREAKER_ENABLED !== 'false',
      threshold: parseInt(process.env.AGENT_CIRCUIT_BREAKER_THRESHOLD, 10) || 5,
      resetMs: parseInt(process.env.AGENT_CIRCUIT_BREAKER_RESET, 10) || 60000,
    },
    sanitization: {
      enabled: process.env.AGENT_SANITIZATION_ENABLED !== 'false',
    },
    injectionDetection: {
      enabled: process.env.AGENT_INJECTION_DETECTION_ENABLED !== 'false',
      mode: process.env.AGENT_INJECTION_DETECTION_MODE || 'flag', // 'block' or 'flag'
    },
    rateLimiting: {
      enabled: process.env.AGENT_GUARDRAIL_RATE_LIMIT_ENABLED !== 'false',
      perUser: {
        windowMs: parseInt(process.env.AGENT_RATE_LIMIT_USER_WINDOW, 10) || 60000,
        maxRequests: parseInt(process.env.AGENT_RATE_LIMIT_USER_MAX, 10) || 30,
      },
      perConversation: {
        windowMs: parseInt(process.env.AGENT_RATE_LIMIT_CONV_WINDOW, 10) || 60000,
        maxRequests: parseInt(process.env.AGENT_RATE_LIMIT_CONV_MAX, 10) || 15,
      },
      perTool: {
        windowMs: parseInt(process.env.AGENT_RATE_LIMIT_TOOL_WINDOW, 10) || 60000,
        maxRequests: parseInt(process.env.AGENT_RATE_LIMIT_TOOL_MAX, 10) || 20,
      },
    },
    tokenBudget: {
      enabled: process.env.AGENT_TOKEN_BUDGET_ENABLED !== 'false',
      perConversation: parseInt(process.env.AGENT_TOKEN_BUDGET, 10) || 100000,
    },
    cacheTTL: parseInt(process.env.AGENT_CACHE_TTL, 10) || 30000,
  },
};

module.exports = config;
