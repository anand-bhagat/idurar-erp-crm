/**
 * JSON Schema validation helper using Ajv.
 *
 * coerceTypes: true is CRITICAL — open-source models (Llama, GLM, Qwen)
 * often send integers as strings ("1" instead of 1).
 */

const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true, coerceTypes: true });

/**
 * Strip markdown formatting from string values in params.
 * Open-source models sometimes include markdown in tool parameters.
 *
 * @param {object} params - Tool parameters
 * @returns {object} Cleaned params
 */
function stripMarkdownFromParams(params) {
  if (!params || typeof params !== 'object') return params;
  const cleaned = Array.isArray(params) ? [...params] : { ...params };
  for (const [key, value] of Object.entries(cleaned)) {
    if (typeof value === 'string') {
      cleaned[key] = value
        .replace(/\*\*(.*?)\*\*/g, '$1')  // bold
        .replace(/\*(.*?)\*/g, '$1')       // italic
        .replace(/`(.*?)`/g, '$1')         // inline code
        .replace(/~~(.*?)~~/g, '$1')       // strikethrough
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
        .trim();
    } else if (typeof value === 'object' && value !== null) {
      cleaned[key] = stripMarkdownFromParams(value);
    }
  }
  return cleaned;
}

/**
 * Validate params against a JSON Schema.
 * Strips markdown from string params before validation (open-source model compat).
 *
 * @param {object} params - Tool parameters from the LLM
 * @param {object} schema - JSON Schema for the tool's parameters
 * @returns {{ valid: boolean, error?: string, params?: object }}
 */
function validateParams(params, schema) {
  const cleaned = stripMarkdownFromParams(params);
  const validate = ajv.compile(schema);
  const valid = validate(cleaned);
  if (!valid) {
    const errors = validate.errors.map((e) => `${e.instancePath} ${e.message}`).join('; ');
    return { valid: false, error: `Invalid parameters: ${errors}` };
  }
  return { valid: true, params: cleaned };
}

/**
 * Check if a string is a valid MongoDB ObjectId.
 */
function isValidObjectId(id) {
  return /^[0-9a-fA-F]{24}$/.test(id);
}

module.exports = { validateParams, isValidObjectId, stripMarkdownFromParams };
