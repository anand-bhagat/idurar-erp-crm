/**
 * Agent API Route
 *
 * POST /api/agent/chat — Main agent endpoint with SSE streaming.
 * Accepts { message, conversationId } or { frontendResult, conversationId }.
 */

const express = require('express');
const { randomUUID } = require('crypto');
const rateLimit = require('express-rate-limit');

const agentAuth = require('@/agent/middleware/agent-auth');
const { runAgent, runAgentStream, setHooks, resolveTools } = require('@/agent/engine');
const registry = require('@/agent/registry');
const config = require('@/agent/config');
const observability = require('@/agent/observability');
const { getLLMAdapter } = require('@/agent/llm');
const { buildSystemPrompt } = require('@/agent/llm/prompt-builder');
const { trackUsage } = require('@/agent/llm/cost-tracker');
const Conversation = require('@/models/agentModels/Conversation');

// Wire observability hooks into the engine on startup
setHooks(observability.createHooks());

const router = express.Router();

// Rate limiting for agent endpoint (more restrictive than regular API)
const agentRateLimiter = rateLimit({
  windowMs: config.rateLimiting.windowMs,
  max: config.rateLimiting.maxRequests,
  message: {
    success: false,
    error: 'Too many requests. Please slow down.',
    code: 'RATE_LIMITED',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.agentContext?.userId || req.ip,
});

/**
 * POST /api/agent/chat
 */
router.post('/agent/chat', agentAuth, agentRateLimiter, async (req, res) => {
  const traceId = randomUUID();
  const { message, frontendResult } = req.body;
  let { conversationId } = req.body;

  // Validate request body
  if (!message && !frontendResult) {
    return res.status(400).json({
      success: false,
      error: 'Request must include "message" or "frontendResult"',
      code: 'INVALID_PARAM',
    });
  }

  // Load or create conversation
  let conversation;
  if (conversationId) {
    conversation = await Conversation.getConversation(conversationId);
  }
  if (!conversation) {
    conversation = await Conversation.createConversation(req.agentContext.userId);
    conversationId = conversation._id.toString();
  }

  const userContext = {
    ...req.agentContext,
    traceId,
    conversationId,
  };

  // Get adapter
  const adapter = getAdapter();

  // Resolve tools (uses router if enabled, otherwise all role-permitted tools)
  const resolveResult = await resolveTools(message, userContext, [], adapter);
  const tools = resolveResult.tools;

  // Build system prompt with conditional rules
  const systemPrompt = buildSystemPrompt({
    userContext: { name: userContext.name, role: userContext.role },
    toolDefinitions: tools,
  });

  // Load conversation history and prepend system prompt
  const history = await Conversation.getHistory(conversationId);
  const conversationHistory = [{ role: 'system', content: systemPrompt }, ...history];

  // Wire cost tracking into LLM hook
  const existingHooks = observability.createHooks();
  const originalOnLLMCall = existingHooks.onLLMCall;
  existingHooks.onLLMCall = (data) => {
    if (config.llm.costTracking.enabled && data.usage) {
      trackUsage(data.usage, config.llm.model);
    }
    if (originalOnLLMCall) originalOnLLMCall(data);
  };
  setHooks(existingHooks);

  // Check if streaming is requested
  const useStreaming = req.headers.accept === 'text/event-stream' || req.query.stream === 'true';

  if (useStreaming) {
    // SSE streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (res.socket) {
      res.socket.setNoDelay(true);
    }

    // Handle client disconnect
    req.on('close', () => {
      res.end();
    });

    try {
      await runAgentStream({
        message,
        frontendResult,
        conversationHistory,
        userContext,
        adapter,
        tools,
        res,
      });

      // Save new messages to conversation
      const newMessages = [];
      if (message) newMessages.push({ role: 'user', content: message });
      if (newMessages.length > 0) {
        await Conversation.appendMessages(conversationId, newMessages);
      }
    } catch (error) {
      console.error(`[agent:chat] SSE error traceId=${traceId} conversationId=${conversationId}`, error);
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'An unexpected error occurred.' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', conversationId })}\n\n`);
    }

    res.end();
  } else {
    // Regular JSON response
    try {
      const result = await runAgent({
        message,
        frontendResult,
        conversationHistory,
        userContext,
        adapter,
        tools,
      });

      // Save messages to conversation
      const newMessages = [];
      if (message) newMessages.push({ role: 'user', content: message });
      if (result.message) newMessages.push({ role: 'assistant', content: result.message });
      if (newMessages.length > 0) {
        await Conversation.appendMessages(conversationId, newMessages);
      }

      return res.json({
        success: true,
        result,
        conversationId,
        traceId,
      });
    } catch (error) {
      console.error(`[agent:chat] JSON error traceId=${traceId} conversationId=${conversationId}`, error);
      return res.status(500).json({
        success: false,
        error: 'An unexpected error occurred processing your request.',
        code: 'INTERNAL_ERROR',
        traceId,
      });
    }
  }
});

/**
 * GET /api/agent/metrics — Admin-only metrics endpoint.
 *
 * Returns aggregated observability stats: top tools by usage, top tools by error rate,
 * average chain length, cost per conversation, LLM and router metrics.
 */
router.get('/agent/metrics', agentAuth, (req, res) => {
  if (req.agentContext.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required',
      code: 'FORBIDDEN',
    });
  }

  return res.json({
    success: true,
    data: observability.metrics.getMetricsSummary(),
  });
});

/**
 * Get the LLM adapter instance.
 * Uses the adapter factory — provider is determined by config/env.
 */
function getAdapter() {
  return getLLMAdapter(config.llm);
}

module.exports = router;
