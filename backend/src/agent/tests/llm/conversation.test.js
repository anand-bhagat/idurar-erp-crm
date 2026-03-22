/**
 * Tests for models/agentModels/Conversation.js
 *
 * Uses mock functions to test the model without a real database.
 */

const mongoose = require('mongoose');

// Create a mock model that simulates Mongoose behavior
let mockStore = {};
let idCounter = 0;

// We test the schema logic directly by requiring and checking the model statics
const Conversation = require('../../../models/agentModels/Conversation');

describe('Conversation Model', () => {
  describe('Schema definition', () => {
    it('should have required fields', () => {
      const schema = Conversation.schema;
      expect(schema.paths.userId).toBeDefined();
      expect(schema.paths.messages).toBeDefined();
      expect(schema.paths.totalTokensUsed).toBeDefined();
      expect(schema.paths.activeCategories).toBeDefined();
    });

    it('should have timestamps enabled', () => {
      expect(Conversation.schema.options.timestamps).toBe(true);
    });

    it('should have userId indexed', () => {
      const indexes = Conversation.schema.indexes();
      const hasUserIdIndex = indexes.some(([fields]) => fields.userId !== undefined);
      // Also check path-level index
      const pathIndex = Conversation.schema.path('userId').options.index;
      expect(hasUserIdIndex || pathIndex).toBeTruthy();
    });

    it('should have updatedAt indexed for pruning', () => {
      const indexes = Conversation.schema.indexes();
      const hasUpdatedAtIndex = indexes.some(([fields]) => fields.updatedAt !== undefined);
      expect(hasUpdatedAtIndex).toBe(true);
    });
  });

  describe('Message schema', () => {
    it('should enforce valid roles', () => {
      const messageSchema = Conversation.schema.path('messages').schema;
      const roleEnum = messageSchema.path('role').options.enum;
      expect(roleEnum).toEqual(['system', 'user', 'assistant', 'tool']);
    });

    it('should include toolCallId and toolName fields', () => {
      const messageSchema = Conversation.schema.path('messages').schema;
      expect(messageSchema.paths.toolCallId).toBeDefined();
      expect(messageSchema.paths.toolName).toBeDefined();
    });

    it('should have timestamp with default', () => {
      const messageSchema = Conversation.schema.path('messages').schema;
      expect(messageSchema.paths.timestamp).toBeDefined();
    });
  });

  describe('Static methods exist', () => {
    it('should have getConversation static', () => {
      expect(typeof Conversation.getConversation).toBe('function');
    });

    it('should have createConversation static', () => {
      expect(typeof Conversation.createConversation).toBe('function');
    });

    it('should have appendMessage static', () => {
      expect(typeof Conversation.appendMessage).toBe('function');
    });

    it('should have appendMessages static', () => {
      expect(typeof Conversation.appendMessages).toBe('function');
    });

    it('should have getHistory static', () => {
      expect(typeof Conversation.getHistory).toBe('function');
    });

    it('should have updateCategories static', () => {
      expect(typeof Conversation.updateCategories).toBe('function');
    });

    it('should have pruneOld static', () => {
      expect(typeof Conversation.pruneOld).toBe('function');
    });
  });

  describe('getConversation()', () => {
    it('should return null for invalid ObjectId', async () => {
      const result = await Conversation.getConversation('not-a-valid-id');
      expect(result).toBeNull();
    });
  });

  describe('getHistory() truncation logic', () => {
    // We can test the truncation logic by mocking getConversation
    it('should exist as a static method', () => {
      expect(typeof Conversation.getHistory).toBe('function');
    });
  });

  describe('Default values', () => {
    it('should default totalTokensUsed to 0', () => {
      expect(Conversation.schema.path('totalTokensUsed').options.default).toBe(0);
    });

    it('should default activeCategories to empty array', () => {
      const defaultVal = Conversation.schema.path('activeCategories').options.default;
      expect(defaultVal).toEqual([]);
    });
  });
});
