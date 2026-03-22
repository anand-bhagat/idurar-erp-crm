/**
 * Tests for agent/config.js
 */

const config = require('../config');

describe('config', () => {
  it('should have LLM settings with defaults', () => {
    expect(config.llm).toBeDefined();
    expect(config.llm.provider).toBe('openai-compatible');
    expect(config.llm.baseUrl).toBe('https://api.deepinfra.com/v1/openai');
    expect(config.llm.model).toBe('zhipu-ai/glm-4.7-flash');
    expect(config.llm.maxIterations).toBe(10);
    expect(config.llm.temperature).toBe(0);
    expect(config.llm.maxTokens).toBe(4096);
    expect(config.llm.streaming).toBe(true);
    expect(config.llm.timeout).toBe(30000);
    expect(config.llm.maxRetries).toBe(2);
    expect(config.llm.tokenBudgetPerConversation).toBe(100000);
  });

  it('should have cost tracking pricing table', () => {
    expect(config.llm.costTracking.enabled).toBe(true);
    expect(config.llm.costTracking.pricing).toBeDefined();
    expect(config.llm.costTracking.pricing['gpt-4o']).toBeDefined();
    expect(config.llm.costTracking.pricing['gpt-4o'].input).toBe(2.5);
    expect(config.llm.costTracking.pricing['claude-sonnet-4-20250514']).toBeDefined();
    expect(config.llm.costTracking.pricing['zhipu-ai/glm-4.7-flash']).toBeDefined();
  });

  it('should have routing settings', () => {
    expect(config.routing).toBeDefined();
    expect(config.routing.threshold).toBe(30);
    expect(config.routing.cacheMessages).toBe(5);
    expect(Array.isArray(config.routing.coreCategories)).toBe(true);
  });

  it('should have token budget in guardrails', () => {
    expect(config.guardrails.tokenBudget.perConversation).toBe(100000);
    expect(config.guardrails.tokenBudget.enabled).toBe(true);
  });

  it('should have rate limiting settings', () => {
    expect(config.rateLimiting.windowMs).toBe(60000);
    expect(config.rateLimiting.maxRequests).toBe(20);
  });

  it('should have observability settings', () => {
    expect(config.observability.logLevel).toBe('info');
    expect(config.observability.traceSampling).toBe(1.0);
  });

  it('should have guardrails settings', () => {
    expect(config.guardrails.circuitBreaker.enabled).toBe(true);
    expect(config.guardrails.circuitBreaker.threshold).toBe(5);
    expect(config.guardrails.circuitBreaker.resetMs).toBe(60000);
    expect(config.guardrails.sanitization.enabled).toBe(true);
    expect(config.guardrails.injectionDetection.enabled).toBe(true);
    expect(config.guardrails.injectionDetection.mode).toBe('flag');
    expect(config.guardrails.rateLimiting.enabled).toBe(true);
    expect(config.guardrails.rateLimiting.perUser.maxRequests).toBe(30);
    expect(config.guardrails.rateLimiting.perConversation.maxRequests).toBe(15);
    expect(config.guardrails.rateLimiting.perTool.maxRequests).toBe(20);
    expect(config.guardrails.cacheTTL).toBe(30000);
  });

  it('should have null enabledCategories by default (all enabled)', () => {
    expect(config.features.enabledCategories).toBeNull();
  });
});
