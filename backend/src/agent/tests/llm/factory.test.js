/**
 * Tests for agent/llm/index.js (Adapter Factory)
 */

const { getLLMAdapter, resetAdapter } = require('../../llm');

// Mock both adapters
jest.mock('../../llm/adapters/anthropic', () => {
  return jest.fn().mockImplementation((config) => ({
    type: 'anthropic',
    model: config.model,
  }));
});

jest.mock('../../llm/adapters/openai', () => {
  return jest.fn().mockImplementation((config) => ({
    type: 'openai-compatible',
    model: config.model,
  }));
});

describe('LLM Adapter Factory', () => {
  beforeEach(() => {
    resetAdapter();
  });

  it('should create OpenAI-compatible adapter', () => {
    const adapter = getLLMAdapter({
      provider: 'openai-compatible',
      model: 'gpt-4o-mini',
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
    });

    expect(adapter.type).toBe('openai-compatible');
    expect(adapter.model).toBe('gpt-4o-mini');
  });

  it('should create Anthropic adapter', () => {
    const adapter = getLLMAdapter({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'test-key',
    });

    expect(adapter.type).toBe('anthropic');
    expect(adapter.model).toBe('claude-sonnet-4-20250514');
  });

  it('should return singleton instance on subsequent calls', () => {
    const adapter1 = getLLMAdapter({
      provider: 'openai-compatible',
      model: 'gpt-4o-mini',
      apiKey: 'key',
    });
    const adapter2 = getLLMAdapter({
      provider: 'anthropic', // Different provider — should still get same instance
      model: 'claude',
      apiKey: 'key2',
    });

    expect(adapter1).toBe(adapter2);
  });

  it('should create new instance after resetAdapter()', () => {
    const adapter1 = getLLMAdapter({
      provider: 'openai-compatible',
      model: 'gpt-4o-mini',
      apiKey: 'key',
    });

    resetAdapter();

    const adapter2 = getLLMAdapter({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'key2',
    });

    expect(adapter1).not.toBe(adapter2);
    expect(adapter2.type).toBe('anthropic');
  });

  it('should throw on unknown provider', () => {
    expect(() =>
      getLLMAdapter({ provider: 'unknown', model: 'test', apiKey: 'key' })
    ).toThrow('Unknown LLM provider: "unknown"');
  });

  it('should include available providers in error message', () => {
    try {
      getLLMAdapter({ provider: 'invalid', model: 'test', apiKey: 'key' });
    } catch (e) {
      expect(e.message).toContain('anthropic');
      expect(e.message).toContain('openai-compatible');
    }
  });
});
