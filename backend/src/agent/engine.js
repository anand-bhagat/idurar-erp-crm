/**
 * Execution Engine
 *
 * Implements the agentic loop: LLM call -> tool call -> execute -> feed result -> repeat.
 * Supports SSE streaming, frontend tool forwarding, token budgets, and observability hooks.
 */

const registry = require('./registry');
const config = require('./config');
const router = require('./router');
const { sanitizer, injectionDetector, rateLimiter, tokenBudget, circuitBreaker } = require('./guardrails');
const observability = require('./observability');

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
 * Create a request stats accumulator for summary logging.
 */
function createRequestStats(userContext, message) {
  return {
    conversationId: userContext.conversationId,
    userId: userContext.userId,
    messageLength: message ? message.length : 0,
    routerUsed: false,
    routedCategories: [],
    llmCalls: 0,
    toolCalls: 0,
    tools: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    totalCost: 0,
    startTime: Date.now(),
  };
}

/**
 * Delegate to guardrail modules for token budget and circuit breaker.
 * These thin wrappers maintain the engine's existing API.
 */
function checkTokenBudget(conversationId, newUsage = 0) {
  return tokenBudget.checkBudget(conversationId, newUsage);
}

function trackTokenUsage(conversationId, usage) {
  tokenBudget.trackUsage(conversationId, usage);
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
  const stats = createRequestStats(userContext, message);

  function finalize(result) {
    stats.totalDurationMs = Date.now() - stats.startTime;
    observability.finalizeRequest(userContext.traceId, stats);
    return result;
  }

  // Rate limiting check
  const rateCheck = rateLimiter.checkAllLimits(userContext);
  if (!rateCheck.allowed) {
    return finalize({ type: 'response', message: rateCheck.error });
  }

  // Token budget check
  const budgetCheck = checkTokenBudget(conversationId);
  if (!budgetCheck.allowed) {
    return finalize({ type: 'response', message: budgetCheck.error });
  }

  // Prompt injection detection (only for new user messages)
  if (message) {
    const injectionCheck = injectionDetector.checkMessage(message, hooks.onGuardrailCheck, userContext);
    if (!injectionCheck.allowed) {
      return finalize({ type: 'response', message: injectionCheck.reason });
    }
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

      stats.llmCalls++;
      stats.totalInputTokens += llmResponse.usage.inputTokens || 0;
      stats.totalOutputTokens += llmResponse.usage.outputTokens || 0;
      stats.totalCachedTokens += llmResponse.usage.cachedTokens || 0;

      const toolCallCount = llmResponse.toolCalls ? llmResponse.toolCalls.length : 0;

      if (hooks.onLLMCall) {
        hooks.onLLMCall({
          model: config.llm.model,
          usage: llmResponse.usage,
          durationMs: duration,
          traceId: userContext.traceId,
          toolCallCount,
        });
      }
    }

    // Check budget after LLM call
    const postCallBudget = checkTokenBudget(conversationId);
    if (!postCallBudget.allowed) {
      return finalize({ type: 'response', message: postCallBudget.error });
    }

    // If LLM wants to call tools
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
        // Circuit breaker check
        if (circuitBreaker.isOpen(toolCall.name)) {
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

        // Per-tool rate limit check
        const toolRateCheck = rateLimiter.checkToolLimit(toolCall.name, userContext.userId);
        if (!toolRateCheck.allowed) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              success: false,
              error: toolRateCheck.error,
              code: 'RATE_LIMITED',
            }),
          });
          continue;
        }

        // Guardrail hook (custom, set by API layer)
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

        // Accumulate tool stats
        stats.toolCalls++;
        if (!stats.tools.includes(toolCall.name)) {
          stats.tools.push(toolCall.name);
        }

        // Track success/failure for circuit breaker
        if (result.success === false && result.code === 'INTERNAL_ERROR') {
          circuitBreaker.recordFailure(toolCall.name);
        } else if (result.success !== false) {
          circuitBreaker.recordSuccess(toolCall.name);
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
          return finalize({ ...result, toolCallId: toolCall.id });
        }

        // Sanitize tool result before feeding back to LLM
        const toolDef = registry.getTool(toolCall.name);
        const category = toolDef ? toolDef.category : undefined;
        const sanitizedResult = sanitizer.sanitizeToolResult(result, toolCall.name, category);

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(sanitizedResult),
        });
      }
      continue; // Loop — LLM may need more tools
    }

    // If LLM produced text, we're done
    if (llmResponse.content) {
      return finalize({ type: 'response', message: llmResponse.content });
    }
  }

  // Max iterations reached
  return finalize({
    type: 'response',
    message: 'I was unable to complete this request. Please try rephrasing.',
  });
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
  const stats = createRequestStats(userContext, message);

  function finalize() {
    stats.totalDurationMs = Date.now() - stats.startTime;
    observability.finalizeRequest(userContext.traceId, stats);
  }

  function sendSSE(event) {
    res.write(`data: ${JSON.stringify({ ...event, traceId: userContext.traceId })}\n\n`);
  }

  // Rate limiting check
  const rateCheck = rateLimiter.checkAllLimits(userContext);
  if (!rateCheck.allowed) {
    sendSSE({ type: 'error', message: rateCheck.error });
    sendSSE({ type: 'done', conversationId });
    finalize();
    return;
  }

  // Check token budget
  const budgetCheck = checkTokenBudget(conversationId);
  if (!budgetCheck.allowed) {
    sendSSE({ type: 'error', message: budgetCheck.error });
    sendSSE({ type: 'done', conversationId });
    finalize();
    return;
  }

  // Prompt injection detection
  if (message) {
    const injectionCheck = injectionDetector.checkMessage(message, hooks.onGuardrailCheck, userContext);
    if (!injectionCheck.allowed) {
      sendSSE({ type: 'error', message: injectionCheck.reason });
      sendSSE({ type: 'done', conversationId });
      finalize();
      return;
    }
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

      stats.llmCalls++;
      stats.totalInputTokens += llmResponse.usage.inputTokens || 0;
      stats.totalOutputTokens += llmResponse.usage.outputTokens || 0;
      stats.totalCachedTokens += llmResponse.usage.cachedTokens || 0;

      const toolCallCount = llmResponse.toolCalls ? llmResponse.toolCalls.length : 0;

      if (hooks.onLLMCall) {
        hooks.onLLMCall({
          model: config.llm.model,
          usage: llmResponse.usage,
          durationMs: duration,
          traceId: userContext.traceId,
          toolCallCount,
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
        if (circuitBreaker.isOpen(toolCall.name)) {
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

        // Accumulate tool stats
        stats.toolCalls++;
        if (!stats.tools.includes(toolCall.name)) {
          stats.tools.push(toolCall.name);
        }

        if (result.success === false && result.code === 'INTERNAL_ERROR') {
          circuitBreaker.recordFailure(toolCall.name);
        } else if (result.success !== false) {
          circuitBreaker.recordSuccess(toolCall.name);
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
          finalize();
          return;
        }

        // Sanitize tool result before feeding back to LLM
        const toolDef = registry.getTool(toolCall.name);
        const category = toolDef ? toolDef.category : undefined;
        const sanitizedResult = sanitizer.sanitizeToolResult(result, toolCall.name, category);

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(sanitizedResult),
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
  finalize();
}

/**
 * Resolve tools for a user message — handles routing decision.
 *
 * If routing is enabled and total tools exceed the threshold, uses the
 * two-stage router. Otherwise returns all role-permitted tools.
 *
 * @param {string} message - User message
 * @param {object} userContext - { userId, role, conversationId, ... }
 * @param {Array} conversationHistory - Previous messages
 * @param {object} adapter - LLM adapter instance
 * @returns {object} { tools, routed, categories, cached, fallback }
 */
async function resolveTools(message, userContext, conversationHistory, adapter) {
  const { role, conversationId } = userContext;

  if (router.shouldRoute(role)) {
    const routerStart = Date.now();

    const result = await router.getToolsForMessage(
      message,
      conversationId,
      conversationHistory,
      role,
      adapter
    );

    const routerDuration = Date.now() - routerStart;

    // Log routing decision
    if (hooks.onRequestTrace) {
      hooks.onRequestTrace({
        type: 'router_call',
        traceId: userContext.traceId,
        selectedCategories: result.categories,
        toolCount: result.tools.length,
        cached: result.cached,
        fallback: result.fallback,
        durationMs: routerDuration,
      });
    }

    return {
      tools: result.tools,
      routed: true,
      categories: result.categories,
      cached: result.cached,
      fallback: result.fallback,
    };
  }

  // Below threshold — use all role-permitted tools
  return {
    tools: registry.getToolDefinitions(role),
    routed: false,
    categories: [],
    cached: false,
    fallback: false,
  };
}

/**
 * Clear engine state (for testing).
 */
function clearEngineState() {
  tokenBudget.clearAll();
  circuitBreaker.clearAll();
  rateLimiter.clearLimits();
  router.clearCache();
  observability.metrics.clearAll();
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
  resolveTools,
  setHooks,
  checkTokenBudget,
  getToolStatusMessage,
  clearEngineState,
  // Exposed for testing
  _tokenBudget: tokenBudget,
  _circuitBreaker: circuitBreaker,
  _rateLimiter: rateLimiter,
};
