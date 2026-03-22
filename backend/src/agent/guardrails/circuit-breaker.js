/**
 * Circuit Breaker
 *
 * If a tool fails repeatedly (threshold times within the reset window),
 * temporarily disable it and return a graceful error. Implements three states:
 *   - CLOSED: Normal operation, tool is available.
 *   - OPEN: Tool is disabled after too many failures.
 *   - HALF_OPEN: After cooldown, allows one test request to see if the tool recovered.
 */

const config = require('../config');

/**
 * Circuit states.
 */
const STATE = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open',
};

/**
 * Per-tool circuit breaker records.
 * Map<toolName, { count: number, lastFailure: number, state: string }>
 */
const circuits = new Map();

/**
 * State change listeners (for structured logging/observability).
 */
let onStateChange = null;

/**
 * Set a state change listener.
 *
 * @param {function} listener - Called with (toolName, oldState, newState, record)
 */
function setStateChangeListener(listener) {
  onStateChange = listener;
}

/**
 * Get or create the circuit record for a tool.
 *
 * @param {string} toolName
 * @returns {object} Circuit record
 */
function getRecord(toolName) {
  if (!circuits.has(toolName)) {
    circuits.set(toolName, { count: 0, lastFailure: 0, state: STATE.CLOSED });
  }
  return circuits.get(toolName);
}

/**
 * Emit a state change event.
 */
function emitStateChange(toolName, oldState, newState, record) {
  if (onStateChange && oldState !== newState) {
    onStateChange(toolName, oldState, newState, { ...record });
  }
}

/**
 * Check if a tool's circuit is open (tool is disabled).
 *
 * @param {string} toolName - Tool name
 * @returns {boolean} True if the tool should be skipped
 */
function isOpen(toolName) {
  if (!config.guardrails.circuitBreaker.enabled) return false;

  const record = circuits.get(toolName);
  if (!record) return false;

  const { threshold, resetMs } = config.guardrails.circuitBreaker;

  if (record.state === STATE.OPEN) {
    // Check if cooldown has elapsed → transition to half-open
    if (Date.now() - record.lastFailure > resetMs) {
      const oldState = record.state;
      record.state = STATE.HALF_OPEN;
      emitStateChange(toolName, oldState, STATE.HALF_OPEN, record);
      return false; // Allow one test request
    }
    return true; // Still in cooldown
  }

  if (record.state === STATE.HALF_OPEN) {
    return false; // Allow the test request
  }

  // CLOSED state — check if we should transition to OPEN
  if (record.count >= threshold) {
    if (Date.now() - record.lastFailure <= resetMs) {
      const oldState = record.state;
      record.state = STATE.OPEN;
      emitStateChange(toolName, oldState, STATE.OPEN, record);
      return true;
    }
    // Failures are stale — reset
    const oldState = record.state;
    record.count = 0;
    record.state = STATE.CLOSED;
    emitStateChange(toolName, oldState, STATE.CLOSED, record);
  }

  return false;
}

/**
 * Record a tool failure.
 *
 * @param {string} toolName - Tool name
 */
function recordFailure(toolName) {
  if (!config.guardrails.circuitBreaker.enabled) return;

  const record = getRecord(toolName);
  const oldState = record.state;

  record.count++;
  record.lastFailure = Date.now();

  // Half-open test failed → back to open
  if (record.state === STATE.HALF_OPEN) {
    record.state = STATE.OPEN;
    emitStateChange(toolName, oldState, STATE.OPEN, record);
    return;
  }

  // Check threshold
  if (record.count >= config.guardrails.circuitBreaker.threshold && record.state === STATE.CLOSED) {
    record.state = STATE.OPEN;
    emitStateChange(toolName, oldState, STATE.OPEN, record);
  }
}

/**
 * Record a tool success.
 *
 * @param {string} toolName - Tool name
 */
function recordSuccess(toolName) {
  if (!config.guardrails.circuitBreaker.enabled) return;

  const record = circuits.get(toolName);
  if (!record) return;

  const oldState = record.state;

  // Half-open test succeeded → fully close the circuit
  if (record.state === STATE.HALF_OPEN) {
    record.count = 0;
    record.lastFailure = 0;
    record.state = STATE.CLOSED;
    emitStateChange(toolName, oldState, STATE.CLOSED, record);
    return;
  }

  // Normal success in closed state — reset failure count
  record.count = 0;
  circuits.delete(toolName);
}

/**
 * Get the current state of a tool's circuit.
 *
 * @param {string} toolName
 * @returns {string} 'closed', 'open', or 'half_open'
 */
function getState(toolName) {
  const record = circuits.get(toolName);
  return record ? record.state : STATE.CLOSED;
}

/**
 * Clear all circuit breaker state (for testing).
 */
function clearAll() {
  circuits.clear();
  onStateChange = null;
}

module.exports = {
  isOpen,
  recordFailure,
  recordSuccess,
  getState,
  setStateChangeListener,
  clearAll,
  STATE,
  // Exposed for testing
  _circuits: circuits,
};
