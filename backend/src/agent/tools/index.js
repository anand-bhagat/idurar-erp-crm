/**
 * Tool Registration Entry Point
 *
 * Imports and registers all tool modules.
 * Call registerAllTools() once during application startup.
 */

const clients = require('./clients');

function registerAllTools() {
  clients.register();
}

module.exports = { registerAllTools };
