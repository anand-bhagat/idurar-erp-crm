/**
 * Output Sanitizer
 *
 * Strips PII and sensitive data from tool results before sending to the LLM.
 * Configurable per-tool-category field blocklists.
 */

const config = require('../config');

/**
 * Fields that are ALWAYS stripped from tool results (secrets/auth data).
 */
const GLOBAL_BLOCKED_FIELDS = new Set([
  'password',
  'salt',
  'token',
  'resetToken',
  'refreshToken',
  'accessToken',
  'apiKey',
  'secret',
  'hash',
  'sessionToken',
  'loggedSessions',
]);

/**
 * PII patterns to detect and redact in string values.
 */
const PII_PATTERNS = [
  { name: 'email', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL_REDACTED]' },
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN_REDACTED]' },
  { name: 'creditCard', pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, replacement: '[CARD_REDACTED]' },
  { name: 'phone', pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: '[PHONE_REDACTED]' },
];

/**
 * Per-category field blocklists. Fields listed here are stripped from tool
 * results for tools in that category.
 */
const CATEGORY_BLOCKED_FIELDS = {
  admin: new Set(['password', 'salt', 'token', 'resetToken', 'loggedSessions']),
  settings: new Set(['token', 'secret', 'apiKey']),
};

/**
 * Strip blocked fields from an object recursively.
 *
 * @param {*} data - Data to sanitize
 * @param {Set} blockedFields - Set of field names to strip
 * @returns {*} Sanitized data
 */
function stripFields(data, blockedFields) {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) {
    return data.map((item) => stripFields(item, blockedFields));
  }
  if (typeof data === 'object') {
    const cleaned = {};
    for (const [key, value] of Object.entries(data)) {
      if (blockedFields.has(key) || GLOBAL_BLOCKED_FIELDS.has(key)) {
        continue; // Strip this field entirely
      }
      cleaned[key] = stripFields(value, blockedFields);
    }
    return cleaned;
  }
  return data;
}

/**
 * Redact PII patterns in string values throughout an object.
 *
 * @param {*} data - Data to scan
 * @returns {*} Data with PII redacted
 */
function redactPII(data) {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    let result = data;
    for (const { pattern, replacement } of PII_PATTERNS) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }
  if (Array.isArray(data)) {
    return data.map((item) => redactPII(item));
  }
  if (typeof data === 'object') {
    const cleaned = {};
    for (const [key, value] of Object.entries(data)) {
      cleaned[key] = redactPII(value);
    }
    return cleaned;
  }
  return data;
}

/**
 * Sanitize a tool result before sending to the LLM.
 *
 * @param {object} result - Tool result object
 * @param {string} toolName - Name of the tool that produced the result
 * @param {string} [category] - Tool category for category-specific blocklists
 * @returns {object} Sanitized result
 */
function sanitizeToolResult(result, toolName, category) {
  if (!config.guardrails.sanitization.enabled) {
    return result;
  }

  const categoryBlocked = CATEGORY_BLOCKED_FIELDS[category] || new Set();
  let sanitized = stripFields(result, categoryBlocked);
  return sanitized;
}

/**
 * More aggressive sanitization for log output.
 * Strips blocked fields AND redacts PII patterns in strings.
 *
 * @param {*} data - Data to sanitize for logging
 * @returns {*} Sanitized data
 */
function sanitizeForLog(data) {
  let sanitized = stripFields(data, new Set());
  sanitized = redactPII(sanitized);
  return sanitized;
}

module.exports = {
  sanitizeToolResult,
  sanitizeForLog,
  // Exposed for testing
  GLOBAL_BLOCKED_FIELDS,
  CATEGORY_BLOCKED_FIELDS,
  PII_PATTERNS,
  stripFields,
  redactPII,
};
