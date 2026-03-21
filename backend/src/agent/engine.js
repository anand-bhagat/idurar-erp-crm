/**
 * Execution Engine
 *
 * Implements the agentic loop: LLM call -> tool call -> execute -> feed result -> repeat.
 * Supports SSE streaming, frontend tool forwarding, token budgets, and observability hooks.
 */

const registry = require('./registry');
const config = require('./config');

/**
 * Tool status messages for SSE events.
 */
const toolStatusMessages = {
  get_product: '\uD83D\uDCF1 Looking up product...',
  search_products: '\uD83D\uDD0D Searching products...',
  get_order: '\uD83D\uDCE6 Looking up order...',
  list_orders: '\uD83D\uDCCB Loading orders...',
  create_product: '\u270F\uFE0F Creating product...',
  delete_product: '\uD83D\uDDD1\uFE0F Deleting product...',
  get_client: '\uD83D\uDC64 Looking up client...',
  search_clients: '\uD83D\uDD0D Searching clients...',
  list_clients: '\uD83D\uDCCB Loading clients...',
  create_client: '\u270F\uFE0F Creating client...',
  get_invoice: '\uD83D\uDCC4 Looking up invoice...',
  search_invoices: '\uD83D\uDD0D Searching invoices...',
  _default: '\u2699\uFE0F Processing...',
};

/**
 * Observability hooks — set by the API layer.
 */
let hooks = {
  onToolExecution: null,
  onLLMCall: null,
  onRequestTrace: null,
  onGuardrailCheck: null,
};

/**
 * Set observability/guardrail hooks.
 */
function setHooks(newHooks) {
  hooks = { ...hooks, ...newHooks };
}

/**
 * Per-conversation token usage tracking.
 */
const conversationTokenUsage = new Map();

/**
 * Circuit breaker state.
 */
const toolFailureCounts = new Map();

function isToolCircuitOpen(toolName) {
  const record = toolFailureCounts.get(toolName);
  if (!record) return false;
  if (record.count >= config.guardrails.circuitBreaker.threshold) {
    if (Date.now() - record.lastFailure > config.guardrails.circuitBreaker.resetMs) {
      toolFailureCounts.delete(toolName);
      return false;
    }
    return true;
  }
  return false;
}

function recordToolFailure(toolName) {
  const record = toolFailureCounts.get(toolName) || { count: 0, lastFailure: 0 };
  record.count++;
  record.lastFailure = Date.now();
  toolFailureCounts.set(toolName, record);
}

function recordToolSuccess(toolName) {
  toolFailureCounts.delete(toolName);
}

/**
 * Check if conversation is within token budget.
 */
function checkTokenBudget(conversationId, newUsage = 0) {
  const total = (conversationTokenUsage.get(conversationId) || 0) + newUsage;
  if (total > config.tokenBudget.perConversation) {
    return {
      allowed: false,
      error: 'This conversation has reached its processing limit. Please start a new conversation.',
    };
  }
  return { allowed: true };
}

function trackTokenUsage(conversationId, usage) {
  const total = (conversationTokenUsage.get(conversationId) || 0) +
    (usage.inputTokens || 0) + (usage.outputTokens || 0);
  conversationTokenUsage.set(conversationId, total);
}

/**
 * Get a status message for a tool call.
 */
function getToolStatusMessage(toolName) {
  return toolStatusMessages[toolName] || toolStatusMessages._default;
}

/**
 * Run the agent for a single user message (non-streaming).
 *
 * @param {object} options
 * @param {string} options.message - User message (or null if frontendResult)
 * @param {object} [options.frontendResult] - Result from a frontend tool execution
 * @param {Array} options.conversationHistory - Previous messages
 * @param {object} options.userContext - { userId, role, name, traceId, conversationId }
 * @param {object} options.adapter - LLM adapter instance
 * @param {Array} options.tools - Tool definitions for LLM
 * @returns {object} Final response { type, message } or { type: 'frontend_action', ... }
 */
async function runAgent({ message, frontendResult, conversationHistory, userContext, adapter, tools }) {
  const MAX_ITERATIONS = config.llm.maxIterations;
  const conversationId = userContext.conversationId;

  // Check token budget
  const budgetCheck = checkTokenBudget(conversationId);
  if (!budgetCheck.allowed) {
    return { type: 'response', message: budgetCheck.error };
  }

  // Build messages array
  let messages = [...conversationHistory];

  if (frontendResult) {
    // Continue from a frontend tool execution
    messages.push({
      role: 'tool',
      tool_call_id: frontendResult.toolCallId,
      content: JSON.stringify({
        success: frontendResult.success,
        data: frontendResult.data || frontendResult.message,
      }),
    });
  } else if (message) {
    messages.push({ role: 'user', content: message });
  }

  // Agentic loop
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const startTime = Date.now();

    const llmResponse = await adapter.chat(messages, tools, {
      cacheOptions: {
        cacheSystemPrompt: true,
        cacheToolDefinitions: true,
      },
    });

    const duration = Date.now() - startTime;

    // Track token usage
    if (llmResponse.usage) {
      trackTokenUsage(conversationId, llmResponse.usage);

      if (hooks.onLLMCall) {
        hooks.onLLMCall({
          model: config.llm.model,
          usage: llmResponse.usage,
          durationMs: duration,
          traceId: userContext.traceId,
        });
      }
    }

    // Check budget after LLM call
    const postCallBudget = checkTokenBudget(conversationId);
    if (!postCallBudget.allowed) {
      return { type: 'response', message: postCallBudget.error };
    }

    // If LLM wants to call tools
    if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
      // Add assistant message with tool calls to history
      messages.push({
        role: 'assistant',
        content: llmResponse.content || null,
        tool_calls: llmResponse.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.params) },
        })),
      });

      for (const toolCall of llmResponse.toolCalls) {
        // Circuit breaker check
        if (isToolCircuitOpen(toolCall.name)) {
          const circuitError = {
            success: false,
            error: `Tool "${toolCall.name}" is temporarily unavailable. Please try again later.`,
            code: 'CIRCUIT_OPEN',
          };
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(circuitError),
          });
          continue;
        }

        // Guardrail hook
        if (hooks.onGuardrailCheck) {
          const guardrailResult = await hooks.onGuardrailCheck(toolCall.name, toolCall.params, userContext);
          if (guardrailResult && !guardrailResult.allowed) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                success: false,
                error: guardrailResult.error || 'Request blocked by guardrails',
                code: 'GUARDRAIL_BLOCKED',
              }),
            });
            continue;
          }
        }

        const toolStart = Date.now();
        const result = await registry.executeTool(toolCall.name, toolCall.params, userContext);
        const toolDuration = Date.now() - toolStart;

        // Track success/failure for circuit breaker
        if (result.success === false && result.code === 'INTERNAL_ERROR') {
          recordToolFailure(toolCall.name);
        } else if (result.success !== false) {
          recordToolSuccess(toolCall.name);
        }

        // Observability hook
        if (hooks.onToolExecution) {
          hooks.onToolExecution({
            tool: toolCall.name,
            params: toolCall.params,
            result,
            durationMs: toolDuration,
            context: userContext,
          });
        }

        // Frontend tool — return to widget for execution
        if (result.type === 'frontend_action') {
          return { ...result, toolCallId: toolCall.id };
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      continue; // Loop — LLM may need more tools
    }

    // If LLM produced text, we're done
    if (llmResponse.content) {
      return { type: 'response', message: llmResponse.content };
    }
  }

  // Max iterations reached
  return {
    type: 'response',
    message: 'I was unable to complete this request. Please try rephrasing.',
  };
}

/**
 * Run the agent with SSE streaming.
 *
 * @param {object} options - Same as runAgent + { res } for SSE response
 * @param {object} options.res - Express response object (for SSE)
 */
async function runAgentStream({ message, frontendResult, conversationHistory, userContext, adapter, tools, res }) {
  const MAX_ITERATIONS = config.llm.maxIterations;
  const conversationId = userContext.conversationId;

  function sendSSE(event) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  // Check token budget
  const budgetCheck = checkTokenBudget(conversationId);
  if (!budgetCheck.allowed) {
    sendSSE({ type: 'error', message: budgetCheck.error });
    sendSSE({ type: 'done', conversationId });
    return;
  }

  // Build messages array
  let messages = [...conversationHistory];

  if (frontendResult) {
    messages.push({
      role: 'tool',
      tool_call_id: frontendResult.toolCallId,
      content: JSON.stringify({
        success: frontendResult.success,
        data: frontendResult.data || frontendResult.message,
      }),
    });
    sendSSE({ type: 'status', message: '\u270D\uFE0F Writing response...' });
  } else if (message) {
    messages.push({ role: 'user', content: message });
  }

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    sendSSE({ type: 'status', message: 'Thinking...' });

    const startTime = Date.now();

    const llmResponse = await adapter.chat(messages, tools, {
      cacheOptions: {
        cacheSystemPrompt: true,
        cacheToolDefinitions: true,
      },
    });

    const duration = Date.now() - startTime;

    if (llmResponse.usage) {
      trackTokenUsage(conversationId, llmResponse.usage);

      if (hooks.onLLMCall) {
        hooks.onLLMCall({
          model: config.llm.model,
          usage: llmResponse.usage,
          durationMs: duration,
          traceId: userContext.traceId,
        });
      }
    }

    const postCallBudget = checkTokenBudget(conversationId);
    if (!postCallBudget.allowed) {
      sendSSE({ type: 'error', message: postCallBudget.error });
      break;
    }

    if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: llmResponse.content || null,
        tool_calls: llmResponse.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.params) },
        })),
      });

      for (const toolCall of llmResponse.toolCalls) {
        if (isToolCircuitOpen(toolCall.name)) {
          const circuitError = {
            success: false,
            error: `Tool "${toolCall.name}" is temporarily unavailable.`,
            code: 'CIRCUIT_OPEN',
          };
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(circuitError),
          });
          continue;
        }

        sendSSE({ type: 'status', message: getToolStatusMessage(toolCall.name) });

        const toolStart = Date.now();
        const result = await registry.executeTool(toolCall.name, toolCall.params, userContext);
        const toolDuration = Date.now() - toolStart;

        if (result.success === false && result.code === 'INTERNAL_ERROR') {
          recordToolFailure(toolCall.name);
        } else if (result.success !== false) {
          recordToolSuccess(toolCall.name);
        }

        if (hooks.onToolExecution) {
          hooks.onToolExecution({
            tool: toolCall.name,
            params: toolCall.params,
            result,
            durationMs: toolDuration,
            context: userContext,
          });
        }

        if (result.type === 'frontend_action') {
          sendSSE({ type: 'frontend_action', ...result, toolCallId: toolCall.id });
          sendSSE({ type: 'done', conversationId });
          return;
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      sendSSE({ type: 'status', message: 'Processing results...' });
      continue;
    }

    if (llmResponse.content) {
      sendSSE({ type: 'text_delta', content: llmResponse.content });
      break;
    }
  }

  sendSSE({ type: 'done', conversationId });
}

/**
 * Clear engine state (for testing).
 */
function clearEngineState() {
  conversationTokenUsage.clear();
  toolFailureCounts.clear();
  hooks = {
    onToolExecution: null,
    onLLMCall: null,
    onRequestTrace: null,
    onGuardrailCheck: null,
  };
}

module.exports = {
  runAgent,
  runAgentStream,
  setHooks,
  checkTokenBudget,
  getToolStatusMessage,
  clearEngineState,
  // Exposed for testing
  _toolFailureCounts: toolFailureCounts,
  _conversationTokenUsage: conversationTokenUsage,
};
