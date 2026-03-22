/**
 * Prompt Injection Detector
 *
 * Scans user messages for common prompt injection patterns.
 * Configurable action: 'block' (reject message) or 'flag' (log warning, continue).
 */

const config = require('../config');

/**
 * Injection patterns with severity levels.
 * Each pattern has: name, regex, severity ('high' or 'medium'), description.
 */
const INJECTION_PATTERNS = [
  // Role override attempts
  {
    name: 'role_override',
    pattern: /\b(?:you\s+are\s+now|act\s+as|pretend\s+(?:to\s+be|you\s*(?:'re|are))|roleplay\s+as|behave\s+as\s+(?:if|a))\b/i,
    severity: 'high',
    description: 'Attempts to change the AI role',
  },
  // Instruction override
  {
    name: 'instruction_override',
    pattern: /\b(?:ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|rules?|guidelines?|prompts?)|disregard\s+(?:all\s+)?(?:previous|prior|your)\s+(?:instructions?|rules?))\b/i,
    severity: 'high',
    description: 'Attempts to override instructions',
  },
  // System prompt extraction
  {
    name: 'system_prompt_extraction',
    pattern: /\b(?:(?:show|reveal|display|print|output|repeat|tell)\s+(?:me\s+)?(?:your\s+)?(?:system\s+prompt|instructions|initial\s+prompt|hidden\s+prompt|original\s+prompt|system\s+message)|what\s+(?:are|is)\s+your\s+(?:system\s+prompt|instructions|initial\s+instructions))\b/i,
    severity: 'high',
    description: 'Attempts to extract system prompt',
  },
  // Tool definition extraction
  {
    name: 'tool_extraction',
    pattern: /\b(?:(?:list|show|reveal|display)\s+(?:all\s+)?(?:your\s+)?(?:tools?|functions?|capabilities|available\s+actions)|what\s+tools?\s+(?:do\s+you\s+have|are\s+available))\b/i,
    severity: 'medium',
    description: 'Attempts to extract tool definitions',
  },
  // Delimiter injection
  {
    name: 'delimiter_injection',
    pattern: /(?:<\/?(?:system|assistant|user|instruction|prompt)>|```\s*(?:system|instruction)|---\s*(?:system|new\s+instructions?)\s*---|\[SYSTEM\]|\[INST\])/i,
    severity: 'high',
    description: 'Delimiter-based injection attempt',
  },
  // Jailbreak patterns
  {
    name: 'jailbreak',
    pattern: /\b(?:DAN\s+mode|jailbreak|bypass\s+(?:filters?|restrictions?|safety|guardrails?)|developer\s+mode\s+enabled|unlimited\s+mode)\b/i,
    severity: 'high',
    description: 'Known jailbreak pattern',
  },
  // Encoded/obfuscated instructions
  {
    name: 'encoded_instructions',
    pattern: /\b(?:base64\s*:\s*|decode\s+(?:this|the\s+following)|\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4})/i,
    severity: 'medium',
    description: 'Encoded or obfuscated content',
  },
  // Prompt leaking via completion
  {
    name: 'completion_attack',
    pattern: /\b(?:complete\s+(?:the|this)\s+(?:sentence|text)\s*:?\s*(?:my\s+)?(?:system\s+prompt|instructions)\s+(?:are|is|say)|continue\s+from\s*:?\s*(?:system|instructions))\b/i,
    severity: 'high',
    description: 'Attempts to leak prompt via completion',
  },
];

/**
 * Detect prompt injection attempts in a user message.
 *
 * @param {string} userMessage - The user's message to scan
 * @returns {{ safe: boolean, reason?: string, pattern?: string, severity?: string, detections?: Array }}
 */
function detectInjection(userMessage) {
  if (!config.guardrails.injectionDetection.enabled) {
    return { safe: true };
  }

  if (!userMessage || typeof userMessage !== 'string') {
    return { safe: true };
  }

  const detections = [];

  for (const { name, pattern, severity, description } of INJECTION_PATTERNS) {
    if (pattern.test(userMessage)) {
      detections.push({ pattern: name, severity, description });
    }
  }

  if (detections.length === 0) {
    return { safe: true };
  }

  // Return the highest severity detection as the primary reason
  const highSeverity = detections.find((d) => d.severity === 'high');
  const primary = highSeverity || detections[0];

  return {
    safe: false,
    reason: primary.description,
    pattern: primary.pattern,
    severity: primary.severity,
    detections,
  };
}

/**
 * Check a message and determine if it should be blocked or flagged.
 *
 * @param {string} userMessage - User message
 * @param {object} [logger] - Optional logger for structured logging
 * @param {object} [context] - User context for logging (userId, traceId)
 * @returns {{ allowed: boolean, flagged: boolean, reason?: string, detections?: Array }}
 */
function checkMessage(userMessage, logger, context) {
  const result = detectInjection(userMessage);

  if (result.safe) {
    return { allowed: true, flagged: false };
  }

  const mode = config.guardrails.injectionDetection.mode;

  // Log the detection
  if (logger) {
    logger({
      type: 'injection_detected',
      mode,
      pattern: result.pattern,
      severity: result.severity,
      reason: result.reason,
      detectionCount: result.detections.length,
      userId: context?.userId,
      traceId: context?.traceId,
    });
  }

  if (mode === 'block') {
    return {
      allowed: false,
      flagged: true,
      reason: 'Your message was flagged by our content filter. Please rephrase your request.',
      detections: result.detections,
    };
  }

  // 'flag' mode — log but allow
  return {
    allowed: true,
    flagged: true,
    reason: result.reason,
    detections: result.detections,
  };
}

module.exports = {
  detectInjection,
  checkMessage,
  // Exposed for testing
  INJECTION_PATTERNS,
};
