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
const { runAgent, runAgentStream } = require('@/agent/engine');
const registry = require('@/agent/registry');
const config = require('@/agent/config');

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
  const { message, frontendResult, conversationId = randomUUID() } = req.body;

  // Validate request body
  if (!message && !frontendResult) {
    return res.status(400).json({
      success: false,
      error: 'Request must include "message" or "frontendResult"',
      code: 'INVALID_PARAM',
    });
  }

  const userContext = {
    ...req.agentContext,
    traceId,
    conversationId,
  };

  // Get tools based on user role
  const tools = registry.getToolDefinitions(userContext.role);

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
        conversationHistory: [], // TODO: Load from conversation store
        userContext,
        adapter: getAdapter(),
        tools,
        res,
      });
    } catch (error) {
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
        conversationHistory: [], // TODO: Load from conversation store
        userContext,
        adapter: getAdapter(),
        tools,
      });

      return res.json({
        success: true,
        result,
        conversationId,
        traceId,
      });
    } catch (error) {
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
 * Get the LLM adapter.
 * Returns a placeholder — will be wired to real adapter in LLM phase.
 */
function getAdapter() {
  // Placeholder adapter that returns a simple response
  // Will be replaced when LLM adapter layer is implemented (Phase 8)
  return {
    async chat(messages, tools, options) {
      return {
        content: 'The agent LLM adapter is not yet configured. Please set up the LLM adapter layer.',
        toolCalls: null,
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
      };
    },
  };
}

module.exports = router;
