/**
 * Tool Registry
 *
 * Central registry for all agent tools. Maps tool names to their handlers,
 * schemas, access levels, categories, and execution types.
 *
 * Supports both backend tools (server-side execution) and frontend tools
 * (forwarded to the widget for client-side execution).
 */

const { checkAccess } = require('./helpers/auth');
const { validateParams } = require('./helpers/validate');
const { errorResponse } = require('./helpers/response');

/**
 * Internal tool store.
 * Tools are registered via registerTool() or registerTools().
 */
const tools = {};

/**
 * Category descriptions for the tool router.
 */
const categoryDescriptions = {};

/**
 * Register a single tool.
 *
 * @param {string} name - Tool name (snake_case, verb-first)
 * @param {object} definition - Tool definition
 * @param {function} [definition.handler] - Handler function (required for backend tools)
 * @param {object} definition.schema - JSON Schema for parameters
 * @param {string} definition.description - Tool description for LLM
 * @param {string} definition.execution - 'backend' or 'frontend'
 * @param {string} definition.access - 'public', 'authenticated', 'admin', or 'owner'
 * @param {string} definition.category - Category name
 * @param {boolean} [definition.confirmBefore] - Whether destructive confirmation is needed
 * @param {object} [definition.frontendAction] - Frontend action config (for frontend tools)
 */
function registerTool(name, definition) {
  if (!name || !definition.schema || !definition.execution || !definition.access || !definition.category) {
    throw new Error(`Tool "${name}" is missing required fields (schema, execution, access, category)`);
  }
  if (definition.execution === 'backend' && !definition.handler) {
    throw new Error(`Backend tool "${name}" must have a handler function`);
  }
  if (definition.execution === 'frontend' && !definition.frontendAction) {
    throw new Error(`Frontend tool "${name}" must have a frontendAction config`);
  }
  tools[name] = definition;
}

/**
 * Register multiple tools at once.
 *
 * @param {object} toolMap - { toolName: toolDefinition, ... }
 */
function registerTools(toolMap) {
  for (const [name, definition] of Object.entries(toolMap)) {
    registerTool(name, definition);
  }
}

/**
 * Register a category description for the router.
 *
 * @param {string} category - Category name
 * @param {string} description - Human-readable description
 */
function registerCategory(category, description) {
  categoryDescriptions[category] = description;
}

/**
 * Register multiple category descriptions at once.
 *
 * @param {object} categories - { categoryName: description, ... }
 */
function registerCategories(categories) {
  for (const [name, desc] of Object.entries(categories)) {
    registerCategory(name, desc);
  }
}

/**
 * Get tool definitions formatted for the LLM, filtered by user role.
 *
 * @param {string} userRole - User's role
 * @returns {Array} Tool definitions in LLM function-calling format
 */
function getToolDefinitions(userRole) {
  const result = [];

  for (const [name, tool] of Object.entries(tools)) {
    if (!isAccessibleByRole(tool.access, userRole)) continue;

    let description = tool.description || '';
    if (tool.confirmBefore) {
      description += '\n\u26A0\uFE0F DESTRUCTIVE: Always ask for user confirmation before calling this tool.';
    }

    result.push({
      type: 'function',
      function: {
        name,
        description,
        parameters: tool.schema,
      },
    });
  }

  return result;
}

/**
 * Get tools for specific categories, filtered by user role.
 * Used by the router for selective tool loading.
 *
 * @param {string[]} categories - Category names to include
 * @param {string} userRole - User's role
 * @returns {Array} Tool definitions in LLM function-calling format
 */
function getToolsByCategories(categories, userRole) {
  const categorySet = new Set(categories);
  const result = [];

  for (const [name, tool] of Object.entries(tools)) {
    if (!categorySet.has(tool.category)) continue;
    if (!isAccessibleByRole(tool.access, userRole)) continue;

    let description = tool.description || '';
    if (tool.confirmBefore) {
      description += '\n\u26A0\uFE0F DESTRUCTIVE: Always ask for user confirmation before calling this tool.';
    }

    result.push({
      type: 'function',
      function: {
        name,
        description,
        parameters: tool.schema,
      },
    });
  }

  return result;
}

/**
 * Get category descriptions for the router.
 *
 * @returns {object} { categoryName: description, ... }
 */
function getCategoryDescriptions() {
  return { ...categoryDescriptions };
}

/**
 * Execute a tool by name.
 *
 * 1. Validate tool exists
 * 2. Check access
 * 3. Validate params (backend only)
 * 4. Route to handler (backend) or return frontend_action (frontend)
 *
 * @param {string} name - Tool name
 * @param {object} params - Tool parameters
 * @param {object} context - User context { userId, role, ... }
 * @returns {object} Tool result or frontend_action
 */
async function executeTool(name, params, context) {
  const tool = tools[name];
  if (!tool) {
    return errorResponse(`Unknown tool: ${name}`, 'NOT_FOUND');
  }

  // Access check
  const access = checkAccess(tool.access, context);
  if (!access.allowed) {
    return errorResponse(access.error, 'FORBIDDEN');
  }

  // Route by execution type
  if (tool.execution === 'backend') {
    // Validate params
    const validation = validateParams(params || {}, tool.schema);
    if (!validation.valid) {
      return errorResponse(validation.error, 'INVALID_PARAM');
    }

    try {
      return await tool.handler(params, context);
    } catch (err) {
      return errorResponse(`Tool execution failed: ${err.message}`, 'INTERNAL_ERROR');
    }
  }

  if (tool.execution === 'frontend') {
    return {
      type: 'frontend_action',
      tool: name,
      actionType: tool.frontendAction.type,
      store: tool.frontendAction.store || undefined,
      action: tool.frontendAction.action || undefined,
      route: tool.frontendAction.route || undefined,
      params,
    };
  }

  return errorResponse(`Unknown execution type for tool: ${name}`, 'INTERNAL_ERROR');
}

/**
 * Check if a role can access a tool based on its access level.
 */
function isAccessibleByRole(toolAccess, userRole) {
  if (toolAccess === 'public') return true;
  if (!userRole) return false;
  if (toolAccess === 'authenticated' || toolAccess === 'owner') return true;
  if (toolAccess === 'admin') return userRole === 'admin';
  return true;
}

/**
 * Get the internal tool definition (for testing/introspection).
 */
function getTool(name) {
  return tools[name] || null;
}

/**
 * Get all registered tool names.
 */
function getToolNames() {
  return Object.keys(tools);
}

/**
 * Clear all registered tools (for testing).
 */
function clearTools() {
  for (const key of Object.keys(tools)) {
    delete tools[key];
  }
  for (const key of Object.keys(categoryDescriptions)) {
    delete categoryDescriptions[key];
  }
}

module.exports = {
  registerTool,
  registerTools,
  registerCategory,
  registerCategories,
  getToolDefinitions,
  getToolsByCategories,
  getCategoryDescriptions,
  executeTool,
  getTool,
  getToolNames,
  clearTools,
};
