/**
 * Mock context helpers for agent tests.
 */

const { randomUUID } = require('crypto');

function mockContext(overrides = {}) {
  return {
    userId: '507f1f77bcf86cd799439011',
    role: 'owner',
    name: 'Test User',
    traceId: randomUUID(),
    conversationId: 'conv-test-' + Date.now(),
    ...overrides,
  };
}

function mockAdminContext(overrides = {}) {
  return mockContext({ role: 'admin', name: 'Admin User', ...overrides });
}

function mockUnauthenticatedContext() {
  return { traceId: randomUUID() };
}

module.exports = { mockContext, mockAdminContext, mockUnauthenticatedContext };
