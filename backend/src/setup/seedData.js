const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;

// ── Stable ObjectIds ────────────────────────────────────────────────
const ids = {
  admin: new ObjectId('000000000000000000000001'),
  adminPassword: new ObjectId('000000000000000000000002'),
  tax: new ObjectId('000000000000000000000010'),
  paymentMode: new ObjectId('000000000000000000000020'),
  clients: [
    new ObjectId('000000000000000000000101'),
    new ObjectId('000000000000000000000102'),
    new ObjectId('000000000000000000000103'),
  ],
  invoices: [
    new ObjectId('000000000000000000000201'),
    new ObjectId('000000000000000000000202'),
    new ObjectId('000000000000000000000203'),
    new ObjectId('000000000000000000000204'),
  ],
  payments: [
    new ObjectId('000000000000000000000301'),
    new ObjectId('000000000000000000000302'),
  ],
};

// ── Admin ───────────────────────────────────────────────────────────
const admin = {
  _id: ids.admin,
  email: 'admin@admin.com',
  name: 'IDURAR',
  surname: 'Admin',
  enabled: true,
  role: 'owner',
  removed: false,
};

// ── Taxes ───────────────────────────────────────────────────────────
const tax = {
  _id: ids.tax,
  taxName: 'Tax 0%',
  taxValue: '0',
  isDefault: true,
  enabled: true,
  removed: false,
};

// ── Payment Mode ────────────────────────────────────────────────────
const paymentMode = {
  _id: ids.paymentMode,
  name: 'Default Payment',
  description: 'Default Payment Mode (Cash , Wire Transfer)',
  isDefault: true,
  enabled: true,
  removed: false,
};

// ── Clients (3) ─────────────────────────────────────────────────────
const clients = [
  {
    _id: ids.clients[0],
    name: 'TechCorp Solutions',
    phone: '+1-555-0101',
    email: 'contact@techcorp.com',
    country: 'USA',
    address: '100 Tech Boulevard, San Francisco, CA 94105',
    createdBy: ids.admin,
    assigned: ids.admin,
    removed: false,
    enabled: true,
  },
  {
    _id: ids.clients[1],
    name: 'Nordic Design Studio',
    phone: '+46-8-555-0202',
    email: 'info@nordicdesign.se',
    country: 'Sweden',
    address: 'Kungsgatan 12, 111 35 Stockholm',
    createdBy: ids.admin,
    assigned: ids.admin,
    removed: false,
    enabled: true,
  },
  {
    _id: ids.clients[2],
    name: 'Mumbai Trading Co.',
    phone: '+91-22-555-0303',
    email: 'sales@mumbaitrading.in',
    country: 'India',
    address: '42 Marine Drive, Mumbai, Maharashtra 400002',
    createdBy: ids.admin,
    assigned: ids.admin,
    removed: false,
    enabled: true,
  },
];

// ── Invoices (4) ────────────────────────────────────────────────────
const invoices = [
  {
    _id: ids.invoices[0],
    createdBy: ids.admin,
    number: 1,
    year: 2026,
    date: new Date('2026-01-15'),
    expiredDate: new Date('2026-02-15'),
    client: ids.clients[0],
    items: [
      {
        itemName: 'Web Development',
        description: 'Full-stack web application development',
        quantity: 1,
        price: 2500,
        total: 2500,
      },
      {
        itemName: 'Hosting Setup',
        description: 'Cloud hosting configuration and deployment',
        quantity: 1,
        price: 150,
        total: 150,
      },
    ],
    taxRate: 0,
    subTotal: 2650,
    taxTotal: 0,
    total: 2650,
    credit: 2650,
    discount: 0,
    currency: 'USD',
    status: 'sent',
    paymentStatus: 'paid',
    payment: [ids.payments[0]],
    removed: false,
  },
  {
    _id: ids.invoices[1],
    createdBy: ids.admin,
    number: 2,
    year: 2026,
    date: new Date('2026-02-01'),
    expiredDate: new Date('2026-03-01'),
    client: ids.clients[1],
    items: [
      {
        itemName: 'Logo Design',
        description: 'Brand identity and logo design package',
        quantity: 1,
        price: 800,
        total: 800,
      },
    ],
    taxRate: 0,
    subTotal: 800,
    taxTotal: 0,
    total: 800,
    credit: 0,
    discount: 0,
    currency: 'USD',
    status: 'sent',
    paymentStatus: 'unpaid',
    payment: [],
    removed: false,
  },
  {
    _id: ids.invoices[2],
    createdBy: ids.admin,
    number: 3,
    year: 2026,
    date: new Date('2026-03-01'),
    expiredDate: new Date('2026-04-01'),
    client: ids.clients[2],
    items: [
      {
        itemName: 'ERP Setup',
        description: 'Enterprise resource planning system setup',
        quantity: 1,
        price: 3000,
        total: 3000,
      },
      {
        itemName: 'Training',
        description: 'Staff training on ERP system',
        quantity: 1,
        price: 500,
        total: 500,
      },
      {
        itemName: 'Support Package',
        description: '3-month technical support',
        quantity: 1,
        price: 200,
        total: 200,
      },
    ],
    taxRate: 0,
    subTotal: 3700,
    taxTotal: 0,
    total: 3700,
    credit: 0,
    discount: 0,
    currency: 'USD',
    status: 'draft',
    paymentStatus: 'unpaid',
    payment: [],
    removed: false,
  },
  {
    _id: ids.invoices[3],
    createdBy: ids.admin,
    number: 4,
    year: 2026,
    date: new Date('2026-03-10'),
    expiredDate: new Date('2026-04-10'),
    client: ids.clients[0],
    items: [
      {
        itemName: 'Maintenance',
        description: 'Monthly application maintenance',
        quantity: 1,
        price: 600,
        total: 600,
      },
    ],
    taxRate: 0,
    subTotal: 600,
    taxTotal: 0,
    total: 600,
    credit: 300,
    discount: 0,
    currency: 'USD',
    status: 'pending',
    paymentStatus: 'partially',
    payment: [ids.payments[1]],
    removed: false,
  },
];

// ── Payments (2) ────────────────────────────────────────────────────
const payments = [
  {
    _id: ids.payments[0],
    createdBy: ids.admin,
    number: 1,
    client: ids.clients[0],
    invoice: ids.invoices[0],
    date: new Date('2026-01-20'),
    amount: 2650,
    currency: 'USD',
    ref: 'PAY-001',
    description: 'Full payment for INV-001',
    removed: false,
  },
  {
    _id: ids.payments[1],
    createdBy: ids.admin,
    number: 2,
    client: ids.clients[0],
    invoice: ids.invoices[3],
    date: new Date('2026-03-15'),
    amount: 300,
    currency: 'USD',
    ref: 'PAY-002',
    description: 'Partial payment for INV-004',
    removed: false,
  },
];

module.exports = { ids, admin, tax, paymentMode, clients, invoices, payments };
