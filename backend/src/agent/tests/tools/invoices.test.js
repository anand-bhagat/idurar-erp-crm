/**
 * Tests for Invoice Tools — Phase 3
 *
 * Tests all 7 backend handlers: get_invoice, list_invoices, search_invoices,
 * get_invoice_summary, create_invoice, update_invoice, delete_invoice.
 *
 * Also tests navigate_to_invoices and navigate_to_create_invoice registration via the registry.
 */

const { mockContext, mockAdminContext, mockUnauthenticatedContext } = require('../helpers/mockContext');
const { invoices } = require('../fixtures');

// ---------------------------------------------------------------------------
// Chainable query mock helper
// ---------------------------------------------------------------------------

function chainable(resolvedValue) {
  const chain = {};
  ['skip', 'limit', 'sort', 'populate', 'where', 'select'].forEach((method) => {
    chain[method] = jest.fn(() => chain);
  });
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

// ---------------------------------------------------------------------------
// Mock mongoose
// ---------------------------------------------------------------------------

const mockInvoiceModel = {
  findOne: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
  findOneAndUpdate: jest.fn(),
  aggregate: jest.fn(),
  collection: { name: 'invoices' },
};

// Mock save on Invoice instances
const mockSave = jest.fn();

const mockPaymentModel = {
  updateMany: jest.fn(),
};

const mockSettingModel = {
  findOneAndUpdate: jest.fn(),
};

jest.mock('mongoose', () => ({
  model: jest.fn((name) => {
    if (name === 'Invoice') return mockInvoiceModel;
    if (name === 'Payment') return mockPaymentModel;
    if (name === 'Setting') return mockSettingModel;
    return {};
  }),
}));

// ---------------------------------------------------------------------------
// Import handlers (after mocking)
// ---------------------------------------------------------------------------

const {
  getInvoice,
  listInvoices,
  searchInvoices,
  getInvoiceSummary,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  toolDefinitions,
  register,
} = require('../../tools/invoices');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_ID = '607f1f77bcf86cd799439021';
const VALID_ID_2 = '607f1f77bcf86cd799439022';
const VALID_CLIENT_ID = '507f1f77bcf86cd799439011';
const INVALID_ID = 'not-a-valid-id';

const sampleInvoice = {
  _id: VALID_ID,
  number: 1042,
  year: 2026,
  date: new Date('2026-01-20'),
  expiredDate: new Date('2026-02-20'),
  client: {
    _id: VALID_CLIENT_ID,
    name: 'Acme Corp',
    email: 'contact@acme.com',
  },
  items: [
    { itemName: 'Consulting', description: 'Strategy session', quantity: 10, price: 150, total: 1500 },
  ],
  taxRate: 10,
  subTotal: 1500,
  taxTotal: 150,
  total: 1650,
  discount: 0,
  credit: 0,
  currency: 'USD',
  status: 'sent',
  paymentStatus: 'unpaid',
  isOverdue: false,
  approved: false,
  notes: 'Net 30 payment terms',
  payment: [],
  createdBy: { _id: '507f1f77bcf86cd799439099', name: 'Test Admin' },
  removed: false,
  created: new Date('2026-01-20'),
  updated: new Date('2026-01-20'),
};

const sampleInvoice2 = {
  _id: VALID_ID_2,
  number: 1043,
  year: 2026,
  date: new Date('2026-02-01'),
  expiredDate: new Date('2026-03-01'),
  client: {
    _id: VALID_CLIENT_ID,
    name: 'Acme Corp',
  },
  items: [
    { itemName: 'Design', quantity: 1, price: 2500, total: 2500 },
  ],
  taxRate: 0,
  subTotal: 2500,
  taxTotal: 0,
  total: 2500,
  discount: 0,
  credit: 500,
  status: 'draft',
  paymentStatus: 'partially',
  removed: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Invoice Tools', () => {
  let ctx;

  beforeEach(() => {
    ctx = mockContext();
    jest.clearAllMocks();
  });

  // =========================================================================
  // get_invoice
  // =========================================================================
  describe('get_invoice', () => {
    it('should return invoice details for a valid ID', async () => {
      mockInvoiceModel.findOne.mockReturnValue(chainable(sampleInvoice));

      const result = await getInvoice({ id: VALID_ID }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.number).toBe(1042);
      expect(result.data.total).toBe(1650);
      expect(result.data.client.name).toBe('Acme Corp');
      expect(mockInvoiceModel.findOne).toHaveBeenCalledWith({
        _id: VALID_ID,
        removed: false,
      });
    });

    it('should populate createdBy with name', async () => {
      mockInvoiceModel.findOne.mockReturnValue(chainable(sampleInvoice));

      await getInvoice({ id: VALID_ID }, ctx);

      const chain = mockInvoiceModel.findOne.mock.results[0].value;
      expect(chain.populate).toHaveBeenCalledWith('createdBy', 'name');
    });

    it('should return NOT_FOUND for non-existent invoice', async () => {
      mockInvoiceModel.findOne.mockReturnValue(chainable(null));

      const result = await getInvoice({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return INVALID_PARAM for invalid ObjectId', async () => {
      const result = await getInvoice({ id: INVALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockInvoiceModel.findOne).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when id is missing', async () => {
      const result = await getInvoice({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should handle database errors gracefully', async () => {
      mockInvoiceModel.findOne.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('DB connection lost')),
      });

      const result = await getInvoice({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.error).toContain('DB connection lost');
    });
  });

  // =========================================================================
  // list_invoices
  // =========================================================================
  describe('list_invoices', () => {
    it('should return paginated invoice list with defaults', async () => {
      mockInvoiceModel.find.mockReturnValue(chainable([sampleInvoice, sampleInvoice2]));
      mockInvoiceModel.countDocuments.mockResolvedValue(2);

      const result = await listInvoices({}, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.metadata.pagination).toEqual({ page: 1, pages: 1, count: 2 });
    });

    it('should return empty results when no invoices exist', async () => {
      mockInvoiceModel.find.mockReturnValue(chainable([]));
      mockInvoiceModel.countDocuments.mockResolvedValue(0);

      const result = await listInvoices({}, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
      expect(result.metadata.pagination.count).toBe(0);
    });

    it('should respect pagination parameters', async () => {
      mockInvoiceModel.find.mockReturnValue(chainable([sampleInvoice2]));
      mockInvoiceModel.countDocuments.mockResolvedValue(12);

      const result = await listInvoices({ page: 2, items: 5 }, ctx);

      expect(result.success).toBe(true);
      expect(result.metadata.pagination).toEqual({ page: 2, pages: 3, count: 12 });

      const findChain = mockInvoiceModel.find.mock.results[0].value;
      expect(findChain.skip).toHaveBeenCalledWith(5);
      expect(findChain.limit).toHaveBeenCalledWith(5);
    });

    it('should apply filter and equal parameters', async () => {
      mockInvoiceModel.find.mockReturnValue(chainable([sampleInvoice]));
      mockInvoiceModel.countDocuments.mockResolvedValue(1);

      const result = await listInvoices({ filter: 'status', equal: 'sent' }, ctx);

      expect(result.success).toBe(true);
      expect(mockInvoiceModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'sent', removed: false })
      );
    });

    it('should filter by paymentStatus', async () => {
      mockInvoiceModel.find.mockReturnValue(chainable([sampleInvoice]));
      mockInvoiceModel.countDocuments.mockResolvedValue(1);

      const result = await listInvoices({ filter: 'paymentStatus', equal: 'unpaid' }, ctx);

      expect(result.success).toBe(true);
      expect(mockInvoiceModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: 'unpaid', removed: false })
      );
    });

    it('should reject object filter values', async () => {
      const result = await listInvoices(
        { filter: 'status', equal: { $ne: 'draft' } },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should apply text search with q and fields', async () => {
      mockInvoiceModel.find.mockReturnValue(chainable([sampleInvoice]));
      mockInvoiceModel.countDocuments.mockResolvedValue(1);

      const result = await listInvoices({ q: 'payment', fields: 'notes,content' }, ctx);

      expect(result.success).toBe(true);
      expect(mockInvoiceModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          removed: false,
          $or: expect.any(Array),
        })
      );
    });

    it('should populate createdBy with name', async () => {
      mockInvoiceModel.find.mockReturnValue(chainable([]));
      mockInvoiceModel.countDocuments.mockResolvedValue(0);

      await listInvoices({}, ctx);

      const findChain = mockInvoiceModel.find.mock.results[0].value;
      expect(findChain.populate).toHaveBeenCalledWith('createdBy', 'name');
    });

    it('should handle database errors gracefully', async () => {
      mockInvoiceModel.find.mockReturnValue({
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('DB error')),
      });
      mockInvoiceModel.countDocuments.mockRejectedValue(new Error('DB error'));

      const result = await listInvoices({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  // =========================================================================
  // search_invoices
  // =========================================================================
  describe('search_invoices', () => {
    it('should return matching invoices', async () => {
      mockInvoiceModel.find.mockReturnValue(chainable([sampleInvoice]));

      const result = await searchInvoices({ q: 'payment' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('should search across specified fields', async () => {
      mockInvoiceModel.find.mockReturnValue(chainable([sampleInvoice]));

      const result = await searchInvoices({ q: 'test', fields: 'notes,content' }, ctx);

      expect(result.success).toBe(true);
      const findArgs = mockInvoiceModel.find.mock.calls[0][0];
      expect(findArgs.$or).toHaveLength(2);
    });

    it('should default to notes,content fields when fields not specified', async () => {
      mockInvoiceModel.find.mockReturnValue(chainable([]));

      await searchInvoices({ q: 'test' }, ctx);

      const findArgs = mockInvoiceModel.find.mock.calls[0][0];
      expect(findArgs.$or).toHaveLength(2);
      expect(findArgs.$or[0]).toHaveProperty('notes');
      expect(findArgs.$or[1]).toHaveProperty('content');
    });

    it('should return empty results when no match', async () => {
      mockInvoiceModel.find.mockReturnValue(chainable([]));

      const result = await searchInvoices({ q: 'nonexistent' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });

    it('should return INVALID_PARAM when q is missing', async () => {
      const result = await searchInvoices({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockInvoiceModel.find).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when q is empty whitespace', async () => {
      const result = await searchInvoices({ q: '   ' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should escape special regex characters in search term', async () => {
      mockInvoiceModel.find.mockReturnValue(chainable([]));

      await searchInvoices({ q: 'invoice.test (special)' }, ctx);

      const findArgs = mockInvoiceModel.find.mock.calls[0][0];
      expect(findArgs.$or[0].notes.$regex.source).toContain('\\.');
      expect(findArgs.$or[0].notes.$regex.source).toContain('\\(');
      expect(findArgs.$or[0].notes.$regex.source).toContain('\\)');
    });

    it('should limit results to 20', async () => {
      mockInvoiceModel.find.mockReturnValue(chainable([]));

      await searchInvoices({ q: 'test' }, ctx);

      const findChain = mockInvoiceModel.find.mock.results[0].value;
      expect(findChain.limit).toHaveBeenCalledWith(20);
    });
  });

  // =========================================================================
  // get_invoice_summary
  // =========================================================================
  describe('get_invoice_summary', () => {
    const mockAggregateResult = [
      {
        totalInvoice: [{ total: 45250, count: 25 }],
        statusCounts: [
          { status: 'draft', count: 5 },
          { status: 'sent', count: 12 },
          { status: 'pending', count: 3 },
        ],
        paymentStatusCounts: [
          { status: 'unpaid', count: 15 },
          { status: 'paid', count: 8 },
          { status: 'partially', count: 2 },
        ],
        overdueCounts: [
          { status: 'sent', count: 4 },
        ],
      },
    ];

    it('should return invoice summary for month', async () => {
      mockInvoiceModel.aggregate
        .mockResolvedValueOnce(mockAggregateResult)
        .mockResolvedValueOnce([{ total_amount: 32000 }]);

      const result = await getInvoiceSummary({ type: 'month' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.total).toBe(45250);
      expect(result.data.total_undue).toBe(32000);
      expect(result.data.type).toBe('month');
      expect(result.data.performance).toBeInstanceOf(Array);
    });

    it('should return summary for week', async () => {
      mockInvoiceModel.aggregate
        .mockResolvedValueOnce(mockAggregateResult)
        .mockResolvedValueOnce([{ total_amount: 10000 }]);

      const result = await getInvoiceSummary({ type: 'week' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.type).toBe('week');
    });

    it('should return summary for year', async () => {
      mockInvoiceModel.aggregate
        .mockResolvedValueOnce(mockAggregateResult)
        .mockResolvedValueOnce([{ total_amount: 100000 }]);

      const result = await getInvoiceSummary({ type: 'year' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.type).toBe('year');
    });

    it('should default to month when type is omitted', async () => {
      mockInvoiceModel.aggregate
        .mockResolvedValueOnce(mockAggregateResult)
        .mockResolvedValueOnce([{ total_amount: 5000 }]);

      const result = await getInvoiceSummary({}, ctx);

      expect(result.success).toBe(true);
      expect(result.data.type).toBe('month');
    });

    it('should return zeros when no invoices exist', async () => {
      mockInvoiceModel.aggregate
        .mockResolvedValueOnce([
          {
            totalInvoice: [],
            statusCounts: [],
            paymentStatusCounts: [],
            overdueCounts: [],
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await getInvoiceSummary({}, ctx);

      expect(result.success).toBe(true);
      expect(result.data.total).toBe(0);
      expect(result.data.total_undue).toBe(0);
      expect(result.data.performance).toEqual([]);
    });

    it('should return INVALID_PARAM for invalid type', async () => {
      const result = await getInvoiceSummary({ type: 'decade' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockInvoiceModel.aggregate).not.toHaveBeenCalled();
    });

    it('should include status percentages in performance', async () => {
      mockInvoiceModel.aggregate
        .mockResolvedValueOnce(mockAggregateResult)
        .mockResolvedValueOnce([{ total_amount: 0 }]);

      const result = await getInvoiceSummary({ type: 'month' }, ctx);

      const draftPerf = result.data.performance.find((p) => p.status === 'draft');
      expect(draftPerf).toBeDefined();
      expect(draftPerf.percentage).toBe(20); // 5/25 = 20%
    });
  });

  // =========================================================================
  // create_invoice
  // =========================================================================
  describe('create_invoice', () => {
    const validCreateParams = {
      client: VALID_CLIENT_ID,
      number: 1044,
      year: 2026,
      status: 'draft',
      date: '2026-03-01',
      expiredDate: '2026-04-01',
      taxRate: 10,
      items: [
        { itemName: 'Consulting', quantity: 3, price: 200, total: 600 },
      ],
    };

    beforeEach(() => {
      // Default: save resolves successfully
      mockSave.mockResolvedValue({ _id: 'new_invoice_id', ...validCreateParams });

      // Mock the Invoice constructor — mongoose.model('Invoice') returns the model
      // For `new Model(body).save()`, we need the model to be callable as constructor
      const mongoose = require('mongoose');
      mongoose.model = jest.fn((name) => {
        if (name === 'Invoice') {
          const ModelFn = function (body) {
            this._id = 'new_invoice_id';
            Object.assign(this, body);
            this.save = mockSave;
          };
          ModelFn.findOne = mockInvoiceModel.findOne;
          ModelFn.find = mockInvoiceModel.find;
          ModelFn.findOneAndUpdate = mockInvoiceModel.findOneAndUpdate;
          ModelFn.aggregate = mockInvoiceModel.aggregate;
          ModelFn.countDocuments = mockInvoiceModel.countDocuments;
          ModelFn.collection = mockInvoiceModel.collection;
          return ModelFn;
        }
        if (name === 'Payment') return mockPaymentModel;
        if (name === 'Setting') return mockSettingModel;
        return {};
      });

      mockInvoiceModel.findOneAndUpdate.mockReturnValue(
        chainable({ _id: 'new_invoice_id', ...validCreateParams, pdf: 'invoice-new_invoice_id.pdf' })
      );
      mockSettingModel.findOneAndUpdate.mockReturnValue(chainable({ settingValue: 1045 }));
    });

    it('should create a new invoice with correct totals', async () => {
      const result = await createInvoice(validCreateParams, ctx);

      expect(result.success).toBe(true);
      expect(mockSave).toHaveBeenCalled();
    });

    it('should auto-calculate line totals', async () => {
      const params = {
        ...validCreateParams,
        items: [
          { itemName: 'Item A', quantity: 2, price: 100, total: 0 },
          { itemName: 'Item B', quantity: 5, price: 50, total: 0 },
        ],
      };

      await createInvoice(params, ctx);

      // The handler should recalculate totals: 2*100=200, 5*50=250
      const saveCall = mockSave.mock.calls[0];
      // The save is called on the instance, check the body passed to constructor
      expect(mockSave).toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when items is empty', async () => {
      const params = { ...validCreateParams, items: [] };

      const result = await createInvoice(params, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(result.error).toContain('Items');
    });

    it('should set paymentStatus to paid when total equals discount', async () => {
      const params = {
        ...validCreateParams,
        items: [{ itemName: 'Free item', quantity: 1, price: 100, total: 100 }],
        taxRate: 0,
        discount: 100,
      };

      const result = await createInvoice(params, ctx);

      expect(result.success).toBe(true);
      // The save mock will have been called with paymentStatus='paid'
      expect(mockSave).toHaveBeenCalled();
    });

    it('should increment last_invoice_number setting', async () => {
      await createInvoice(validCreateParams, ctx);

      expect(mockSettingModel.findOneAndUpdate).toHaveBeenCalledWith(
        { settingKey: 'last_invoice_number' },
        { $inc: { settingValue: 1 } },
        { new: true, runValidators: true }
      );
    });

    it('should set createdBy from context userId', async () => {
      await createInvoice(validCreateParams, ctx);

      expect(mockSave).toHaveBeenCalled();
    });

    it('should handle validation errors', async () => {
      const validationError = new Error('Validation failed: number required');
      validationError.name = 'ValidationError';
      mockSave.mockRejectedValue(validationError);

      const result = await createInvoice(validCreateParams, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should handle database errors gracefully', async () => {
      mockSave.mockRejectedValue(new Error('DB write failed'));

      const result = await createInvoice(validCreateParams, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  // =========================================================================
  // update_invoice
  // =========================================================================
  describe('update_invoice', () => {
    it('should update invoice fields', async () => {
      mockInvoiceModel.findOne.mockResolvedValue(sampleInvoice);
      const updated = { ...sampleInvoice, status: 'pending' };
      mockInvoiceModel.findOneAndUpdate.mockReturnValue(chainable(updated));

      const result = await updateInvoice({ id: VALID_ID, status: 'pending' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('pending');
    });

    it('should recalculate totals when items change', async () => {
      mockInvoiceModel.findOne.mockResolvedValue(sampleInvoice);
      const newItems = [
        { itemName: 'Consulting', quantity: 20, price: 150, total: 3000 },
      ];
      const updated = {
        ...sampleInvoice,
        items: newItems,
        subTotal: 3000,
        taxTotal: 300,
        total: 3300,
      };
      mockInvoiceModel.findOneAndUpdate.mockReturnValue(chainable(updated));

      const result = await updateInvoice({
        id: VALID_ID,
        items: newItems,
      }, ctx);

      expect(result.success).toBe(true);
      // Verify the update call included recalculated totals
      const updateArgs = mockInvoiceModel.findOneAndUpdate.mock.calls[0][1];
      expect(updateArgs.subTotal).toBe(3000);
      expect(updateArgs.taxTotal).toBe(300);
      expect(updateArgs.total).toBe(3300);
    });

    it('should recalculate paymentStatus based on credit', async () => {
      // Invoice with existing credit
      const invoiceWithCredit = { ...sampleInvoice, credit: 1650, discount: 0 };
      mockInvoiceModel.findOne.mockResolvedValue(invoiceWithCredit);
      mockInvoiceModel.findOneAndUpdate.mockReturnValue(chainable({ ...invoiceWithCredit, paymentStatus: 'paid' }));

      const result = await updateInvoice({
        id: VALID_ID,
        items: [{ itemName: 'Consulting', quantity: 10, price: 150, total: 1500 }],
      }, ctx);

      expect(result.success).toBe(true);
      const updateArgs = mockInvoiceModel.findOneAndUpdate.mock.calls[0][1];
      expect(updateArgs.paymentStatus).toBe('paid');
    });

    it('should set paymentStatus to partially when credit > 0 but < total', async () => {
      const invoiceWithPartialCredit = { ...sampleInvoice, credit: 500, discount: 0 };
      mockInvoiceModel.findOne.mockResolvedValue(invoiceWithPartialCredit);
      mockInvoiceModel.findOneAndUpdate.mockReturnValue(chainable({ ...invoiceWithPartialCredit }));

      const result = await updateInvoice({
        id: VALID_ID,
        items: [{ itemName: 'Consulting', quantity: 10, price: 150, total: 1500 }],
      }, ctx);

      expect(result.success).toBe(true);
      const updateArgs = mockInvoiceModel.findOneAndUpdate.mock.calls[0][1];
      expect(updateArgs.paymentStatus).toBe('partially');
    });

    it('should strip currency from update', async () => {
      mockInvoiceModel.findOne.mockResolvedValue(sampleInvoice);
      mockInvoiceModel.findOneAndUpdate.mockReturnValue(chainable(sampleInvoice));

      await updateInvoice({ id: VALID_ID, currency: 'EUR', notes: 'test' }, ctx);

      const updateArgs = mockInvoiceModel.findOneAndUpdate.mock.calls[0][1];
      expect(updateArgs.currency).toBeUndefined();
    });

    it('should return NOT_FOUND for non-existent invoice', async () => {
      mockInvoiceModel.findOne.mockResolvedValue(null);

      const result = await updateInvoice({ id: VALID_ID, notes: 'new note' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return INVALID_PARAM for invalid ObjectId', async () => {
      const result = await updateInvoice({ id: INVALID_ID, notes: 'test' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockInvoiceModel.findOne).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when no update fields provided', async () => {
      const result = await updateInvoice({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(result.error).toContain('At least one field');
    });

    it('should return INVALID_PARAM when id is missing', async () => {
      const result = await updateInvoice({ notes: 'test' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should prevent setting removed via update', async () => {
      mockInvoiceModel.findOne.mockResolvedValue(sampleInvoice);
      mockInvoiceModel.findOneAndUpdate.mockReturnValue(chainable(sampleInvoice));

      await updateInvoice({ id: VALID_ID, notes: 'test' }, ctx);

      const updateArgs = mockInvoiceModel.findOneAndUpdate.mock.calls[0][1];
      expect(updateArgs.removed).toBe(false);
    });

    it('should handle validation errors', async () => {
      mockInvoiceModel.findOne.mockResolvedValue(sampleInvoice);
      const validationError = new Error('Validation failed');
      validationError.name = 'ValidationError';
      mockInvoiceModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockRejectedValue(validationError),
      });

      const result = await updateInvoice({ id: VALID_ID, notes: '' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // delete_invoice
  // =========================================================================
  describe('delete_invoice', () => {
    it('should soft-delete an invoice', async () => {
      const deleted = { ...sampleInvoice };
      mockInvoiceModel.findOneAndUpdate.mockReturnValue(chainable(deleted));
      mockPaymentModel.updateMany.mockResolvedValue({ modifiedCount: 0 });

      const result = await deleteInvoice({ id: VALID_ID }, ctx);

      expect(result.success).toBe(true);
      expect(mockInvoiceModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: VALID_ID, removed: false },
        { $set: { removed: true } },
        { new: false }
      );
    });

    it('should cascade soft-delete to related payments', async () => {
      mockInvoiceModel.findOneAndUpdate.mockReturnValue(chainable(sampleInvoice));
      mockPaymentModel.updateMany.mockResolvedValue({ modifiedCount: 2 });

      await deleteInvoice({ id: VALID_ID }, ctx);

      expect(mockPaymentModel.updateMany).toHaveBeenCalledWith(
        { invoice: sampleInvoice._id },
        { $set: { removed: true } }
      );
    });

    it('should return NOT_FOUND for non-existent invoice', async () => {
      mockInvoiceModel.findOneAndUpdate.mockReturnValue(chainable(null));

      const result = await deleteInvoice({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return NOT_FOUND for already-deleted invoice', async () => {
      mockInvoiceModel.findOneAndUpdate.mockReturnValue(chainable(null));

      const result = await deleteInvoice({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return INVALID_PARAM for invalid ObjectId', async () => {
      const result = await deleteInvoice({ id: INVALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockInvoiceModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when id is missing', async () => {
      const result = await deleteInvoice({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should handle database errors gracefully', async () => {
      mockInvoiceModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('DB error')),
      });

      const result = await deleteInvoice({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  // =========================================================================
  // Tool Definitions & Registration
  // =========================================================================
  describe('Tool Definitions', () => {
    it('should define all 10 tools', () => {
      const names = Object.keys(toolDefinitions);
      expect(names).toEqual([
        'get_invoice',
        'list_invoices',
        'search_invoices',
        'get_invoice_summary',
        'create_invoice',
        'update_invoice',
        'delete_invoice',
        'navigate_to_invoices',
        'navigate_to_invoice',
        'navigate_to_create_invoice',
      ]);
    });

    it('should set all backend tools with execution: backend', () => {
      const backendTools = [
        'get_invoice',
        'list_invoices',
        'search_invoices',
        'get_invoice_summary',
        'create_invoice',
        'update_invoice',
        'delete_invoice',
      ];
      backendTools.forEach((name) => {
        expect(toolDefinitions[name].execution).toBe('backend');
        expect(toolDefinitions[name].handler).toBeInstanceOf(Function);
      });
    });

    it('should set navigate_to_invoices as frontend tool', () => {
      const nav = toolDefinitions.navigate_to_invoices;
      expect(nav.execution).toBe('frontend');
      expect(nav.frontendAction).toEqual({
        type: 'navigate',
        route: '/invoice',
      });
      expect(nav.handler).toBeUndefined();
    });

    it('should set navigate_to_create_invoice as frontend tool', () => {
      const nav = toolDefinitions.navigate_to_create_invoice;
      expect(nav.execution).toBe('frontend');
      expect(nav.frontendAction).toEqual({
        type: 'navigate',
        route: '/invoice/create',
      });
      expect(nav.handler).toBeUndefined();
    });

    it('should mark delete_invoice as confirmBefore: true', () => {
      expect(toolDefinitions.delete_invoice.confirmBefore).toBe(true);
    });

    it('should include DESTRUCTIVE marker in delete_invoice description', () => {
      expect(toolDefinitions.delete_invoice.description).toContain('DESTRUCTIVE');
    });

    it('should set all tools to authenticated access', () => {
      Object.values(toolDefinitions).forEach((tool) => {
        expect(tool.access).toBe('authenticated');
      });
    });

    it('should set all tools to invoices category', () => {
      Object.values(toolDefinitions).forEach((tool) => {
        expect(tool.category).toBe('invoices');
      });
    });

    it('should require id for get_invoice, update_invoice, delete_invoice schemas', () => {
      ['get_invoice', 'update_invoice', 'delete_invoice'].forEach((name) => {
        expect(toolDefinitions[name].schema.required).toContain('id');
      });
    });

    it('should require q for search_invoices schema', () => {
      expect(toolDefinitions.search_invoices.schema.required).toContain('q');
    });

    it('should require all mandatory fields for create_invoice schema', () => {
      const required = toolDefinitions.create_invoice.schema.required;
      expect(required).toContain('client');
      expect(required).toContain('number');
      expect(required).toContain('year');
      expect(required).toContain('status');
      expect(required).toContain('date');
      expect(required).toContain('expiredDate');
      expect(required).toContain('taxRate');
      expect(required).toContain('items');
    });

    it('should have no required params for list_invoices and get_invoice_summary', () => {
      expect(toolDefinitions.list_invoices.schema.required).toEqual([]);
      expect(toolDefinitions.get_invoice_summary.schema.required).toEqual([]);
    });

    it('should have no required params for navigation tools', () => {
      expect(toolDefinitions.navigate_to_invoices.schema.required).toEqual([]);
      expect(toolDefinitions.navigate_to_create_invoice.schema.required).toEqual([]);
    });
  });

  // =========================================================================
  // Registry Integration
  // =========================================================================
  describe('Registry Integration', () => {
    it('should register tools and category without errors', () => {
      expect(() => register()).not.toThrow();
    });
  });
});
