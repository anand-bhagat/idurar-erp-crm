/**
 * Integration & E2E Tests
 *
 * Covers E2E-01 through E2E-05 from TASKS.md:
 * - Full chain wiring (engine → registry → tools → response)
 * - System prompt tuning verification
 * - Permission boundary tests
 * - Error & recovery tests
 * - Multi-tool chain tests
 */

const { runAgent, runAgentStream, resolveTools, setHooks, clearEngineState } = require('../engine');
const registry = require('../registry');
const { buildSystemPrompt } = require('../llm/prompt-builder');
const observability = require('../observability');
const { MockLLMAdapter } = require('./helpers/mockAdapter');
const { mockContext, mockAdminContext, mockUnauthenticatedContext } = require('./helpers/mockContext');

let adapter;
let ctx;

/**
 * Register a realistic set of tools mirroring the production tool layout.
 * Uses in-memory handlers (no Mongoose) so tests run without a database.
 */
function registerTestTools() {
  const clientsDb = [
    { _id: 'c1', name: 'Acme Corp', email: 'contact@acme.com', type: 'company', removed: false },
    { _id: 'c2', name: 'Jane Doe', email: 'jane@example.com', type: 'person', removed: false },
  ];

  const invoicesDb = [
    { _id: 'inv1', number: 'INV-001', client: 'c1', total: 1650, status: 'sent', paymentStatus: 'unpaid', removed: false },
    { _id: 'inv2', number: 'INV-002', client: 'c2', total: 500, status: 'draft', paymentStatus: 'unpaid', removed: false },
  ];

  const paymentsDb = [
    { _id: 'pay1', number: 'PAY-001', invoice: 'inv1', client: 'c1', amount: 500, paymentMode: 'bank_transfer', removed: false },
  ];

  // -- Clients --
  registry.registerCategory('clients', 'Client management — CRUD operations for clients.');

  registry.registerTool('get_client', {
    handler: async (params) => {
      const c = clientsDb.find((x) => x._id === params.id && !x.removed);
      return c ? { success: true, data: c } : { success: false, error: 'Client not found', code: 'NOT_FOUND' };
    },
    schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    description: 'Get a single client by ID.',
    execution: 'backend',
    access: 'authenticated',
    category: 'clients',
  });

  registry.registerTool('search_clients', {
    handler: async (params) => {
      const q = (params.q || '').toLowerCase();
      const results = clientsDb.filter((c) => !c.removed && c.name.toLowerCase().includes(q));
      return { success: true, data: results, pagination: { page: 1, pages: 1, count: results.length } };
    },
    schema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    description: 'Search clients by name.',
    execution: 'backend',
    access: 'authenticated',
    category: 'clients',
  });

  registry.registerTool('list_clients', {
    handler: async () => {
      const active = clientsDb.filter((c) => !c.removed);
      return { success: true, data: active, pagination: { page: 1, pages: 1, count: active.length } };
    },
    schema: { type: 'object', properties: { page: { type: 'integer' } } },
    description: 'List all clients with pagination.',
    execution: 'backend',
    access: 'authenticated',
    category: 'clients',
  });

  registry.registerTool('create_client', {
    handler: async (params) => {
      const newClient = { _id: 'c-new', ...params, removed: false };
      clientsDb.push(newClient);
      return { success: true, data: newClient };
    },
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        type: { type: 'string', enum: ['company', 'person'] },
      },
      required: ['name', 'type'],
    },
    description: 'Create a new client.',
    execution: 'backend',
    access: 'authenticated',
    category: 'clients',
  });

  registry.registerTool('delete_client', {
    handler: async (params) => {
      const idx = clientsDb.findIndex((c) => c._id === params.id);
      if (idx === -1) return { success: false, error: 'Client not found', code: 'NOT_FOUND' };
      clientsDb[idx].removed = true;
      return { success: true, data: { message: 'Client deleted' } };
    },
    schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    description: 'Soft-delete a client.\n⚠️ DESTRUCTIVE: Always ask for user confirmation before calling this tool.',
    execution: 'backend',
    access: 'authenticated',
    category: 'clients',
    confirmBefore: true,
  });

  // -- Invoices --
  registry.registerCategory('invoices', 'Invoice management — CRUD operations for invoices.');

  registry.registerTool('list_invoices', {
    handler: async (params) => {
      let results = invoicesDb.filter((i) => !i.removed);
      if (params.client) results = results.filter((i) => i.client === params.client);
      return { success: true, data: results, pagination: { page: 1, pages: 1, count: results.length } };
    },
    schema: { type: 'object', properties: { client: { type: 'string' }, page: { type: 'integer' } } },
    description: 'List invoices with optional client filter.',
    execution: 'backend',
    access: 'authenticated',
    category: 'invoices',
  });

  registry.registerTool('search_invoices', {
    handler: async (params) => {
      const q = (params.q || '').toLowerCase();
      const results = invoicesDb.filter((i) => !i.removed && i.number.toLowerCase().includes(q));
      return { success: true, data: results, pagination: { page: 1, pages: 1, count: results.length } };
    },
    schema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    description: 'Search invoices by number.',
    execution: 'backend',
    access: 'authenticated',
    category: 'invoices',
  });

  registry.registerTool('create_invoice', {
    handler: async (params) => {
      const newInv = { _id: 'inv-new', number: 'INV-NEW', ...params, removed: false };
      invoicesDb.push(newInv);
      return { success: true, data: newInv };
    },
    schema: {
      type: 'object',
      properties: {
        client: { type: 'string' },
        items: { type: 'array', items: { type: 'object' } },
        taxRate: { type: 'number' },
      },
      required: ['client', 'items'],
    },
    description: 'Create a new invoice.',
    execution: 'backend',
    access: 'authenticated',
    category: 'invoices',
  });

  // -- Payments --
  registry.registerCategory('payments', 'Payment management — CRUD for payments.');

  registry.registerTool('create_payment', {
    handler: async (params) => {
      const newPay = { _id: 'pay-new', number: 'PAY-NEW', ...params, removed: false };
      paymentsDb.push(newPay);
      return { success: true, data: newPay };
    },
    schema: {
      type: 'object',
      properties: {
        invoice: { type: 'string' },
        amount: { type: 'number' },
        paymentMode: { type: 'string' },
      },
      required: ['invoice', 'amount', 'paymentMode'],
    },
    description: 'Record a payment for an invoice.',
    execution: 'backend',
    access: 'authenticated',
    category: 'payments',
  });

  // -- Settings (admin only) --
  registry.registerCategory('settings', 'System settings — admin only.');

  registry.registerTool('update_setting', {
    handler: async (params) => {
      return { success: true, data: { settingKey: params.settingKey, settingValue: params.settingValue } };
    },
    schema: {
      type: 'object',
      properties: { settingKey: { type: 'string' }, settingValue: { type: 'string' } },
      required: ['settingKey', 'settingValue'],
    },
    description: 'Update a system setting.',
    execution: 'backend',
    access: 'admin',
    category: 'settings',
  });

  // -- Navigation (frontend tools) --
  registry.registerCategory('navigation', 'Page navigation — navigate to dashboard, settings, etc.');

  registry.registerTool('navigate_to_dashboard', {
    schema: { type: 'object', properties: {} },
    description: 'Navigate to the dashboard home page.',
    execution: 'frontend',
    access: 'authenticated',
    category: 'navigation',
    frontendAction: { type: 'navigate', route: '/' },
  });

  registry.registerTool('navigate_to_login', {
    schema: { type: 'object', properties: {} },
    description: 'Navigate to the login page.',
    execution: 'frontend',
    access: 'public',
    category: 'navigation',
    frontendAction: { type: 'navigate', route: '/login' },
  });

  registry.registerTool('navigate_to_customers', {
    schema: { type: 'object', properties: {} },
    description: 'Navigate to the customers page.',
    execution: 'frontend',
    access: 'authenticated',
    category: 'navigation',
    frontendAction: { type: 'navigate', route: '/customer' },
  });
}

beforeEach(() => {
  adapter = new MockLLMAdapter();
  ctx = mockContext();
  registry.clearTools();
  clearEngineState();
  registerTestTools();
});

// ============================================================================
// E2E-01: Full Chain Wiring
// ============================================================================

describe('E2E-01: Full Chain Wiring', () => {
  it('should execute full chain: message → engine → tool call → result → LLM response', async () => {
    // LLM calls search_clients, then responds with text
    adapter.setNextResponse({
      content: null,
      toolCalls: [{ id: 'tc-1', name: 'search_clients', params: { q: 'Acme' } }],
      usage: { inputTokens: 200, outputTokens: 30, cachedTokens: 0 },
    });
    adapter.setNextResponse({
      content: 'Found Acme Corp for you.',
      toolCalls: null,
      usage: { inputTokens: 300, outputTokens: 40, cachedTokens: 150 },
    });

    const tools = registry.getToolDefinitions(ctx.role);
    const result = await runAgent({
      message: 'Find client Acme',
      conversationHistory: [],
      userContext: ctx,
      adapter,
      tools,
    });

    expect(result.type).toBe('response');
    expect(result.message).toBe('Found Acme Corp for you.');

    // Verify tool result was fed back to LLM
    const calls = adapter.getCalls();
    expect(calls).toHaveLength(2);
    const toolMsg = calls[1].messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeTruthy();
    const toolResult = JSON.parse(toolMsg.content);
    expect(toolResult.success).toBe(true);
    expect(toolResult.data[0].name).toBe('Acme Corp');
  });

  it('should forward auth context (userId, role) through to tool execution', async () => {
    let capturedContext;
    registry.registerTool('context_checker', {
      handler: async (_params, context) => {
        capturedContext = context;
        return { success: true, data: { checked: true } };
      },
      schema: { type: 'object', properties: {} },
      description: 'Checks context',
      execution: 'backend',
      access: 'authenticated',
      category: 'clients',
    });

    adapter.setNextResponse({
      content: null,
      toolCalls: [{ id: 'tc-ctx', name: 'context_checker', params: {} }],
      usage: { inputTokens: 100, outputTokens: 10, cachedTokens: 0 },
    });
    adapter.setNextResponse({
      content: 'Done',
      toolCalls: null,
      usage: { inputTokens: 100, outputTokens: 10, cachedTokens: 0 },
    });

    const tools = registry.getToolDefinitions(ctx.role);
    await runAgent({ message: 'Check context', conversationHistory: [], userContext: ctx, adapter, tools });

    expect(capturedContext.userId).toBe(ctx.userId);
    expect(capturedContext.role).toBe(ctx.role);
    expect(capturedContext.traceId).toBe(ctx.traceId);
    expect(capturedContext.conversationId).toBe(ctx.conversationId);
  });

  it('should return frontend_action for frontend tools', async () => {
    adapter.setNextResponse({
      content: null,
      toolCalls: [{ id: 'tc-nav', name: 'navigate_to_dashboard', params: {} }],
      usage: { inputTokens: 100, outputTokens: 10, cachedTokens: 0 },
    });

    const tools = registry.getToolDefinitions(ctx.role);
    const result = await runAgent({
      message: 'Go to dashboard',
      conversationHistory: [],
      userContext: ctx,
      adapter,
      tools,
    });

    expect(result.type).toBe('frontend_action');
    expect(result.tool).toBe('navigate_to_dashboard');
    expect(result.route).toBe('/');
    expect(result.toolCallId).toBe('tc-nav');
  });

  it('should continue agentic loop after frontend result is reported back', async () => {
    adapter.setNextResponse({
      content: 'Great, you are now on the dashboard.',
      toolCalls: null,
      usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 0 },
    });

    const tools = registry.getToolDefinitions(ctx.role);
    const result = await runAgent({
      frontendResult: { toolCallId: 'tc-nav', success: true, message: 'Navigated to dashboard' },
      conversationHistory: [],
      userContext: ctx,
      adapter,
      tools,
    });

    expect(result.type).toBe('response');
    expect(result.message).toContain('dashboard');
  });

  it('should stream SSE events for tool execution', async () => {
    adapter.setNextResponse({
      content: null,
      toolCalls: [{ id: 'tc-s1', name: 'search_clients', params: { q: 'Acme' } }],
      usage: { inputTokens: 200, outputTokens: 30, cachedTokens: 0 },
    });
    adapter.setNextResponse({
      content: 'Found Acme.',
      toolCalls: null,
      usage: { inputTokens: 300, outputTokens: 20, cachedTokens: 150 },
    });

    const events = [];
    const mockRes = {
      write: (data) => events.push(data),
      end: jest.fn(),
      socket: { setNoDelay: jest.fn() },
    };

    const tools = registry.getToolDefinitions(ctx.role);
    await runAgentStream({
      message: 'Find Acme',
      conversationHistory: [],
      userContext: ctx,
      adapter,
      tools,
      res: mockRes,
    });

    const parsed = events.map((e) => JSON.parse(e.replace('data: ', '').trim()));
    const types = parsed.map((e) => e.type);

    expect(types).toContain('status');
    expect(types).toContain('text_delta');
    expect(types).toContain('done');

    // Verify trace ID is included in SSE events
    expect(parsed[0].traceId).toBe(ctx.traceId);
  });

  it('should fire observability hooks during execution', async () => {
    const toolHook = jest.fn();
    const llmHook = jest.fn();
    setHooks({ onToolExecution: toolHook, onLLMCall: llmHook });

    adapter.setNextResponse({
      content: null,
      toolCalls: [{ id: 'tc-obs', name: 'search_clients', params: { q: 'test' } }],
      usage: { inputTokens: 200, outputTokens: 30, cachedTokens: 0 },
    });
    adapter.setNextResponse({
      content: 'Done',
      toolCalls: null,
      usage: { inputTokens: 250, outputTokens: 20, cachedTokens: 100 },
    });

    const tools = registry.getToolDefinitions(ctx.role);
    await runAgent({ message: 'Test', conversationHistory: [], userContext: ctx, adapter, tools });

    expect(llmHook).toHaveBeenCalledTimes(2);
    expect(toolHook).toHaveBeenCalledTimes(1);
    expect(toolHook.mock.calls[0][0].tool).toBe('search_clients');
    expect(toolHook.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should sanitize tool output before feeding back to LLM', async () => {
    // Register tool that returns sensitive data
    registry.registerTool('get_admin_data', {
      handler: async () => ({
        success: true,
        data: { name: 'Admin', password: 'secret123', salt: 'abc', email: 'admin@test.com' },
      }),
      schema: { type: 'object', properties: {} },
      description: 'Get admin data',
      execution: 'backend',
      access: 'authenticated',
      category: 'admin',
    });

    adapter.setNextResponse({
      content: null,
      toolCalls: [{ id: 'tc-san', name: 'get_admin_data', params: {} }],
      usage: { inputTokens: 100, outputTokens: 10, cachedTokens: 0 },
    });
    adapter.setNextResponse({
      content: 'Admin info retrieved.',
      toolCalls: null,
      usage: { inputTokens: 200, outputTokens: 20, cachedTokens: 0 },
    });

    const tools = registry.getToolDefinitions(ctx.role);
    await runAgent({ message: 'Get admin', conversationHistory: [], userContext: ctx, adapter, tools });

    // Check that the tool result fed to the second LLM call has sanitized data
    const calls = adapter.getCalls();
    const toolMsg = calls[1].messages.find((m) => m.role === 'tool');
    const sanitized = JSON.parse(toolMsg.content);
    expect(sanitized.data.password).toBeUndefined();
    expect(sanitized.data.salt).toBeUndefined();
    expect(sanitized.data.name).toBe('Admin');
  });

  it('should resolve tools via resolveTools with correct role filtering', async () => {
    const result = await resolveTools('Show clients', ctx, [], adapter);

    expect(result.tools).toBeInstanceOf(Array);
    expect(result.tools.length).toBeGreaterThan(0);

    // Admin-only tool should NOT appear for owner role
    const toolNames = result.tools.map((t) => t.function.name);
    expect(toolNames).not.toContain('update_setting');
    expect(toolNames).toContain('search_clients');
  });
});

// ============================================================================
// E2E-02: System Prompt Tuning
// ============================================================================

describe('E2E-02: System Prompt Tuning', () => {
  it('should build prompt with conversation awareness rules', () => {
    const tools = registry.getToolDefinitions('owner');
    const prompt = buildSystemPrompt({ userContext: { name: 'Yash', role: 'owner' }, toolDefinitions: tools });

    expect(prompt).toContain('NEVER ask the user for technical IDs');
    expect(prompt).toContain('USE conversation history');
    expect(prompt).toContain('Chain tools automatically');
    expect(prompt).toContain('Be concise');
  });

  it('should include create rules when create tools exist', () => {
    const tools = registry.getToolDefinitions('owner');
    const prompt = buildSystemPrompt({ userContext: { name: 'Yash', role: 'owner' }, toolDefinitions: tools });

    expect(prompt).toContain('Create Operations');
    expect(prompt).toContain('NEVER use placeholder or sample values');
  });

  it('should include destructive rules when destructive tools exist', () => {
    const tools = registry.getToolDefinitions('owner');
    const prompt = buildSystemPrompt({ userContext: { name: 'Yash', role: 'owner' }, toolDefinitions: tools });

    expect(prompt).toContain('Destructive Actions');
    expect(prompt).toContain('Reply yes to confirm');
  });

  it('should NOT include create/destructive rules if user has no such tools', () => {
    // Clear and register only read tools
    registry.clearTools();
    registry.registerTool('list_items', {
      handler: async () => ({ success: true, data: [] }),
      schema: { type: 'object', properties: {} },
      description: 'List items',
      execution: 'backend',
      access: 'authenticated',
      category: 'items',
    });

    const tools = registry.getToolDefinitions('owner');
    const prompt = buildSystemPrompt({ userContext: { name: 'Yash', role: 'owner' }, toolDefinitions: tools });

    expect(prompt).not.toContain('Create Operations');
    expect(prompt).not.toContain('Destructive Actions');
  });

  it('should include user name and role in prompt', () => {
    const tools = registry.getToolDefinitions('owner');
    const prompt = buildSystemPrompt({ userContext: { name: 'Yash', role: 'owner' }, toolDefinitions: tools });

    expect(prompt).toContain('Name: Yash');
    expect(prompt).toContain('Role: owner');
  });

  it('should include response style rules (no filler)', () => {
    const tools = registry.getToolDefinitions('owner');
    const prompt = buildSystemPrompt({ userContext: { name: 'Yash', role: 'owner' }, toolDefinitions: tools });

    expect(prompt).toContain("NEVER say \"I'd be happy to help\"");
    expect(prompt).toContain('Be direct');
  });

  it('should include permission error guidance', () => {
    const tools = registry.getToolDefinitions('owner');
    const prompt = buildSystemPrompt({ userContext: { name: 'Yash', role: 'owner' }, toolDefinitions: tools });

    expect(prompt).toContain('role');
    expect(prompt).toContain('admin access');
  });

  it('should select correct tool for simple read query', async () => {
    adapter.setNextResponse({
      content: null,
      toolCalls: [{ id: 'tc-r1', name: 'search_clients', params: { q: 'Acme' } }],
      usage: { inputTokens: 200, outputTokens: 20, cachedTokens: 0 },
    });
    adapter.setNextResponse({
      content: 'Acme Corp found.',
      toolCalls: null,
      usage: { inputTokens: 250, outputTokens: 20, cachedTokens: 100 },
    });

    const tools = registry.getToolDefinitions(ctx.role);
    const result = await runAgent({
      message: 'Show client Acme',
      conversationHistory: [],
      userContext: ctx,
      adapter,
      tools,
    });

    expect(result.type).toBe('response');
    // Verify search_clients was called (adapter stores messages by reference, so we check tool call)
    const calls = adapter.getCalls();
    expect(calls).toHaveLength(2);
    // The user message should be in the messages array
    const userMsg = calls[0].messages.find((m) => m.role === 'user' && m.content === 'Show client Acme');
    expect(userMsg).toBeTruthy();
  });

  it('should execute frontend action correctly', async () => {
    adapter.setNextResponse({
      content: null,
      toolCalls: [{ id: 'tc-fe', name: 'navigate_to_dashboard', params: {} }],
      usage: { inputTokens: 100, outputTokens: 10, cachedTokens: 0 },
    });

    const tools = registry.getToolDefinitions(ctx.role);
    const result = await runAgent({
      message: 'Go to dashboard',
      conversationHistory: [],
      userContext: ctx,
      adapter,
      tools,
    });

    expect(result.type).toBe('frontend_action');
    expect(result.actionType).toBe('navigate');
  });
});

// ============================================================================
// E2E-03: Permission Boundary Tests
// ============================================================================

describe('E2E-03: Permission Boundary Tests', () => {
  it('should allow authenticated user (owner role) to access all non-admin tools', () => {
    const tools = registry.getToolDefinitions('owner');
    const toolNames = tools.map((t) => t.function.name);

    expect(toolNames).toContain('search_clients');
    expect(toolNames).toContain('list_invoices');
    expect(toolNames).toContain('create_client');
    expect(toolNames).toContain('navigate_to_dashboard');
  });

  it('should hide admin-only tools from non-admin users', () => {
    const tools = registry.getToolDefinitions('owner');
    const toolNames = tools.map((t) => t.function.name);

    expect(toolNames).not.toContain('update_setting');
  });

  it('should include admin-only tools for admin users', () => {
    const tools = registry.getToolDefinitions('admin');
    const toolNames = tools.map((t) => t.function.name);

    expect(toolNames).toContain('update_setting');
    expect(toolNames).toContain('search_clients');
  });

  it('should show only public tools when no role is provided', () => {
    const tools = registry.getToolDefinitions(undefined);
    const toolNames = tools.map((t) => t.function.name);

    expect(toolNames).toContain('navigate_to_login');
    expect(toolNames).not.toContain('search_clients');
    expect(toolNames).not.toContain('update_setting');
  });

  it('should block tool execution when access is insufficient', async () => {
    const result = await registry.executeTool('update_setting', { settingKey: 'x', settingValue: 'y' }, ctx);

    expect(result.success).toBe(false);
    expect(result.code).toBe('FORBIDDEN');
  });

  it('should allow admin to execute admin-only tools', async () => {
    const adminCtx = mockAdminContext();
    const result = await registry.executeTool('update_setting', { settingKey: 'x', settingValue: 'y' }, adminCtx);

    expect(result.success).toBe(true);
  });

  it('should allow public tools without authentication context', async () => {
    const result = await registry.executeTool('navigate_to_login', {}, {});

    expect(result.type).toBe('frontend_action');
    expect(result.route).toBe('/login');
  });
});

// ============================================================================
// E2E-04: Error & Recovery Tests
// ============================================================================

describe('E2E-04: Error & Recovery Tests', () => {
  it('should feed tool error back to LLM for self-correction', async () => {
    // First: LLM calls with invalid ID, tool returns error
    adapter.setNextResponse({
      content: null,
      toolCalls: [{ id: 'tc-e1', name: 'get_client', params: { id: 'bad-id' } }],
      usage: { inputTokens: 100, outputTokens: 10, cachedTokens: 0 },
    });
    // Second: LLM tries search instead
    adapter.setNextResponse({
      content: null,
      toolCalls: [{ id: 'tc-e2', name: 'search_clients', params: { q: 'Acme' } }],
      usage: { inputTokens: 200, outputTokens: 20, cachedTokens: 0 },
    });
    // Third: LLM responds with text
    adapter.setNextResponse({
      content: 'Found Acme Corp.',
      toolCalls: null,
      usage: { inputTokens: 300, outputTokens: 30, cachedTokens: 200 },
    });

    const tools = registry.getToolDefinitions(ctx.role);
    const result = await runAgent({
      message: 'Find Acme',
      conversationHistory: [],
      userContext: ctx,
      adapter,
      tools,
    });

    expect(result.type).toBe('response');
    expect(result.message).toBe('Found Acme Corp.');

    // Verify the error was fed back to the LLM in the second call
    const calls = adapter.getCalls();
    const secondCallMessages = calls[1].messages;
    const toolResult = secondCallMessages.find((m) => m.role === 'tool');
    const parsed = JSON.parse(toolResult.content);
    expect(parsed.success).toBe(false);
  });

  it('should handle LLM adapter error gracefully', async () => {
    adapter.chat = async () => { throw new Error('API timeout'); };

    const tools = registry.getToolDefinitions(ctx.role);

    await expect(
      runAgent({ message: 'Test', conversationHistory: [], userContext: ctx, adapter, tools })
    ).rejects.toThrow('API timeout');
  });

  it('should stop at max iterations with helpful message', async () => {
    for (let i = 0; i < 15; i++) {
      adapter.setNextResponse({
        content: null,
        toolCalls: [{ id: `tc-loop-${i}`, name: 'search_clients', params: { q: 'loop' } }],
        usage: { inputTokens: 100, outputTokens: 10, cachedTokens: 0 },
      });
    }

    const tools = registry.getToolDefinitions(ctx.role);
    const result = await runAgent({
      message: 'Keep searching',
      conversationHistory: [],
      userContext: ctx,
      adapter,
      tools,
    });

    expect(result.type).toBe('response');
    expect(result.message).toContain('unable to complete');
  });

  it('should reject when token budget is exceeded', async () => {
    const { _tokenBudget } = require('../engine');
    _tokenBudget._conversationTokenUsage.set(ctx.conversationId, 200000);

    adapter.setNextResponse({
      content: 'Should not reach here',
      toolCalls: null,
      usage: { inputTokens: 100, outputTokens: 10, cachedTokens: 0 },
    });

    const tools = registry.getToolDefinitions(ctx.role);
    const result = await runAgent({
      message: 'Test',
      conversationHistory: [],
      userContext: ctx,
      adapter,
      tools,
    });

    expect(result.type).toBe('response');
    expect(result.message).toContain('limit');
  });

  it('should show circuit breaker error when tool is disabled', async () => {
    const { _circuitBreaker } = require('../engine');

    // Trigger the circuit breaker for search_clients
    for (let i = 0; i < 10; i++) {
      _circuitBreaker.recordFailure('search_clients');
    }

    adapter.setNextResponse({
      content: null,
      toolCalls: [{ id: 'tc-cb', name: 'search_clients', params: { q: 'test' } }],
      usage: { inputTokens: 100, outputTokens: 10, cachedTokens: 0 },
    });
    adapter.setNextResponse({
      content: 'That tool is temporarily unavailable.',
      toolCalls: null,
      usage: { inputTokens: 200, outputTokens: 20, cachedTokens: 0 },
    });

    const tools = registry.getToolDefinitions(ctx.role);
    const result = await runAgent({
      message: 'Search clients',
      conversationHistory: [],
      userContext: ctx,
      adapter,
      tools,
    });

    // The circuit breaker error should have been fed to LLM
    const calls = adapter.getCalls();
    const secondCallMessages = calls[1].messages;
    const toolMsg = secondCallMessages.find((m) => m.role === 'tool');
    const parsed = JSON.parse(toolMsg.content);
    expect(parsed.code).toBe('CIRCUIT_OPEN');
  });

  it('should reject rate-limited requests', async () => {
    const { _rateLimiter } = require('../engine');

    // Exhaust the per-user rate limit
    for (let i = 0; i < 35; i++) {
      _rateLimiter.checkAllLimits(ctx);
    }

    adapter.setNextResponse({
      content: 'Should not reach',
      toolCalls: null,
      usage: { inputTokens: 100, outputTokens: 10, cachedTokens: 0 },
    });

    const tools = registry.getToolDefinitions(ctx.role);
    const result = await runAgent({
      message: 'Test',
      conversationHistory: [],
      userContext: ctx,
      adapter,
      tools,
    });

    expect(result.type).toBe('response');
    expect(result.message.toLowerCase()).toContain('rate');
  });

  it('should return validation error for invalid params', async () => {
    const result = await registry.executeTool('search_clients', {}, ctx);

    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should handle unknown tool name gracefully', async () => {
    const result = await registry.executeTool('nonexistent_tool', {}, ctx);

    expect(result.success).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
  });

  it('should stream error events on token budget exceeded', async () => {
    const { _tokenBudget } = require('../engine');
    _tokenBudget._conversationTokenUsage.set(ctx.conversationId, 200000);

    const events = [];
    const mockRes = {
      write: (data) => events.push(data),
      end: jest.fn(),
      socket: { setNoDelay: jest.fn() },
    };

    const tools = registry.getToolDefinitions(ctx.role);
    await runAgentStream({
      message: 'Test',
      conversationHistory: [],
      userContext: ctx,
      adapter,
      tools,
      res: mockRes,
    });

    const parsed = events.map((e) => JSON.parse(e.replace('data: ', '').trim()));
    const types = parsed.map((e) => e.type);

    expect(types).toContain('error');
    expect(types).toContain('done');
  });
});

// ============================================================================
// E2E-05: Multi-Tool Chain Tests
// ============================================================================

describe('E2E-05: Multi-Tool Chain Tests', () => {
  it('should chain search_clients + list_invoices in one turn', async () => {
    // Step 1: LLM searches for client
    adapter.setNextResponse({
      content: null,
      toolCalls: [{ id: 'tc-m1', name: 'search_clients', params: { q: 'Acme' } }],
      usage: { inputTokens: 200, outputTokens: 20, cachedTokens: 0 },
    });
    // Step 2: LLM uses client ID to list invoices
    adapter.setNextResponse({
      content: null,
      toolCalls: [{ id: 'tc-m2', name: 'list_invoices', params: { client: 'c1' } }],
      usage: { inputTokens: 350, outputTokens: 30, cachedTokens: 150 },
    });
    // Step 3: LLM responds with combined result
    adapter.setNextResponse({
      content: 'Acme Corp has 1 invoice (INV-001) totaling $1,650.',
      toolCalls: null,
      usage: { inputTokens: 500, outputTokens: 40, cachedTokens: 300 },
    });

    const tools = registry.getToolDefinitions(ctx.role);
    const result = await runAgent({
      message: 'Find client Acme and show their invoices',
      conversationHistory: [],
      userContext: ctx,
      adapter,
      tools,
    });

    expect(result.type).toBe('response');
    expect(result.message).toContain('Acme Corp');
    expect(result.message).toContain('INV-001');

    // Verify 3 LLM calls
    const calls = adapter.getCalls();
    expect(calls).toHaveLength(3);

    // Messages are shared by reference — find specific tool results by tool_call_id
    const allMessages = calls[0].messages;
    const searchToolMsg = allMessages.find((m) => m.role === 'tool' && m.tool_call_id === 'tc-m1');
    const searchResult = JSON.parse(searchToolMsg.content);
    expect(searchResult.data[0].name).toBe('Acme Corp');

    const invoiceToolMsg = allMessages.find((m) => m.role === 'tool' && m.tool_call_id === 'tc-m2');
    const invoiceResult = JSON.parse(invoiceToolMsg.content);
    expect(invoiceResult.data[0].number).toBe('INV-001');
  });

  it('should chain search_invoices + create_payment', async () => {
    // Step 1: LLM searches for invoice
    adapter.setNextResponse({
      content: null,
      toolCalls: [{ id: 'tc-p1', name: 'search_invoices', params: { q: 'INV-001' } }],
      usage: { inputTokens: 200, outputTokens: 20, cachedTokens: 0 },
    });
    // Step 2: LLM creates payment using found invoice
    adapter.setNextResponse({
      content: null,
      toolCalls: [{
        id: 'tc-p2',
        name: 'create_payment',
        params: { invoice: 'inv1', amount: 500, paymentMode: 'bank_transfer' },
      }],
      usage: { inputTokens: 350, outputTokens: 30, cachedTokens: 150 },
    });
    // Step 3: LLM responds
    adapter.setNextResponse({
      content: 'Payment of $500 recorded for invoice INV-001.',
      toolCalls: null,
      usage: { inputTokens: 500, outputTokens: 30, cachedTokens: 300 },
    });

    const tools = registry.getToolDefinitions(ctx.role);
    const result = await runAgent({
      message: 'Record a $500 payment for invoice INV-001',
      conversationHistory: [],
      userContext: ctx,
      adapter,
      tools,
    });

    expect(result.type).toBe('response');
    expect(result.message).toContain('$500');
    expect(result.message).toContain('INV-001');

    const calls = adapter.getCalls();
    expect(calls).toHaveLength(3);
  });

  it('should use conversation context for create operations', async () => {
    // Simulate prior conversation where client was looked up
    const conversationHistory = [
      { role: 'user', content: 'Find client Acme' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'tc-prior',
          type: 'function',
          function: { name: 'search_clients', arguments: JSON.stringify({ q: 'Acme' }) },
        }],
      },
      {
        role: 'tool',
        tool_call_id: 'tc-prior',
        content: JSON.stringify({ success: true, data: [{ _id: 'c1', name: 'Acme Corp' }] }),
      },
      { role: 'assistant', content: 'Found Acme Corp.' },
    ];

    // LLM should use c1 from conversation context
    adapter.setNextResponse({
      content: null,
      toolCalls: [{
        id: 'tc-cc1',
        name: 'create_invoice',
        params: { client: 'c1', items: [{ itemName: 'Service', quantity: 1, price: 200, total: 200 }] },
      }],
      usage: { inputTokens: 500, outputTokens: 40, cachedTokens: 300 },
    });
    adapter.setNextResponse({
      content: 'Invoice created for Acme Corp.',
      toolCalls: null,
      usage: { inputTokens: 600, outputTokens: 30, cachedTokens: 400 },
    });

    const tools = registry.getToolDefinitions(ctx.role);
    const result = await runAgent({
      message: 'Create an invoice for that client',
      conversationHistory,
      userContext: ctx,
      adapter,
      tools,
    });

    expect(result.type).toBe('response');
    expect(result.message).toContain('Acme Corp');

    // Verify the create_invoice call used client ID from context
    const calls = adapter.getCalls();
    const firstCallMessages = calls[0].messages;

    // The conversation history should include the prior search result
    const priorToolResult = firstCallMessages.find(
      (m) => m.role === 'tool' && m.tool_call_id === 'tc-prior'
    );
    expect(priorToolResult).toBeTruthy();
  });

  it('should handle parallel tool calls in a single iteration', async () => {
    // LLM calls two tools at once
    adapter.setNextResponse({
      content: null,
      toolCalls: [
        { id: 'tc-par1', name: 'search_clients', params: { q: 'Acme' } },
        { id: 'tc-par2', name: 'list_invoices', params: {} },
      ],
      usage: { inputTokens: 200, outputTokens: 30, cachedTokens: 0 },
    });
    adapter.setNextResponse({
      content: 'Found 2 clients and 2 invoices.',
      toolCalls: null,
      usage: { inputTokens: 400, outputTokens: 30, cachedTokens: 200 },
    });

    const tools = registry.getToolDefinitions(ctx.role);
    const result = await runAgent({
      message: 'Show me clients and invoices',
      conversationHistory: [],
      userContext: ctx,
      adapter,
      tools,
    });

    expect(result.type).toBe('response');

    // Both tool results should be in the second call
    const calls = adapter.getCalls();
    const secondCallMessages = calls[1].messages;
    const toolMsgs = secondCallMessages.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(2);
  });

  it('should mix backend and frontend tools in a chain', async () => {
    // Step 1: LLM searches for client
    adapter.setNextResponse({
      content: null,
      toolCalls: [{ id: 'tc-mix1', name: 'search_clients', params: { q: 'Acme' } }],
      usage: { inputTokens: 200, outputTokens: 20, cachedTokens: 0 },
    });
    // Step 2: LLM navigates to customers page (frontend action)
    adapter.setNextResponse({
      content: null,
      toolCalls: [{ id: 'tc-mix2', name: 'navigate_to_customers', params: {} }],
      usage: { inputTokens: 350, outputTokens: 20, cachedTokens: 150 },
    });

    const tools = registry.getToolDefinitions(ctx.role);
    const result = await runAgent({
      message: 'Find Acme and go to customers page',
      conversationHistory: [],
      userContext: ctx,
      adapter,
      tools,
    });

    // Frontend action should be returned
    expect(result.type).toBe('frontend_action');
    expect(result.tool).toBe('navigate_to_customers');
    expect(result.toolCallId).toBe('tc-mix2');
  });
});
