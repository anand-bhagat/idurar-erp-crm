/**
 * JSON Schema validation helper using Ajv.
 *
 * coerceTypes: true is CRITICAL — open-source models (Llama, GLM, Qwen)
 * often send integers as strings ("1" instead of 1).
 */

const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true, coerceTypes: true });

/**
 * Validate params against a JSON Schema.
 *
 * @param {object} params - Tool parameters from the LLM
 * @param {object} schema - JSON Schema for the tool's parameters
 * @returns {{ valid: boolean, error?: string }}
 */
function validateParams(params, schema) {
  const validate = ajv.compile(schema);
  const valid = validate(params);
  if (!valid) {
    const errors = validate.errors.map((e) => `${e.instancePath} ${e.message}`).join('; ');
    return { valid: false, error: `Invalid parameters: ${errors}` };
  }
  return { valid: true };
}

/**
 * Check if a string is a valid MongoDB ObjectId.
 */
function isValidObjectId(id) {
  return /^[0-9a-fA-F]{24}$/.test(id);
}

module.exports = { validateParams, isValidObjectId };
