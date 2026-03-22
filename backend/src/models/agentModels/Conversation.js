/**
 * Conversation Memory Model
 *
 * Stores conversation history for the agent, enabling multi-turn interactions.
 * Includes message truncation to stay within model context limits.
 */

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      required: true,
      enum: ['system', 'user', 'assistant', 'tool'],
    },
    content: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    toolName: String,
    toolCallId: String,
    tool_calls: [mongoose.Schema.Types.Mixed],
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.ObjectId,
      ref: 'Admin',
      required: true,
      index: true,
    },
    messages: [messageSchema],
    totalTokensUsed: {
      type: Number,
      default: 0,
    },
    activeCategories: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Index for pruning old conversations
conversationSchema.index({ updatedAt: 1 });

// --- Static Methods ---

/**
 * Get a conversation by ID, or return null if not found.
 */
conversationSchema.statics.getConversation = async function (conversationId) {
  if (!mongoose.Types.ObjectId.isValid(conversationId)) return null;
  return this.findById(conversationId);
};

/**
 * Create a new conversation for a user.
 */
conversationSchema.statics.createConversation = async function (userId) {
  return this.create({ userId, messages: [] });
};

/**
 * Append a message to a conversation.
 */
conversationSchema.statics.appendMessage = async function (conversationId, message) {
  return this.findByIdAndUpdate(
    conversationId,
    {
      $push: { messages: { ...message, timestamp: new Date() } },
    },
    { new: true }
  );
};

/**
 * Append multiple messages to a conversation and update token count.
 */
conversationSchema.statics.appendMessages = async function (conversationId, messages, tokensUsed = 0) {
  const update = {
    $push: {
      messages: {
        $each: messages.map((m) => ({ ...m, timestamp: new Date() })),
      },
    },
  };
  if (tokensUsed > 0) {
    update.$inc = { totalTokensUsed: tokensUsed };
  }
  return this.findByIdAndUpdate(conversationId, update, { new: true });
};

/**
 * Get conversation history formatted for the LLM.
 * Applies truncation: keeps the last N messages (default 20).
 *
 * @param {string} conversationId
 * @param {number} maxMessages - Maximum number of messages to return
 * @returns {Array} Messages in LLM format
 */
conversationSchema.statics.getHistory = async function (conversationId, maxMessages = 20) {
  const conversation = await this.getConversation(conversationId);
  if (!conversation || conversation.messages.length === 0) return [];

  let messages = conversation.messages;

  // Truncation: keep only the last N messages
  if (messages.length > maxMessages) {
    messages = messages.slice(-maxMessages);
  }

  // Convert to LLM message format
  return messages.map((msg) => {
    const result = { role: msg.role, content: msg.content };
    if (msg.toolCallId) result.tool_call_id = msg.toolCallId;
    if (msg.tool_calls && msg.tool_calls.length > 0) result.tool_calls = msg.tool_calls;
    return result;
  });
};

/**
 * Update the active categories cache for a conversation (used by router).
 */
conversationSchema.statics.updateCategories = async function (conversationId, categories) {
  return this.findByIdAndUpdate(conversationId, { activeCategories: categories }, { new: true });
};

/**
 * Delete conversations older than the specified number of days.
 *
 * @param {number} days - Delete conversations not updated in this many days
 * @returns {number} Number of deleted conversations
 */
conversationSchema.statics.pruneOld = async function (days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await this.deleteMany({ updatedAt: { $lt: cutoff } });
  return result.deletedCount;
};

module.exports = mongoose.model('Conversation', conversationSchema);
