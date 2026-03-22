const { globSync } = require('glob');
const fs = require('fs');
const { generate: uniqueId } = require('shortid');

const seed = require('./seedData');

async function resetDb() {
  const Admin = require('../models/coreModels/Admin');
  const AdminPassword = require('../models/coreModels/AdminPassword');
  const Setting = require('../models/coreModels/Setting');
  const Client = require('../models/appModels/Client');
  const Invoice = require('../models/appModels/Invoice');
  const Payment = require('../models/appModels/Payment');
  const PaymentMode = require('../models/appModels/PaymentMode');
  const Taxes = require('../models/appModels/Taxes');
  const Conversation = require('../models/agentModels/Conversation');

  // ── 1. Delete non-seed documents ──────────────────────────────────
  await Promise.all([
    Admin.deleteMany({ _id: { $nin: [seed.ids.admin] } }),
    AdminPassword.deleteMany({ user: { $nin: [seed.ids.admin] } }),
    Taxes.deleteMany({ _id: { $nin: [seed.ids.tax] } }),
    PaymentMode.deleteMany({ _id: { $nin: [seed.ids.paymentMode] } }),
    Client.deleteMany({ _id: { $nin: seed.ids.clients } }),
    Invoice.deleteMany({ _id: { $nin: seed.ids.invoices } }),
    Payment.deleteMany({ _id: { $nin: seed.ids.payments } }),
    Conversation.deleteMany({}),
  ]);

  // ── 2. Upsert admin ──────────────────────────────────────────────
  await Admin.replaceOne({ _id: seed.admin._id }, seed.admin, { upsert: true });

  // ── 3. Upsert admin password (only set on first create to preserve sessions)
  const salt = uniqueId();
  const tempPassword = new AdminPassword();
  const passwordHash = tempPassword.generateHash(salt, 'admin123');

  await AdminPassword.updateOne(
    { user: seed.admin._id },
    {
      $setOnInsert: {
        _id: seed.ids.adminPassword,
        user: seed.admin._id,
        password: passwordHash,
        salt: salt,
        emailVerified: true,
        removed: false,
      },
    },
    { upsert: true }
  );

  // ── 4. Upsert taxes & payment mode ───────────────────────────────
  await Promise.all([
    Taxes.replaceOne({ _id: seed.tax._id }, seed.tax, { upsert: true }),
    PaymentMode.replaceOne({ _id: seed.paymentMode._id }, seed.paymentMode, { upsert: true }),
  ]);

  // ── 5. Upsert clients ────────────────────────────────────────────
  await Promise.all(
    seed.clients.map((c) => Client.replaceOne({ _id: c._id }, c, { upsert: true }))
  );

  // ── 6. Upsert invoices ───────────────────────────────────────────
  await Promise.all(
    seed.invoices.map((inv) => Invoice.replaceOne({ _id: inv._id }, inv, { upsert: true }))
  );

  // ── 7. Upsert payments ───────────────────────────────────────────
  await Promise.all(
    seed.payments.map((p) => Payment.replaceOne({ _id: p._id }, p, { upsert: true }))
  );

  // ── 8. Reset settings from JSON files ─────────────────────────────
  await Setting.deleteMany({});

  const settingDocs = [];
  const settingsFiles = globSync('./src/setup/defaultSettings/**/*.json');
  for (const filePath of settingsFiles) {
    const file = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    settingDocs.push(...file);
  }
  await Setting.insertMany(settingDocs);

  // Update finance counters to match seed data
  await Promise.all([
    Setting.updateOne({ settingKey: 'last_invoice_number' }, { $set: { settingValue: 4 } }),
    Setting.updateOne({ settingKey: 'last_payment_number' }, { $set: { settingValue: 2 } }),
  ]);

  console.log(`✅ Database reset complete — ${new Date().toISOString()}`);
}

module.exports = resetDb;
