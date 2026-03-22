/**
 * Tests for agent/llm/prompt-builder.js
 */

const { buildSystemPrompt } = require('../../llm/prompt-builder');

describe('buildSystemPrompt', () => {
  const baseOptions = {
    userContext: { name: 'Test User', role: 'user' },
    toolDefinitions: [],
  };

  it('should include app name and description', () => {
    const prompt = buildSystemPrompt(baseOptions);
    expect(prompt).toContain('IDURAR ERP/CRM');
  });

  it('should accept custom app name and description', () => {
    const prompt = buildSystemPrompt({
      ...baseOptions,
      appName: 'My App',
      appDescription: 'A test app.',
    });
    expect(prompt).toContain('My App');
    expect(prompt).toContain('A test app.');
  });

  it('should include conversation awareness rules', () => {
    const prompt = buildSystemPrompt(baseOptions);
    expect(prompt).toContain('NEVER ask the user for technical IDs');
    expect(prompt).toContain('USE conversation history');
    expect(prompt).toContain('Chain tools automatically');
    expect(prompt).toContain('Do NOT call the same tool twice');
  });

  it('should include response style rules', () => {
    const prompt = buildSystemPrompt(baseOptions);
    expect(prompt).toContain('Be concise');
    expect(prompt).toContain('NEVER say "I\'d be happy to help"');
    expect(prompt).toContain('NEVER mention tool names');
  });

  it('should include tool usage rules', () => {
    const prompt = buildSystemPrompt(baseOptions);
    expect(prompt).toContain('ALWAYS use tools to get data');
    expect(prompt).toContain('NEVER make up information');
  });

  it('should include user context', () => {
    const prompt = buildSystemPrompt(baseOptions);
    expect(prompt).toContain('Name: Test User');
    expect(prompt).toContain('Role: user');
  });

  it('should NOT include create rules when no create tools exist', () => {
    const prompt = buildSystemPrompt({
      userContext: { name: 'User', role: 'user' },
      toolDefinitions: [{ name: 'get_product', description: 'Get a product' }],
    });
    expect(prompt).not.toContain('Create Operations');
  });

  it('should include create rules when create tools exist', () => {
    const prompt = buildSystemPrompt({
      userContext: { name: 'Admin', role: 'admin' },
      toolDefinitions: [{ name: 'create_product', description: 'Create a product' }],
    });
    expect(prompt).toContain('Create Operations');
    expect(prompt).toContain('NEVER use placeholder or sample values');
  });

  it('should NOT include destructive rules when no destructive tools exist', () => {
    const prompt = buildSystemPrompt({
      userContext: { name: 'User', role: 'user' },
      toolDefinitions: [{ name: 'get_product', description: 'Get a product' }],
    });
    expect(prompt).not.toContain('Destructive Actions');
  });

  it('should include destructive rules when destructive tools exist', () => {
    const prompt = buildSystemPrompt({
      userContext: { name: 'Admin', role: 'admin' },
      toolDefinitions: [
        { name: 'delete_product', description: 'Delete a product. ⚠️ DESTRUCTIVE' },
      ],
    });
    expect(prompt).toContain('Destructive Actions');
    expect(prompt).toContain('Reply yes to confirm');
  });

  it('should include both create and destructive rules when both types present', () => {
    const prompt = buildSystemPrompt({
      userContext: { name: 'Admin', role: 'admin' },
      toolDefinitions: [
        { name: 'create_product', description: 'Create a product' },
        { name: 'delete_product', description: 'Delete. ⚠️ DESTRUCTIVE' },
      ],
    });
    expect(prompt).toContain('Create Operations');
    expect(prompt).toContain('Destructive Actions');
  });

  it('should place user context at the end (dynamic content last for caching)', () => {
    const prompt = buildSystemPrompt(baseOptions);
    const userContextIndex = prompt.indexOf('## Current User');
    const toolUsageIndex = prompt.indexOf('## Tool Usage');
    expect(userContextIndex).toBeGreaterThan(toolUsageIndex);
  });

  it('should place static conversation rules before dynamic content', () => {
    const prompt = buildSystemPrompt(baseOptions);
    const awarenessIndex = prompt.indexOf('## Conversation Awareness');
    const userIndex = prompt.indexOf('## Current User');
    expect(awarenessIndex).toBeLessThan(userIndex);
  });
});
