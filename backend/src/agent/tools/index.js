/**
 * Tool Registration Entry Point
 *
 * Imports and registers all tool modules.
 * Call registerAllTools() once during application startup.
 */

const clients = require('./clients');
const invoices = require('./invoices');
const payments = require('./payments');
const paymentModes = require('./payment-modes');
const taxes = require('./taxes');
const settings = require('./settings');
const admin = require('./admin');
const navigation = require('./navigation');

function registerAllTools() {
  clients.register();
  invoices.register();
  payments.register();
  paymentModes.register();
  taxes.register();
  settings.register();
  admin.register();
  navigation.register();
}

module.exports = { registerAllTools };
