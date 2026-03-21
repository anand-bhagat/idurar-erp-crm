/**
 * Tests for agent/registry.js
 */

const registry = require('../registry');
const { mockContext, mockAdminContext, mockUnauthenticatedContext } = require('./helpers/mockContext');

// Sample tools for testing
const sampleBackendTool = {
  handler: async (params) => ({ success: true, data: { id: params.id, name: 'Test' } }),
  schema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  description: 'Get a test item by ID',
  execution: 'backend',
  access: 'authenticated',
  category: 'testing',
};

const sampleAdminTool = {
  handler: async (params) => ({ success: true, data: { deleted: true } }),
  schema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  description: 'Delete a test item',
  execution: 'backend',
  access: 'admin',
  category: 'testing',
  confirmBefore: true,
};

const sampleFrontendTool = {
  schema: {
    type: 'object',
    properties: { route: { type: 'string' } },
    required: ['route'],
  },
  description: 'Navigate to a page',
  execution: 'frontend',
  access: 'authenticated',
  category: 'navigation',
  frontendAction: { type: 'navigate', route: '/test' },
};

const samplePublicTool = {
  handler: async () => ({ success: true, data: { status: 'ok' } }),
  schema: { type: 'object', properties: {} },
  description: 'Public health check',
  execution: 'backend',
  access: 'public',
  category: 'system',
};

beforeEach(() => {
  registry.clearTools();
});

describe('registry', () => {
  describe('registerTool', () => {
    it('should register a valid backend tool', () => {
      registry.registerTool('get_test', sampleBackendTool);
      expect(registry.getTool('get_test')).toBeTruthy();
    });

    it('should register a valid frontend tool', () => {
      registry.registerTool('navigate_test', sampleFrontendTool);
      expect(registry.getTool('navigate_test')).toBeTruthy();
    });

    it('should throw for backend tool without handler', () => {
      expect(() => {
        registry.registerTool('bad_tool', {
          schema: { type: 'object', properties: {} },
          execution: 'backend',
          access: 'public',
          category: 'test',
        });
      }).toThrow(/handler/);
    });

    it('should throw for frontend tool without frontendAction', () => {
      expect(() => {
        registry.registerTool('bad_tool', {
          schema: { type: 'object', properties: {} },
          execution: 'frontend',
          access: 'public',
          category: 'test',
        });
      }).toThrow(/frontendAction/);
    });

    it('should throw for tool missing required fields', () => {
      expect(() => {
        registry.registerTool('bad_tool', { schema: {} });
      }).toThrow(/missing required/);
    });
  });

  describe('registerTools', () => {
    it('should register multiple tools at once', () => {
      registry.registerTools({
        get_test: sampleBackendTool,
        navigate_test: sampleFrontendTool,
      });
      expect(registry.getToolNames()).toHaveLength(2);
    });
  });

  describe('getToolDefinitions', () => {
    beforeEach(() => {
      registry.registerTools({
        get_test: sampleBackendTool,
        delete_test: sampleAdminTool,
        navigate_test: sampleFrontendTool,
        health_check: samplePublicTool,
      });
    });

    it('should return all accessible tools for admin', () => {
      const defs = registry.getToolDefinitions('admin');
      expect(defs).toHaveLength(4);
    });

    it('should filter admin tools for regular users', () => {
      const defs = registry.getToolDefinitions('owner');
      const names = defs.map((d) => d.function.name);
      expect(names).not.toContain('delete_test');
      expect(names).toContain('get_test');
    });

    it('should return public tools for unauthenticated users', () => {
      const defs = registry.getToolDefinitions(null);
      const names = defs.map((d) => d.function.name);
      expect(names).toEqual(['health_check']);
    });

    it('should append destructive warning to confirmBefore tools', () => {
      const defs = registry.getToolDefinitions('admin');
      const deleteTool = defs.find((d) => d.function.name === 'delete_test');
      expect(deleteTool.function.description).toContain('DESTRUCTIVE');
    });

    it('should format tools in LLM function-calling shape', () => {
      const defs = registry.getToolDefinitions('admin');
      for (const def of defs) {
        expect(def.type).toBe('function');
        expect(def.function).toHaveProperty('name');
        expect(def.function).toHaveProperty('description');
        expect(def.function).toHaveProperty('parameters');
      }
    });
  });

  describe('getToolsByCategories', () => {
    beforeEach(() => {
      registry.registerTools({
        get_test: sampleBackendTool,
        delete_test: sampleAdminTool,
        navigate_test: sampleFrontendTool,
        health_check: samplePublicTool,
      });
    });

    it('should return tools from specified categories only', () => {
      const defs = registry.getToolsByCategories(['testing'], 'admin');
      const names = defs.map((d) => d.function.name);
      expect(names).toContain('get_test');
      expect(names).toContain('delete_test');
      expect(names).not.toContain('navigate_test');
    });

    it('should respect role filtering within categories', () => {
      const defs = registry.getToolsByCategories(['testing'], 'owner');
      const names = defs.map((d) => d.function.name);
      expect(names).toContain('get_test');
      expect(names).not.toContain('delete_test');
    });

    it('should return empty for non-existent category', () => {
      const defs = registry.getToolsByCategories(['nonexistent'], 'admin');
      expect(defs).toHaveLength(0);
    });
  });

  describe('getCategoryDescriptions', () => {
    it('should return registered category descriptions', () => {
      registry.registerCategories({
        testing: 'Test tools for testing',
        navigation: 'Page navigation tools',
      });
      const descs = registry.getCategoryDescriptions();
      expect(descs.testing).toBe('Test tools for testing');
      expect(descs.navigation).toBe('Page navigation tools');
    });

    it('should return a copy (not the internal object)', () => {
      registry.registerCategory('testing', 'desc');
      const descs = registry.getCategoryDescriptions();
      descs.testing = 'mutated';
      expect(registry.getCategoryDescriptions().testing).toBe('desc');
    });
  });

  describe('executeTool', () => {
    beforeEach(() => {
      registry.registerTools({
        get_test: sampleBackendTool,
        delete_test: sampleAdminTool,
        navigate_test: sampleFrontendTool,
        health_check: samplePublicTool,
      });
    });

    it('should execute backend tool and return result', async () => {
      const result = await registry.executeTool('get_test', { id: 'abc' }, mockContext());
      expect(result.success).toBe(true);
      expect(result.data.id).toBe('abc');
    });

    it('should return frontend_action for frontend tools', async () => {
      const result = await registry.executeTool('navigate_test', { route: '/home' }, mockContext());
      expect(result.type).toBe('frontend_action');
      expect(result.tool).toBe('navigate_test');
      expect(result.actionType).toBe('navigate');
    });

    it('should return NOT_FOUND for unknown tool', async () => {
      const result = await registry.executeTool('nonexistent', {}, mockContext());
      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return FORBIDDEN for unauthorized access', async () => {
      const result = await registry.executeTool('delete_test', { id: 'abc' }, mockContext({ role: 'owner' }));
      expect(result.success).toBe(false);
      expect(result.code).toBe('FORBIDDEN');
    });

    it('should allow admin to access admin tools', async () => {
      const result = await registry.executeTool('delete_test', { id: 'abc' }, mockAdminContext());
      expect(result.success).toBe(true);
    });

    it('should validate params and reject invalid input', async () => {
      const result = await registry.executeTool('get_test', {}, mockContext());
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should handle handler errors gracefully', async () => {
      registry.registerTool('error_tool', {
        handler: async () => { throw new Error('DB connection lost'); },
        schema: { type: 'object', properties: {} },
        description: 'A tool that errors',
        execution: 'backend',
        access: 'public',
        category: 'testing',
      });
      const result = await registry.executeTool('error_tool', {}, mockContext());
      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.error).toContain('DB connection lost');
    });

    it('should require auth for authenticated tools', async () => {
      const result = await registry.executeTool('get_test', { id: 'abc' }, mockUnauthenticatedContext());
      expect(result.success).toBe(false);
      expect(result.code).toBe('FORBIDDEN');
    });

    it('should allow public tools without auth', async () => {
      const result = await registry.executeTool('health_check', {}, mockUnauthenticatedContext());
      expect(result.success).toBe(true);
    });
  });

  describe('clearTools', () => {
    it('should remove all tools and categories', () => {
      registry.registerTool('get_test', sampleBackendTool);
      registry.registerCategory('testing', 'desc');
      registry.clearTools();
      expect(registry.getToolNames()).toHaveLength(0);
      expect(registry.getCategoryDescriptions()).toEqual({});
    });
  });
});
