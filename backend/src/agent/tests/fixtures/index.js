/**
 * Test fixtures for agent tests.
 */

const clients = [
  {
    _id: '507f1f77bcf86cd799439011',
    type: 'company',
    name: 'Acme Corp',
    email: 'contact@acme.com',
    phone: '+1-555-0100',
    country: 'US',
    createdBy: '507f1f77bcf86cd799439099',
    removed: false,
    created: new Date('2026-01-15'),
    updated: new Date('2026-01-15'),
  },
  {
    _id: '507f1f77bcf86cd799439012',
    type: 'person',
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+1-555-0200',
    country: 'UK',
    createdBy: '507f1f77bcf86cd799439099',
    removed: false,
    created: new Date('2026-02-10'),
    updated: new Date('2026-02-10'),
  },
];

const invoices = [
  {
    _id: '607f1f77bcf86cd799439021',
    number: 'INV-001',
    year: 2026,
    date: new Date('2026-01-20'),
    client: '507f1f77bcf86cd799439011',
    items: [
      { itemName: 'Consulting', quantity: 10, price: 150, total: 1500 },
    ],
    subTotal: 1500,
    taxRate: 10,
    taxTotal: 150,
    total: 1650,
    credit: 0,
    discount: 0,
    status: 'sent',
    paymentStatus: 'unpaid',
    createdBy: '507f1f77bcf86cd799439099',
    removed: false,
  },
];

const payments = [
  {
    _id: '707f1f77bcf86cd799439031',
    number: 'PAY-001',
    date: new Date('2026-02-01'),
    amount: 500,
    invoice: '607f1f77bcf86cd799439021',
    client: '507f1f77bcf86cd799439011',
    paymentMode: 'bank_transfer',
    createdBy: '507f1f77bcf86cd799439099',
    removed: false,
  },
];

const settings = [
  {
    _id: '807f1f77bcf86cd799439041',
    settingCategory: 'app_settings',
    settingKey: 'idurar_app_language',
    settingValue: 'en_us',
    removed: false,
  },
];

const admins = [
  {
    _id: '507f1f77bcf86cd799439099',
    email: 'admin@test.com',
    name: 'Test Admin',
    surname: 'User',
    role: 'owner',
    removed: false,
  },
];

module.exports = { clients, invoices, payments, settings, admins };
