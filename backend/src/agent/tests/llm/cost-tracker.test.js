/**
 * Tests for agent/llm/cost-tracker.js
 */

const { trackUsage, getSessionUsage, resetSessionUsage } = require('../../llm/cost-tracker');

describe('Cost Tracker', () => {
  beforeEach(() => {
    resetSessionUsage();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  describe('trackUsage()', () => {
    it('should calculate cost correctly for known model', () => {
      const result = trackUsage(
        { inputTokens: 1000, outputTokens: 500, cachedTokens: 0 },
        'gpt-4o-mini'
      );

      // input: 1000/1M * 0.15 = 0.00015
      // output: 500/1M * 0.6 = 0.0003
      expect(result.inputCost).toBeCloseTo(0.00015, 6);
      expect(result.outputCost).toBeCloseTo(0.0003, 6);
      expect(result.totalCost).toBeCloseTo(0.00045, 6);
    });

    it('should calculate cache-aware cost correctly', () => {
      const result = trackUsage(
        { inputTokens: 1000, outputTokens: 500, cachedTokens: 800 },
        'gpt-4o-mini'
      );

      // input (non-cached): 200/1M * 0.15 = 0.00003
      // cached: 800/1M * 0.075 = 0.00006
      // output: 500/1M * 0.6 = 0.0003
      expect(result.inputCost).toBeCloseTo(0.00003, 6);
      expect(result.cachedCost).toBeCloseTo(0.00006, 6);
      expect(result.outputCost).toBeCloseTo(0.0003, 6);
    });

    it('should accumulate session totals', () => {
      trackUsage({ inputTokens: 1000, outputTokens: 500, cachedTokens: 0 }, 'gpt-4o-mini');
      trackUsage({ inputTokens: 2000, outputTokens: 800, cachedTokens: 1500 }, 'gpt-4o-mini');

      const session = getSessionUsage();
      expect(session.totalInputTokens).toBe(3000);
      expect(session.totalOutputTokens).toBe(1300);
      expect(session.totalCachedTokens).toBe(1500);
      expect(session.callCount).toBe(2);
      expect(session.totalCost).toBeGreaterThan(0);
    });

    it('should handle unknown model gracefully (no pricing)', () => {
      const result = trackUsage(
        { inputTokens: 1000, outputTokens: 500, cachedTokens: 0 },
        'unknown-model'
      );

      expect(result).toBeUndefined();
      // Session should not change
      const session = getSessionUsage();
      expect(session.callCount).toBe(0);
    });

    it('should handle missing cachedTokens', () => {
      const result = trackUsage(
        { inputTokens: 1000, outputTokens: 500 },
        'gpt-4o-mini'
      );

      expect(result.cachedCost).toBeCloseTo(0, 6);
      expect(result.inputCost).toBeCloseTo(0.00015, 6);
    });

    it('should produce structured JSON log', () => {
      trackUsage({ inputTokens: 1000, outputTokens: 500, cachedTokens: 800 }, 'gpt-4o-mini');

      expect(console.log).toHaveBeenCalledTimes(1);
      const logOutput = JSON.parse(console.log.mock.calls[0][0]);
      expect(logOutput.type).toBe('llm_usage');
      expect(logOutput.model).toBe('gpt-4o-mini');
      expect(logOutput.inputTokens).toBe(1000);
      expect(logOutput.outputTokens).toBe(500);
      expect(logOutput.cachedTokens).toBe(800);
      expect(logOutput.cacheHitRate).toBe('80.0%');
      expect(logOutput.timestamp).toBeDefined();
    });

    it('should handle zero input tokens for cache hit rate', () => {
      trackUsage({ inputTokens: 0, outputTokens: 100, cachedTokens: 0 }, 'gpt-4o-mini');

      const logOutput = JSON.parse(console.log.mock.calls[0][0]);
      expect(logOutput.cacheHitRate).toBe('0%');
    });
  });

  describe('getSessionUsage()', () => {
    it('should return a copy (not reference)', () => {
      const session = getSessionUsage();
      session.totalCost = 999;
      expect(getSessionUsage().totalCost).toBe(0);
    });
  });

  describe('resetSessionUsage()', () => {
    it('should reset all counters', () => {
      trackUsage({ inputTokens: 1000, outputTokens: 500, cachedTokens: 0 }, 'gpt-4o-mini');
      resetSessionUsage();

      const session = getSessionUsage();
      expect(session.totalInputTokens).toBe(0);
      expect(session.totalOutputTokens).toBe(0);
      expect(session.totalCachedTokens).toBe(0);
      expect(session.totalCost).toBe(0);
      expect(session.callCount).toBe(0);
    });
  });

  describe('pricing for all models', () => {
    const models = [
      'claude-sonnet-4-20250514',
      'claude-haiku-4-5-20251001',
      'gpt-4o',
      'gpt-4o-mini',
      'zhipu-ai/glm-4.7-flash',
      'llama-3.3-70b-versatile',
    ];

    for (const model of models) {
      it(`should track usage for ${model}`, () => {
        resetSessionUsage();
        const result = trackUsage(
          { inputTokens: 10000, outputTokens: 5000, cachedTokens: 8000 },
          model
        );
        expect(result).toBeDefined();
        expect(result.totalCost).toBeGreaterThan(0);
      });
    }
  });
});
