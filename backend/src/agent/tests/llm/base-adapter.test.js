/**
 * Tests for agent/llm/base-adapter.js
 */

const BaseLLMAdapter = require('../../llm/base-adapter');

describe('BaseLLMAdapter', () => {
  it('should not be instantiable directly', () => {
    expect(() => new BaseLLMAdapter({ model: 'test' })).toThrow(
      'BaseLLMAdapter is abstract and cannot be instantiated directly'
    );
  });

  it('should allow subclass instantiation', () => {
    class TestAdapter extends BaseLLMAdapter {
      async chat() {
        return {};
      }
      async *chatStream() {}
      formatTools() {
        return [];
      }
      parseResponse() {
        return {};
      }
    }

    const adapter = new TestAdapter({ model: 'test-model', apiKey: 'key', maxTokens: 2048, temperature: 0.5 });
    expect(adapter.model).toBe('test-model');
    expect(adapter.apiKey).toBe('key');
    expect(adapter.maxTokens).toBe(2048);
    expect(adapter.temperature).toBe(0.5);
  });

  it('should use default maxTokens and temperature', () => {
    class TestAdapter extends BaseLLMAdapter {
      async chat() {
        return {};
      }
      async *chatStream() {}
      formatTools() {
        return [];
      }
      parseResponse() {
        return {};
      }
    }

    const adapter = new TestAdapter({ model: 'test' });
    expect(adapter.maxTokens).toBe(4096);
    expect(adapter.temperature).toBe(0);
  });

  it('should throw on unimplemented chat()', async () => {
    class IncompleteAdapter extends BaseLLMAdapter {}
    // Use Object.create to bypass the constructor check
    const adapter = Object.create(IncompleteAdapter.prototype);
    await expect(adapter.chat()).rejects.toThrow('chat() must be implemented');
  });

  it('should throw on unimplemented chatStream()', async () => {
    class IncompleteAdapter extends BaseLLMAdapter {}
    const adapter = Object.create(IncompleteAdapter.prototype);
    const generator = adapter.chatStream();
    await expect(generator.next()).rejects.toThrow('chatStream() must be implemented');
  });

  it('should throw on unimplemented formatTools()', () => {
    class IncompleteAdapter extends BaseLLMAdapter {}
    const adapter = Object.create(IncompleteAdapter.prototype);
    expect(() => adapter.formatTools([])).toThrow('formatTools() must be implemented');
  });

  it('should throw on unimplemented parseResponse()', () => {
    class IncompleteAdapter extends BaseLLMAdapter {}
    const adapter = Object.create(IncompleteAdapter.prototype);
    expect(() => adapter.parseResponse({})).toThrow('parseResponse() must be implemented');
  });
});
