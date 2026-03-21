/**
 * Tests for agent/config.js
 */

const config = require('../config');

describe('config', () => {
  it('should have LLM settings with defaults', () => {
    expect(config.llm).toBeDefined();
    expect(config.llm.provider).toBe('openai');
    expect(config.llm.maxIterations).toBe(10);
    expect(config.llm.temperature).toBe(0.2);
    expect(config.llm.maxTokens).toBe(4096);
    expect(config.llm.streaming).toBe(true);
    expect(config.llm.timeout).toBe(30000);
  });

  it('should have routing settings', () => {
    expect(config.routing).toBeDefined();
    expect(config.routing.threshold).toBe(30);
    expect(config.routing.cacheMessages).toBe(5);
    expect(Array.isArray(config.routing.coreCategories)).toBe(true);
  });

  it('should have token budget', () => {
    expect(config.tokenBudget.perConversation).toBe(100000);
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
    expect(config.guardrails.circuitBreaker.threshold).toBe(5);
    expect(config.guardrails.circuitBreaker.resetMs).toBe(60000);
    expect(config.guardrails.cacheTTL).toBe(30000);
  });

  it('should have null enabledCategories by default (all enabled)', () => {
    expect(config.features.enabledCategories).toBeNull();
  });
});
