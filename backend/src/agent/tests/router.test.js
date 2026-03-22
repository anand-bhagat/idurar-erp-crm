/**
 * Tests for agent/router.js
 *
 * Tests two-stage tool routing: category classification, core category merging,
 * fallback behavior, conversation tool cache, and engine integration.
 */

const router = require('../router');
const registry = require('../registry');
const config = require('../config');
const { resolveTools, clearEngineState } = require('../engine');
const { MockLLMAdapter } = require('./helpers/mockAdapter');
const { mockContext } = require('./helpers/mockContext');

// ---------------------------------------------------------------------------
// Helpers — register a realistic set of tools across 6 categories
// ---------------------------------------------------------------------------

function registerTestTools() {
  registry.registerCategories({
    clients: 'Client management — CRUD operations, search, summary statistics, and navigation to client pages.',
    invoices: 'Invoice management — CRUD operations, search, financial summary, and navigation to invoice pages.',
    payments: 'Payment management — CRUD operations, search, financial summary, and navigation to payment pages.',
    settings: 'Application settings — read, update, and bulk-update configuration values like company name, currency, language, and invoice settings.',
    admin: 'Admin profile management — view and update admin user profile details.',
    navigation: 'Page navigation — navigate to dashboard, settings, profile, login, and other application pages.',
  });

  // Clients (4 tools)
  registry.registerTools({
    get_client: {
      handler: async () => ({ success: true, data: {} }),
      schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      description: 'Get a client by ID',
      execution: 'backend',
      access: 'authenticated',
      category: 'clients',
    },
    list_clients: {
      handler: async () => ({ success: true, data: [] }),
      schema: { type: 'object', properties: {} },
      description: 'List clients',
      execution: 'backend',
      access: 'authenticated',
      category: 'clients',
    },
    search_clients: {
      handler: async () => ({ success: true, data: [] }),
      schema: { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] },
      description: 'Search clients',
      execution: 'backend',
      access: 'authenticated',
      category: 'clients',
    },
    create_client: {
      handler: async () => ({ success: true, data: {} }),
      schema: { type: 'object', properties: { company: { type: 'string' } }, required: ['company'] },
      description: 'Create a client',
      execution: 'backend',
      access: 'authenticated',
      category: 'clients',
    },
  });

  // Invoices (3 tools)
  registry.registerTools({
    get_invoice: {
      handler: async () => ({ success: true, data: {} }),
      schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      description: 'Get an invoice by ID',
      execution: 'backend',
      access: 'authenticated',
      category: 'invoices',
    },
    list_invoices: {
      handler: async () => ({ success: true, data: [] }),
      schema: { type: 'object', properties: {} },
      description: 'List invoices',
      execution: 'backend',
      access: 'authenticated',
      category: 'invoices',
    },
    create_invoice: {
      handler: async () => ({ success: true, data: {} }),
      schema: { type: 'object', properties: { client: { type: 'string' } }, required: ['client'] },
      description: 'Create an invoice',
      execution: 'backend',
      access: 'authenticated',
      category: 'invoices',
    },
  });

  // Payments (3 tools)
  registry.registerTools({
    get_payment: {
      handler: async () => ({ success: true, data: {} }),
      schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      description: 'Get a payment by ID',
      execution: 'backend',
      access: 'authenticated',
      category: 'payments',
    },
    list_payments: {
      handler: async () => ({ success: true, data: [] }),
      schema: { type: 'object', properties: {} },
      description: 'List payments',
      execution: 'backend',
      access: 'authenticated',
      category: 'payments',
    },
    create_payment: {
      handler: async () => ({ success: true, data: {} }),
      schema: { type: 'object', properties: { invoice: { type: 'string' } }, required: ['invoice'] },
      description: 'Create a payment',
      execution: 'backend',
      access: 'authenticated',
      category: 'payments',
    },
  });

  // Settings (2 tools)
  registry.registerTools({
    get_setting: {
      handler: async () => ({ success: true, data: {} }),
      schema: { type: 'object', properties: { settingKey: { type: 'string' } }, required: ['settingKey'] },
      description: 'Get a setting',
      execution: 'backend',
      access: 'authenticated',
      category: 'settings',
    },
    update_setting: {
      handler: async () => ({ success: true, data: {} }),
      schema: { type: 'object', properties: { settingKey: { type: 'string' } }, required: ['settingKey'] },
      description: 'Update a setting',
      execution: 'backend',
      access: 'authenticated',
      category: 'settings',
    },
  });

  // Admin (1 tool)
  registry.registerTools({
    get_admin_profile: {
      handler: async () => ({ success: true, data: {} }),
      schema: { type: 'object', properties: {} },
      description: 'Get admin profile',
      execution: 'backend',
      access: 'authenticated',
      category: 'admin',
    },
  });

  // Navigation (3 frontend tools)
  registry.registerTools({
    navigate_to_dashboard: {
      schema: { type: 'object', properties: {} },
      description: 'Navigate to the dashboard',
      execution: 'frontend',
      access: 'authenticated',
      category: 'navigation',
      frontendAction: { type: 'navigate', route: '/dashboard' },
    },
    navigate_to_settings: {
      schema: { type: 'object', properties: {} },
      description: 'Navigate to the settings page',
      execution: 'frontend',
      access: 'authenticated',
      category: 'navigation',
      frontendAction: { type: 'navigate', route: '/settings' },
    },
    navigate_to_customers: {
      schema: { type: 'object', properties: {} },
      description: 'Navigate to the customers page',
      execution: 'frontend',
      access: 'authenticated',
      category: 'navigation',
      frontendAction: { type: 'navigate', route: '/customers' },
    },
  });
}

let adapter;
let originalRoutingEnabled;
let originalRoutingThreshold;

beforeEach(() => {
  adapter = new MockLLMAdapter();
  registry.clearTools();
  router.clearCache();
  clearEngineState();
  // Save and override config for tests
  originalRoutingEnabled = config.routing.enabled;
  originalRoutingThreshold = config.routing.threshold;
});

afterEach(() => {
  config.routing.enabled = originalRoutingEnabled;
  config.routing.threshold = originalRoutingThreshold;
});

// ===========================================================================
// buildRouterPrompt
// ===========================================================================

describe('router', () => {
  describe('buildRouterPrompt', () => {
    it('should include all registered category descriptions', () => {
      registerTestTools();
      const prompt = router.buildRouterPrompt();
      expect(prompt).toContain('clients:');
      expect(prompt).toContain('invoices:');
      expect(prompt).toContain('payments:');
      expect(prompt).toContain('settings:');
      expect(prompt).toContain('admin:');
      expect(prompt).toContain('navigation:');
    });

    it('should instruct LLM to return JSON array', () => {
      registerTestTools();
      const prompt = router.buildRouterPrompt();
      expect(prompt).toContain('JSON array');
      expect(prompt).toContain('ONLY the JSON array');
    });

    it('should include 1-4 category limit', () => {
      registerTestTools();
      const prompt = router.buildRouterPrompt();
      expect(prompt).toContain('1-4');
    });
  });

  // ===========================================================================
  // parseRouterResponse
  // ===========================================================================

  describe('parseRouterResponse', () => {
    it('should parse a clean JSON array', () => {
      expect(router.parseRouterResponse('["clients", "invoices"]')).toEqual(['clients', 'invoices']);
    });

    it('should parse JSON array with whitespace', () => {
      expect(router.parseRouterResponse('  ["clients"]  ')).toEqual(['clients']);
    });

    it('should parse JSON array embedded in text', () => {
      expect(router.parseRouterResponse('Here are the categories: ["payments", "navigation"]')).toEqual([
        'payments',
        'navigation',
      ]);
    });

    it('should return null for empty string', () => {
      expect(router.parseRouterResponse('')).toBeNull();
    });

    it('should return null for null input', () => {
      expect(router.parseRouterResponse(null)).toBeNull();
    });

    it('should return null for non-array JSON', () => {
      expect(router.parseRouterResponse('{"category": "clients"}')).toBeNull();
    });

    it('should return null for array with non-string elements', () => {
      expect(router.parseRouterResponse('[1, 2, 3]')).toBeNull();
    });

    it('should return null for completely unparseable text', () => {
      expect(router.parseRouterResponse('I think you need clients and invoices')).toBeNull();
    });

    it('should handle single-element array', () => {
      expect(router.parseRouterResponse('["settings"]')).toEqual(['settings']);
    });

    it('should handle array with 4 elements', () => {
      const result = router.parseRouterResponse('["clients", "invoices", "payments", "navigation"]');
      expect(result).toHaveLength(4);
    });
  });

  // ===========================================================================
  // validateCategories
  // ===========================================================================

  describe('validateCategories', () => {
    beforeEach(() => registerTestTools());

    it('should keep valid categories', () => {
      expect(router.validateCategories(['clients', 'invoices'])).toEqual(['clients', 'invoices']);
    });

    it('should filter out unknown categories', () => {
      expect(router.validateCategories(['clients', 'nonexistent', 'invoices'])).toEqual([
        'clients',
        'invoices',
      ]);
    });

    it('should return empty array if all categories are unknown', () => {
      expect(router.validateCategories(['foo', 'bar'])).toEqual([]);
    });

    it('should return empty array for empty input', () => {
      expect(router.validateCategories([])).toEqual([]);
    });
  });

  // ===========================================================================
  // routeTools — diverse query tests
  // ===========================================================================

  describe('routeTools', () => {
    beforeEach(() => registerTestTools());

    it('should route "Show me all clients" to clients + navigation', async () => {
      adapter.setNextResponse({
        content: '["clients"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      const result = await router.routeTools('Show me all clients', [], 'owner', adapter);

      expect(result.fallback).toBe(false);
      expect(result.categories).toContain('clients');
      expect(result.categories).toContain('navigation'); // core category
      // Should have client tools + navigation tools
      const toolNames = result.tools.map((t) => t.function.name);
      expect(toolNames).toContain('get_client');
      expect(toolNames).toContain('list_clients');
      expect(toolNames).toContain('navigate_to_dashboard');
    });

    it('should route "Create an invoice for Acme" to invoices + clients + navigation', async () => {
      adapter.setNextResponse({
        content: '["invoices", "clients"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      const result = await router.routeTools('Create an invoice for Acme', [], 'owner', adapter);

      expect(result.categories).toContain('invoices');
      expect(result.categories).toContain('clients');
      expect(result.categories).toContain('navigation');
      const toolNames = result.tools.map((t) => t.function.name);
      expect(toolNames).toContain('create_invoice');
      expect(toolNames).toContain('search_clients');
    });

    it('should route "Record a payment and go to dashboard" to payments + navigation', async () => {
      adapter.setNextResponse({
        content: '["payments", "navigation"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      const result = await router.routeTools(
        'Record a payment and go to dashboard',
        [],
        'owner',
        adapter
      );

      expect(result.categories).toContain('payments');
      expect(result.categories).toContain('navigation');
      const toolNames = result.tools.map((t) => t.function.name);
      expect(toolNames).toContain('create_payment');
      expect(toolNames).toContain('navigate_to_dashboard');
    });

    it('should route "What are my settings?" to settings + navigation', async () => {
      adapter.setNextResponse({
        content: '["settings"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      const result = await router.routeTools('What are my settings?', [], 'owner', adapter);

      expect(result.categories).toContain('settings');
      expect(result.categories).toContain('navigation');
    });

    it('should route "Show my profile" to admin + navigation', async () => {
      adapter.setNextResponse({
        content: '["admin"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      const result = await router.routeTools('Show my profile', [], 'owner', adapter);

      expect(result.categories).toContain('admin');
      expect(result.categories).toContain('navigation');
    });

    it('should route multi-entity queries across categories', async () => {
      adapter.setNextResponse({
        content: '["clients", "invoices", "payments"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      const result = await router.routeTools(
        'Show all invoices and payments for client Acme',
        [],
        'owner',
        adapter
      );

      expect(result.categories).toContain('clients');
      expect(result.categories).toContain('invoices');
      expect(result.categories).toContain('payments');
      expect(result.categories).toContain('navigation');
    });

    it('should always include navigation as core category', async () => {
      adapter.setNextResponse({
        content: '["payments"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      const result = await router.routeTools('Show payments', [], 'owner', adapter);

      expect(result.categories).toContain('navigation');
    });

    it('should not duplicate navigation if LLM already returned it', async () => {
      adapter.setNextResponse({
        content: '["payments", "navigation"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      const result = await router.routeTools('Show payments', [], 'owner', adapter);

      const navCount = result.categories.filter((c) => c === 'navigation').length;
      expect(navCount).toBe(1);
    });

    // --- Fallback scenarios ---

    it('should fall back to all tools when LLM returns unparseable response', async () => {
      adapter.setNextResponse({
        content: 'I think you need clients and invoices',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 20 },
      });

      const result = await router.routeTools('Show me clients', [], 'owner', adapter);

      expect(result.fallback).toBe(true);
      // Should return all tools
      const allTools = registry.getToolDefinitions('owner');
      expect(result.tools.length).toBe(allTools.length);
    });

    it('should fall back when LLM returns all unknown categories', async () => {
      adapter.setNextResponse({
        content: '["products", "orders"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      const result = await router.routeTools('Show products', [], 'owner', adapter);

      expect(result.fallback).toBe(true);
    });

    it('should fall back when adapter throws an error', async () => {
      // Override chat to throw
      adapter.chat = async () => {
        throw new Error('LLM timeout');
      };

      const result = await router.routeTools('Show clients', [], 'owner', adapter);

      expect(result.fallback).toBe(true);
      const allTools = registry.getToolDefinitions('owner');
      expect(result.tools.length).toBe(allTools.length);
    });

    it('should fall back when LLM returns empty array', async () => {
      adapter.setNextResponse({
        content: '[]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 5 },
      });

      const result = await router.routeTools('Hello', [], 'owner', adapter);

      expect(result.fallback).toBe(true);
    });

    it('should fall back when no categories are registered', async () => {
      registry.clearTools();
      const result = await router.routeTools('Show clients', [], 'owner', adapter);

      expect(result.fallback).toBe(true);
    });

    it('should pass conversation history to the adapter', async () => {
      adapter.setNextResponse({
        content: '["clients"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      const history = [
        { role: 'user', content: 'I need help with my account' },
        { role: 'assistant', content: 'Sure, what do you need?' },
      ];

      await router.routeTools('Show me my clients', history, 'owner', adapter);

      const calls = adapter.getCalls();
      expect(calls).toHaveLength(1);
      // Messages should be: system + 2 history + user message = 4
      expect(calls[0].messages).toHaveLength(4);
      expect(calls[0].messages[1].content).toBe('I need help with my account');
    });

    it('should truncate history to last 3 messages', async () => {
      adapter.setNextResponse({
        content: '["clients"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      const history = [
        { role: 'user', content: 'msg1' },
        { role: 'assistant', content: 'msg2' },
        { role: 'user', content: 'msg3' },
        { role: 'assistant', content: 'msg4' },
        { role: 'user', content: 'msg5' },
      ];

      await router.routeTools('Show clients', history, 'owner', adapter);

      const calls = adapter.getCalls();
      // system + last 3 history + user message = 5
      expect(calls[0].messages).toHaveLength(5);
      expect(calls[0].messages[1].content).toBe('msg3');
    });

    it('should filter valid categories when mixed with unknown', async () => {
      adapter.setNextResponse({
        content: '["clients", "unknown_category", "invoices"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      const result = await router.routeTools('Show clients and invoices', [], 'owner', adapter);

      expect(result.fallback).toBe(false);
      expect(result.categories).toContain('clients');
      expect(result.categories).toContain('invoices');
      expect(result.categories).not.toContain('unknown_category');
    });

    it('should send empty tools array to router adapter (no tool schemas)', async () => {
      adapter.setNextResponse({
        content: '["clients"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      await router.routeTools('Show clients', [], 'owner', adapter);

      const calls = adapter.getCalls();
      expect(calls[0].tools).toEqual([]);
    });
  });

  // ===========================================================================
  // Conversation Tool Cache (RTR-03)
  // ===========================================================================

  describe('getToolsForMessage — conversation cache', () => {
    beforeEach(() => registerTestTools());

    it('should cache tools on first call', async () => {
      adapter.setNextResponse({
        content: '["clients"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      const result = await router.getToolsForMessage('Show clients', 'conv-1', [], 'owner', adapter);

      expect(result.cached).toBe(false);
      expect(result.categories).toContain('clients');
    });

    it('should return cached tools on subsequent calls (same conversation)', async () => {
      adapter.setNextResponse({
        content: '["clients"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      // First call — routes
      await router.getToolsForMessage('Show clients', 'conv-1', [], 'owner', adapter);

      // Second call — should be cached (no new adapter call)
      const result = await router.getToolsForMessage('How many clients?', 'conv-1', [], 'owner', adapter);

      expect(result.cached).toBe(true);
      expect(result.categories).toContain('clients');
      // Adapter should only have been called once
      expect(adapter.getCalls()).toHaveLength(1);
    });

    it('should re-route after cacheMessages threshold', async () => {
      const savedCacheMessages = config.routing.cacheMessages;
      config.routing.cacheMessages = 3;

      adapter.setNextResponses([
        { content: '["clients"]', toolCalls: null, usage: { inputTokens: 100, outputTokens: 10 } },
        { content: '["invoices"]', toolCalls: null, usage: { inputTokens: 100, outputTokens: 10 } },
      ]);

      // Call 1 — routes (messageCount = 1)
      await router.getToolsForMessage('msg1', 'conv-2', [], 'owner', adapter);
      // Call 2 — cached (messageCount = 2)
      await router.getToolsForMessage('msg2', 'conv-2', [], 'owner', adapter);
      // Call 3 — cached (messageCount = 3)
      await router.getToolsForMessage('msg3', 'conv-2', [], 'owner', adapter);
      // Call 4 — should re-route (messageCount >= 3)
      const result = await router.getToolsForMessage('msg4', 'conv-2', [], 'owner', adapter);

      expect(result.cached).toBe(false);
      expect(result.categories).toContain('invoices');
      expect(adapter.getCalls()).toHaveLength(2);

      config.routing.cacheMessages = savedCacheMessages;
    });

    it('should use separate caches for different conversations', async () => {
      adapter.setNextResponses([
        { content: '["clients"]', toolCalls: null, usage: { inputTokens: 100, outputTokens: 10 } },
        { content: '["invoices"]', toolCalls: null, usage: { inputTokens: 100, outputTokens: 10 } },
      ]);

      const result1 = await router.getToolsForMessage('Show clients', 'conv-A', [], 'owner', adapter);
      const result2 = await router.getToolsForMessage('Show invoices', 'conv-B', [], 'owner', adapter);

      expect(result1.categories).toContain('clients');
      expect(result2.categories).toContain('invoices');
      expect(adapter.getCalls()).toHaveLength(2);
    });

    it('should invalidate cache for a specific conversation', async () => {
      adapter.setNextResponses([
        { content: '["clients"]', toolCalls: null, usage: { inputTokens: 100, outputTokens: 10 } },
        { content: '["payments"]', toolCalls: null, usage: { inputTokens: 100, outputTokens: 10 } },
      ]);

      await router.getToolsForMessage('msg1', 'conv-3', [], 'owner', adapter);
      router.invalidateCache('conv-3');
      const result = await router.getToolsForMessage('msg2', 'conv-3', [], 'owner', adapter);

      expect(result.cached).toBe(false);
      expect(adapter.getCalls()).toHaveLength(2);
    });

    it('should clear all caches', async () => {
      adapter.setNextResponses([
        { content: '["clients"]', toolCalls: null, usage: { inputTokens: 100, outputTokens: 10 } },
        { content: '["invoices"]', toolCalls: null, usage: { inputTokens: 100, outputTokens: 10 } },
        { content: '["payments"]', toolCalls: null, usage: { inputTokens: 100, outputTokens: 10 } },
      ]);

      await router.getToolsForMessage('msg', 'conv-X', [], 'owner', adapter);
      await router.getToolsForMessage('msg', 'conv-Y', [], 'owner', adapter);

      router.clearCache();

      const stats = router.getCacheStats();
      expect(stats.size).toBe(0);

      // Next call should route again
      const result = await router.getToolsForMessage('msg', 'conv-X', [], 'owner', adapter);
      expect(result.cached).toBe(false);
    });

    it('should report cache stats', async () => {
      adapter.setNextResponse({
        content: '["clients"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      await router.getToolsForMessage('msg', 'conv-stats', [], 'owner', adapter);

      const stats = router.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.entries[0].conversationId).toBe('conv-stats');
      expect(stats.entries[0].categories).toContain('clients');
      expect(stats.entries[0].messageCount).toBe(1);
    });
  });

  // ===========================================================================
  // shouldRoute — threshold behavior
  // ===========================================================================

  describe('shouldRoute', () => {
    it('should return false when routing is disabled', () => {
      config.routing.enabled = false;
      registerTestTools();
      expect(router.shouldRoute('owner')).toBe(false);
    });

    it('should return false when tool count is below threshold', () => {
      config.routing.enabled = true;
      config.routing.threshold = 50;
      registerTestTools(); // 16 tools
      expect(router.shouldRoute('owner')).toBe(false);
    });

    it('should return true when tool count exceeds threshold', () => {
      config.routing.enabled = true;
      config.routing.threshold = 5;
      registerTestTools(); // 16 tools
      expect(router.shouldRoute('owner')).toBe(true);
    });

    it('should return true when tool count equals threshold + 1', () => {
      config.routing.enabled = true;
      config.routing.threshold = 15;
      registerTestTools(); // 16 tools
      expect(router.shouldRoute('owner')).toBe(true);
    });
  });

  // ===========================================================================
  // resolveTools — engine integration (RTR-04)
  // ===========================================================================

  describe('resolveTools — engine integration', () => {
    beforeEach(() => registerTestTools());

    it('should skip routing when disabled and return all tools', async () => {
      config.routing.enabled = false;
      const ctx = mockContext();

      const result = await resolveTools('Show clients', ctx, [], adapter);

      expect(result.routed).toBe(false);
      const allTools = registry.getToolDefinitions(ctx.role);
      expect(result.tools.length).toBe(allTools.length);
    });

    it('should skip routing when below threshold', async () => {
      config.routing.enabled = true;
      config.routing.threshold = 100;
      const ctx = mockContext();

      const result = await resolveTools('Show clients', ctx, [], adapter);

      expect(result.routed).toBe(false);
    });

    it('should use routing when above threshold', async () => {
      config.routing.enabled = true;
      config.routing.threshold = 5;

      adapter.setNextResponse({
        content: '["clients"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      const ctx = mockContext();
      const result = await resolveTools('Show clients', ctx, [], adapter);

      expect(result.routed).toBe(true);
      expect(result.categories).toContain('clients');
      expect(result.categories).toContain('navigation');
      // Only client + navigation tools
      const toolNames = result.tools.map((t) => t.function.name);
      expect(toolNames).toContain('get_client');
      expect(toolNames).toContain('navigate_to_dashboard');
      expect(toolNames).not.toContain('get_invoice');
      expect(toolNames).not.toContain('get_payment');
    });

    it('should keep stable tool list across multiple messages (via cache)', async () => {
      config.routing.enabled = true;
      config.routing.threshold = 5;

      adapter.setNextResponse({
        content: '["clients"]',
        toolCalls: null,
        usage: { inputTokens: 100, outputTokens: 10 },
      });

      const ctx = mockContext();

      // First message — routes
      const result1 = await resolveTools('Show clients', ctx, [], adapter);
      // Second message — cached
      const result2 = await resolveTools('How many clients?', ctx, [], adapter);

      // Same tool list both times
      expect(result1.tools.length).toBe(result2.tools.length);
      expect(result2.cached).toBe(true);
      // Only 1 adapter call
      expect(adapter.getCalls()).toHaveLength(1);
    });

    it('should fall back gracefully on router error', async () => {
      config.routing.enabled = true;
      config.routing.threshold = 5;

      adapter.chat = async () => {
        throw new Error('LLM down');
      };

      const ctx = mockContext();
      const result = await resolveTools('Show clients', ctx, [], adapter);

      expect(result.routed).toBe(true);
      expect(result.fallback).toBe(true);
      // Should still return tools (all of them)
      expect(result.tools.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Category description registry (RTR-01)
  // ===========================================================================

  describe('category descriptions — RTR-01', () => {
    it('should return all 6 category descriptions when all tools registered', () => {
      registerTestTools();
      const descs = registry.getCategoryDescriptions();
      const keys = Object.keys(descs);

      expect(keys).toContain('clients');
      expect(keys).toContain('invoices');
      expect(keys).toContain('payments');
      expect(keys).toContain('settings');
      expect(keys).toContain('admin');
      expect(keys).toContain('navigation');
      expect(keys).toHaveLength(6);
    });

    it('should have non-empty descriptions for all categories', () => {
      registerTestTools();
      const descs = registry.getCategoryDescriptions();

      for (const [name, desc] of Object.entries(descs)) {
        expect(desc).toBeTruthy();
        expect(typeof desc).toBe('string');
        expect(desc.length).toBeGreaterThan(10);
      }
    });

    it('should not be mutated by external code', () => {
      registerTestTools();
      const descs = registry.getCategoryDescriptions();
      descs.clients = 'HACKED';
      expect(registry.getCategoryDescriptions().clients).not.toBe('HACKED');
    });
  });
});
