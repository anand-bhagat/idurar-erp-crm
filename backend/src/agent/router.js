/**
 * Tool Router — Two-Stage Routing
 *
 * A lightweight LLM call classifies the user's intent into tool categories.
 * Only the relevant 10-20 tools are then sent to the main LLM.
 *
 * This reduces token cost, improves accuracy, and maximizes prompt cache hits.
 */

const registry = require('./registry');
const config = require('./config');

// ---------------------------------------------------------------------------
// Conversation Tool Cache
// ---------------------------------------------------------------------------

/**
 * Per-conversation cache of routed tool sets.
 * Key: conversationId
 * Value: { categories, tools, messageCount }
 */
const conversationToolCache = new Map();

/**
 * Clear a specific conversation's cached tools.
 */
function invalidateCache(conversationId) {
  conversationToolCache.delete(conversationId);
}

/**
 * Clear all cached tool sets (for testing).
 */
function clearCache() {
  conversationToolCache.clear();
}

/**
 * Get cache stats (for testing/observability).
 */
function getCacheStats() {
  return {
    size: conversationToolCache.size,
    entries: Array.from(conversationToolCache.entries()).map(([id, entry]) => ({
      conversationId: id,
      categories: entry.categories,
      messageCount: entry.messageCount,
    })),
  };
}

// ---------------------------------------------------------------------------
// Router Implementation
// ---------------------------------------------------------------------------

/**
 * Build the router system prompt from category descriptions.
 */
function buildRouterPrompt() {
  const descriptions = registry.getCategoryDescriptions();
  const categoryList = Object.entries(descriptions)
    .map(([name, desc]) => `- ${name}: ${desc}`)
    .join('\n');

  return `You route user messages to tool categories.
Given the message and conversation context, return a JSON array of 1-4 category names needed to handle this request. Include categories for any entities mentioned.
Reply with ONLY the JSON array, nothing else.

Categories:
${categoryList}`;
}

/**
 * Parse the router LLM response into an array of category names.
 * Returns null if parsing fails.
 */
function parseRouterResponse(content) {
  if (!content || typeof content !== 'string') return null;

  try {
    // Try direct JSON parse first
    const parsed = JSON.parse(content.trim());
    if (Array.isArray(parsed) && parsed.every((c) => typeof c === 'string')) {
      return parsed;
    }
    return null;
  } catch {
    // Try extracting JSON array from response text
    const match = content.match(/\[[\s\S]*?\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.every((c) => typeof c === 'string')) {
          return parsed;
        }
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Validate that returned categories actually exist in the registry.
 */
function validateCategories(categories) {
  const known = new Set(Object.keys(registry.getCategoryDescriptions()));
  return categories.filter((c) => known.has(c));
}

/**
 * Route tools for a user message using a fast LLM call.
 *
 * @param {string} message - User message
 * @param {Array} history - Recent conversation history (last 2-3 messages)
 * @param {string} userRole - User's role
 * @param {object} adapter - LLM adapter instance
 * @returns {object} { categories, tools } — selected categories and tool definitions
 */
async function routeTools(message, history, userRole, adapter) {
  const descriptions = registry.getCategoryDescriptions();
  const categoryNames = Object.keys(descriptions);

  // If no categories registered, fall back to all tools
  if (categoryNames.length === 0) {
    return {
      categories: [],
      tools: registry.getToolDefinitions(userRole),
      fallback: true,
    };
  }

  try {
    const systemPrompt = buildRouterPrompt();

    // Build messages: system + last 3 history messages + current message
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-3),
      { role: 'user', content: message },
    ];

    const response = await adapter.chat(messages, [], {});

    const parsed = parseRouterResponse(response.content);
    if (!parsed || parsed.length === 0) {
      // Fallback: return all role-permitted tools
      return {
        categories: categoryNames,
        tools: registry.getToolDefinitions(userRole),
        fallback: true,
      };
    }

    // Validate categories exist
    const validCategories = validateCategories(parsed);
    if (validCategories.length === 0) {
      return {
        categories: categoryNames,
        tools: registry.getToolDefinitions(userRole),
        fallback: true,
      };
    }

    // Merge with core categories (always included)
    const coreCategories = config.routing.coreCategories || ['navigation'];
    const allCategories = [...new Set([...validCategories, ...coreCategories])];

    const tools = registry.getToolsByCategories(allCategories, userRole);

    return {
      categories: allCategories,
      tools,
      fallback: false,
    };
  } catch {
    // On any error, fall back to all role-permitted tools
    return {
      categories: categoryNames,
      tools: registry.getToolDefinitions(userRole),
      fallback: true,
    };
  }
}

/**
 * Get tools for a message, using the conversation cache when available.
 *
 * Routes once per user message. Reuses cached tools for up to N messages
 * (configurable via config.routing.cacheMessages), then re-routes.
 *
 * @param {string} message - User message
 * @param {string} conversationId - Conversation ID for caching
 * @param {Array} history - Conversation history
 * @param {string} userRole - User's role
 * @param {object} adapter - LLM adapter instance
 * @returns {object} { categories, tools, cached, fallback }
 */
async function getToolsForMessage(message, conversationId, history, userRole, adapter) {
  // Route fresh every message — conversation intent can change at any turn.
  // The router call is lightweight (fast model, minimal tokens) so caching
  // saves negligible cost while risking stale tool selection.
  const result = await routeTools(message, history, userRole, adapter);

  // Store latest categories for observability / conversation metadata
  conversationToolCache.set(conversationId, {
    categories: result.categories,
    tools: result.tools,
    messageCount: 1,
    fallback: result.fallback,
  });

  return {
    ...result,
    cached: false,
  };
}

/**
 * Determine whether routing should be used based on total tool count.
 *
 * @param {string} userRole - User's role
 * @returns {boolean}
 */
function shouldRoute(userRole) {
  if (!config.routing.enabled) return false;
  const totalTools = registry.getToolDefinitions(userRole).length;
  return totalTools > config.routing.threshold;
}

module.exports = {
  routeTools,
  getToolsForMessage,
  shouldRoute,
  invalidateCache,
  clearCache,
  getCacheStats,
  // Exposed for testing
  buildRouterPrompt,
  parseRouterResponse,
  validateCategories,
  _conversationToolCache: conversationToolCache,
};
