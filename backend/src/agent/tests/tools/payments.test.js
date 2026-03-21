/**
 * Tests for Payment Tools — Phase 4
 *
 * Tests all 7 backend handlers: get_payment, list_payments, search_payments,
 * get_payment_summary, create_payment, update_payment, delete_payment.
 *
 * Also tests navigate_to_payments registration via the registry.
 */

const { mockContext, mockAdminContext, mockUnauthenticatedContext } = require('../helpers/mockContext');

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

const mockPaymentModel = {
  findOne: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
  findOneAndUpdate: jest.fn(),
  aggregate: jest.fn(),
  create: jest.fn(),
};

const mockInvoiceModel = {
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
};

jest.mock('mongoose', () => ({
  model: jest.fn((name) => {
    if (name === 'Payment') return mockPaymentModel;
    if (name === 'Invoice') return mockInvoiceModel;
    return {};
  }),
}));

// Mock @/helpers for calculate
jest.mock('@/helpers', () => ({
  calculate: {
    add: (a, b) => a + b,
    sub: (a, b) => a - b,
  },
}));

// ---------------------------------------------------------------------------
// Import handlers (after mocking)
// ---------------------------------------------------------------------------

const {
  getPayment,
  listPayments,
  searchPayments,
  getPaymentSummary,
  createPayment,
  updatePayment,
  deletePayment,
  toolDefinitions,
  register,
} = require('../../tools/payments');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_ID = '707f1f77bcf86cd799439031';
const VALID_ID_2 = '707f1f77bcf86cd799439032';
const VALID_INVOICE_ID = '607f1f77bcf86cd799439021';
const VALID_CLIENT_ID = '507f1f77bcf86cd799439011';
const INVALID_ID = 'not-a-valid-id';

const samplePayment = {
  _id: VALID_ID,
  number: 1001,
  amount: 250,
  date: new Date('2024-06-15'),
  currency: 'USD',
  ref: 'TXN-98765',
  description: 'Partial payment for web development',
  removed: false,
  client: {
    _id: VALID_CLIENT_ID,
    name: 'Acme Corporation',
    email: 'contact@acme.com',
  },
  invoice: {
    _id: VALID_INVOICE_ID,
    id: VALID_INVOICE_ID,
    number: 2001,
    total: 1000,
    discount: 0,
    credit: 250,
    paymentStatus: 'partially',
  },
  createdBy: {
    _id: '507f1f77bcf86cd799439099',
    name: 'John Admin',
  },
  created: new Date('2024-06-15'),
  updated: new Date('2024-06-15'),
};

const samplePayment2 = {
  _id: VALID_ID_2,
  number: 1002,
  amount: 500,
  date: new Date('2024-07-01'),
  currency: 'EUR',
  ref: 'TXN-12345',
  description: 'Full payment for design services',
  removed: false,
  client: {
    _id: VALID_CLIENT_ID,
    name: 'Berlin GmbH',
  },
  invoice: {
    _id: '607f1f77bcf86cd799439022',
    number: 2002,
  },
  createdBy: {
    _id: '507f1f77bcf86cd799439099',
    name: 'John Admin',
  },
};

const sampleInvoice = {
  _id: VALID_INVOICE_ID,
  number: 2001,
  total: 1000,
  discount: 0,
  credit: 250,
  paymentStatus: 'partially',
  client: {
    _id: VALID_CLIENT_ID,
  },
  removed: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Payment Tools', () => {
  let ctx;

  beforeEach(() => {
    ctx = mockContext();
    jest.clearAllMocks();
  });

  // =========================================================================
  // get_payment
  // =========================================================================
  describe('get_payment', () => {
    it('should return payment details for a valid ID', async () => {
      mockPaymentModel.findOne.mockReturnValue(chainable(samplePayment));

      const result = await getPayment({ id: VALID_ID }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.number).toBe(1001);
      expect(result.data.amount).toBe(250);
      expect(result.data.client.name).toBe('Acme Corporation');
      expect(mockPaymentModel.findOne).toHaveBeenCalledWith({
        _id: VALID_ID,
        removed: false,
      });
    });

    it('should return NOT_FOUND for non-existent payment', async () => {
      mockPaymentModel.findOne.mockReturnValue(chainable(null));

      const result = await getPayment({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return INVALID_PARAM for invalid ObjectId', async () => {
      const result = await getPayment({ id: INVALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockPaymentModel.findOne).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when id is missing', async () => {
      const result = await getPayment({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should handle database errors gracefully', async () => {
      mockPaymentModel.findOne.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('DB connection lost')),
      });

      const result = await getPayment({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.error).toContain('DB connection lost');
    });
  });

  // =========================================================================
  // list_payments
  // =========================================================================
  describe('list_payments', () => {
    it('should return paginated payment list with defaults', async () => {
      mockPaymentModel.find.mockReturnValue(chainable([samplePayment, samplePayment2]));
      mockPaymentModel.countDocuments.mockResolvedValue(2);

      const result = await listPayments({}, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.metadata.pagination).toEqual({ page: 1, pages: 1, count: 2 });
    });

    it('should return empty results when no payments exist', async () => {
      mockPaymentModel.find.mockReturnValue(chainable([]));
      mockPaymentModel.countDocuments.mockResolvedValue(0);

      const result = await listPayments({}, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
      expect(result.metadata.pagination.count).toBe(0);
    });

    it('should respect pagination parameters', async () => {
      mockPaymentModel.find.mockReturnValue(chainable([samplePayment2]));
      mockPaymentModel.countDocuments.mockResolvedValue(12);

      const result = await listPayments({ page: 2, items: 5 }, ctx);

      expect(result.success).toBe(true);
      expect(result.metadata.pagination).toEqual({ page: 2, pages: 3, count: 12 });

      const findChain = mockPaymentModel.find.mock.results[0].value;
      expect(findChain.skip).toHaveBeenCalledWith(5);
      expect(findChain.limit).toHaveBeenCalledWith(5);
    });

    it('should apply filter and equal parameters', async () => {
      mockPaymentModel.find.mockReturnValue(chainable([samplePayment]));
      mockPaymentModel.countDocuments.mockResolvedValue(1);

      const result = await listPayments({ filter: 'currency', equal: 'USD' }, ctx);

      expect(result.success).toBe(true);
      expect(mockPaymentModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'USD', removed: false })
      );
    });

    it('should reject object filter values', async () => {
      const result = await listPayments(
        { filter: 'currency', equal: { $ne: 'USD' } },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should apply text search with q and fields', async () => {
      mockPaymentModel.find.mockReturnValue(chainable([samplePayment]));
      mockPaymentModel.countDocuments.mockResolvedValue(1);

      const result = await listPayments({ q: 'TXN', fields: 'ref,description' }, ctx);

      expect(result.success).toBe(true);
      expect(mockPaymentModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          removed: false,
          $or: expect.any(Array),
        })
      );
    });

    it('should apply sorting parameters', async () => {
      mockPaymentModel.find.mockReturnValue(chainable([]));
      mockPaymentModel.countDocuments.mockResolvedValue(0);

      await listPayments({ sortBy: 'date', sortValue: -1 }, ctx);

      const findChain = mockPaymentModel.find.mock.results[0].value;
      expect(findChain.sort).toHaveBeenCalledWith({ date: -1 });
    });

    it('should handle database errors gracefully', async () => {
      mockPaymentModel.find.mockReturnValue({
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('DB error')),
      });
      mockPaymentModel.countDocuments.mockRejectedValue(new Error('DB error'));

      const result = await listPayments({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  // =========================================================================
  // search_payments
  // =========================================================================
  describe('search_payments', () => {
    it('should return matching payments by ref', async () => {
      mockPaymentModel.find.mockReturnValue(chainable([samplePayment]));

      const result = await searchPayments({ q: 'TXN-98765', fields: 'ref' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('should search across ref and description by default', async () => {
      mockPaymentModel.find.mockReturnValue(chainable([]));

      await searchPayments({ q: 'web development' }, ctx);

      const findArgs = mockPaymentModel.find.mock.calls[0][0];
      expect(findArgs.$or).toHaveLength(2);
      expect(findArgs.$or[0]).toHaveProperty('ref');
      expect(findArgs.$or[1]).toHaveProperty('description');
    });

    it('should search specified fields', async () => {
      mockPaymentModel.find.mockReturnValue(chainable([samplePayment]));

      await searchPayments({ q: 'test', fields: 'description' }, ctx);

      const findArgs = mockPaymentModel.find.mock.calls[0][0];
      expect(findArgs.$or).toHaveLength(1);
      expect(findArgs.$or[0]).toHaveProperty('description');
    });

    it('should return empty results when no match', async () => {
      mockPaymentModel.find.mockReturnValue(chainable([]));

      const result = await searchPayments({ q: 'nonexistent' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });

    it('should return INVALID_PARAM when q is missing', async () => {
      const result = await searchPayments({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockPaymentModel.find).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when q is empty whitespace', async () => {
      const result = await searchPayments({ q: '   ' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should escape special regex characters in search term', async () => {
      mockPaymentModel.find.mockReturnValue(chainable([]));

      await searchPayments({ q: 'TXN.test (special)' }, ctx);

      const findArgs = mockPaymentModel.find.mock.calls[0][0];
      expect(findArgs.$or[0].ref.$regex.source).toContain('\\.');
      expect(findArgs.$or[0].ref.$regex.source).toContain('\\(');
      expect(findArgs.$or[0].ref.$regex.source).toContain('\\)');
    });

    it('should limit results to 20', async () => {
      mockPaymentModel.find.mockReturnValue(chainable([]));

      await searchPayments({ q: 'test' }, ctx);

      const findChain = mockPaymentModel.find.mock.results[0].value;
      expect(findChain.limit).toHaveBeenCalledWith(20);
    });
  });

  // =========================================================================
  // get_payment_summary
  // =========================================================================
  describe('get_payment_summary', () => {
    it('should return payment summary for month', async () => {
      mockPaymentModel.aggregate.mockResolvedValue([{ count: 42, total: 15750 }]);

      const result = await getPaymentSummary({ type: 'month' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.count).toBe(42);
      expect(result.data.total).toBe(15750);
      expect(result.metadata.type).toBe('month');
    });

    it('should return summary for week', async () => {
      mockPaymentModel.aggregate.mockResolvedValue([{ count: 10, total: 5000 }]);

      const result = await getPaymentSummary({ type: 'week' }, ctx);

      expect(result.success).toBe(true);
      expect(result.metadata.type).toBe('week');
    });

    it('should return summary for year', async () => {
      mockPaymentModel.aggregate.mockResolvedValue([{ count: 365, total: 187500 }]);

      const result = await getPaymentSummary({ type: 'year' }, ctx);

      expect(result.success).toBe(true);
      expect(result.metadata.type).toBe('year');
    });

    it('should default to month when type is omitted', async () => {
      mockPaymentModel.aggregate.mockResolvedValue([{ count: 5, total: 2500 }]);

      const result = await getPaymentSummary({}, ctx);

      expect(result.success).toBe(true);
      expect(result.metadata.type).toBe('month');
    });

    it('should return zeros when no payments exist', async () => {
      mockPaymentModel.aggregate.mockResolvedValue([]);

      const result = await getPaymentSummary({}, ctx);

      expect(result.success).toBe(true);
      expect(result.data.count).toBe(0);
      expect(result.data.total).toBe(0);
    });

    it('should return INVALID_PARAM for invalid type', async () => {
      const result = await getPaymentSummary({ type: 'decade' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockPaymentModel.aggregate).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      mockPaymentModel.aggregate.mockRejectedValue(new Error('Aggregation failed'));

      const result = await getPaymentSummary({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  // =========================================================================
  // create_payment
  // =========================================================================
  describe('create_payment', () => {
    const validCreateParams = {
      invoice: VALID_INVOICE_ID,
      amount: 200,
      number: 1003,
    };

    const invoiceForCreate = {
      _id: VALID_INVOICE_ID,
      total: 1000,
      discount: 0,
      credit: 250,
      client: { _id: VALID_CLIENT_ID },
      removed: false,
    };

    beforeEach(() => {
      mockInvoiceModel.findOne.mockResolvedValue(invoiceForCreate);
      mockPaymentModel.create.mockResolvedValue({
        _id: 'new_payment_id',
        ...validCreateParams,
        client: VALID_CLIENT_ID,
        createdBy: ctx.userId,
      });
      mockPaymentModel.findOneAndUpdate.mockReturnValue(
        chainable({
          _id: 'new_payment_id',
          ...validCreateParams,
          pdf: 'payment-new_payment_id.pdf',
        })
      );
      mockInvoiceModel.findOneAndUpdate.mockReturnValue(chainable({ _id: VALID_INVOICE_ID }));
    });

    it('should create a payment successfully', async () => {
      const result = await createPayment(validCreateParams, ctx);

      expect(result.success).toBe(true);
      expect(mockPaymentModel.create).toHaveBeenCalled();
    });

    it('should set createdBy from context', async () => {
      await createPayment(validCreateParams, ctx);

      const createCall = mockPaymentModel.create.mock.calls[0][0];
      expect(createCall.createdBy).toBe(ctx.userId);
    });

    it('should set client from invoice', async () => {
      await createPayment(validCreateParams, ctx);

      const createCall = mockPaymentModel.create.mock.calls[0][0];
      expect(createCall.client).toBe(VALID_CLIENT_ID);
    });

    it('should update invoice credit and paymentStatus', async () => {
      await createPayment(validCreateParams, ctx);

      expect(mockInvoiceModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: VALID_INVOICE_ID },
        expect.objectContaining({
          $push: expect.any(Object),
          $inc: { credit: 200 },
          $set: { paymentStatus: 'partially' },
        }),
        expect.any(Object)
      );
    });

    it('should set paymentStatus to paid when credit equals total - discount', async () => {
      // credit=800, amount=200 => 800+200=1000 = total-discount => paid
      const invoice = { ...invoiceForCreate, credit: 800 };
      mockInvoiceModel.findOne.mockResolvedValue(invoice);

      await createPayment(validCreateParams, ctx);

      expect(mockInvoiceModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: VALID_INVOICE_ID },
        expect.objectContaining({
          $set: { paymentStatus: 'paid' },
        }),
        expect.any(Object)
      );
    });

    it('should reject amount of 0', async () => {
      const result = await createPayment({ ...validCreateParams, amount: 0 }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(result.error).toContain("Minimum Amount");
    });

    it('should reject amount exceeding invoice remaining balance', async () => {
      // maxAmount = 1000 - 0 - 250 = 750
      const result = await createPayment({ ...validCreateParams, amount: 800 }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(result.error).toContain('Max Amount');
      expect(result.error).toContain('750');
    });

    it('should return NOT_FOUND when invoice does not exist', async () => {
      mockInvoiceModel.findOne.mockResolvedValue(null);

      const result = await createPayment(validCreateParams, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should set PDF filename after creation', async () => {
      await createPayment(validCreateParams, ctx);

      expect(mockPaymentModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ removed: false }),
        { pdf: expect.stringContaining('payment-') },
        { new: true }
      );
    });

    it('should handle validation errors', async () => {
      const validationError = new Error('Validation failed: number required');
      validationError.name = 'ValidationError';
      mockPaymentModel.create.mockRejectedValue(validationError);

      const result = await createPayment(validCreateParams, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should handle database errors gracefully', async () => {
      mockPaymentModel.create.mockRejectedValue(new Error('DB write failed'));

      const result = await createPayment(validCreateParams, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  // =========================================================================
  // update_payment
  // =========================================================================
  describe('update_payment', () => {
    const paymentForUpdate = {
      ...samplePayment,
      invoice: {
        _id: VALID_INVOICE_ID,
        id: VALID_INVOICE_ID,
        number: 2001,
        total: 1000,
        discount: 0,
        credit: 250,
      },
    };

    beforeEach(() => {
      mockPaymentModel.findOne.mockResolvedValue(paymentForUpdate);
      mockPaymentModel.findOneAndUpdate.mockReturnValue(
        chainable({ ...paymentForUpdate, updated: new Date() })
      );
      mockInvoiceModel.findOneAndUpdate.mockReturnValue(chainable({ _id: VALID_INVOICE_ID }));
    });

    it('should update payment fields', async () => {
      const result = await updatePayment({ id: VALID_ID, ref: 'NEW-REF' }, ctx);

      expect(result.success).toBe(true);
      expect(mockPaymentModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: VALID_ID, removed: false },
        { $set: expect.objectContaining({ ref: 'NEW-REF' }) },
        { new: true }
      );
    });

    it('should update amount and recalculate invoice credit', async () => {
      const result = await updatePayment({ id: VALID_ID, amount: 300 }, ctx);

      expect(result.success).toBe(true);
      // changedAmount = 300 - 250 = 50
      expect(mockInvoiceModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $inc: { credit: 50 },
        }),
        expect.any(Object)
      );
    });

    it('should reject amount of 0', async () => {
      const result = await updatePayment({ id: VALID_ID, amount: 0 }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(result.error).toContain("Minimum Amount");
    });

    it('should reject amount exceeding invoice remaining balance', async () => {
      // maxAmount = 1000 - (0 + 250) = 750, so max total amount = 750 + 250 = 1000
      // changedAmount = 1100 - 250 = 850, maxAmount = 750, 850 > 750 => reject
      const result = await updatePayment({ id: VALID_ID, amount: 1100 }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(result.error).toContain('Max Amount');
    });

    it('should update paymentMode and description', async () => {
      await updatePayment(
        { id: VALID_ID, paymentMode: 'check', description: 'Updated' },
        ctx
      );

      expect(mockPaymentModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: VALID_ID, removed: false },
        {
          $set: expect.objectContaining({
            paymentMode: 'check',
            description: 'Updated',
          }),
        },
        { new: true }
      );
    });

    it('should return NOT_FOUND for non-existent payment', async () => {
      mockPaymentModel.findOne.mockResolvedValue(null);

      const result = await updatePayment({ id: VALID_ID, ref: 'test' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return INVALID_PARAM for invalid ObjectId', async () => {
      const result = await updatePayment({ id: INVALID_ID, ref: 'test' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockPaymentModel.findOne).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when no update fields provided', async () => {
      const result = await updatePayment({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(result.error).toContain('At least one field');
    });

    it('should return INVALID_PARAM when id is missing', async () => {
      const result = await updatePayment({ ref: 'test' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should handle database errors gracefully', async () => {
      mockPaymentModel.findOne.mockRejectedValue(new Error('DB error'));

      const result = await updatePayment({ id: VALID_ID, ref: 'test' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  // =========================================================================
  // delete_payment
  // =========================================================================
  describe('delete_payment', () => {
    const paymentForDelete = {
      ...samplePayment,
      invoice: {
        _id: VALID_INVOICE_ID,
        id: VALID_INVOICE_ID,
        total: 1000,
        discount: 0,
        credit: 250,
      },
    };

    beforeEach(() => {
      mockPaymentModel.findOne.mockResolvedValue(paymentForDelete);
      mockPaymentModel.findOneAndUpdate.mockReturnValue(
        chainable({ ...paymentForDelete, removed: true })
      );
      mockInvoiceModel.findOneAndUpdate.mockReturnValue(chainable({ _id: VALID_INVOICE_ID }));
    });

    it('should soft-delete a payment', async () => {
      const result = await deletePayment({ id: VALID_ID }, ctx);

      expect(result.success).toBe(true);
      expect(mockPaymentModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: VALID_ID, removed: false },
        { $set: { removed: true } },
        { new: true }
      );
    });

    it('should reverse invoice credit on delete', async () => {
      await deletePayment({ id: VALID_ID }, ctx);

      expect(mockInvoiceModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: VALID_INVOICE_ID },
        expect.objectContaining({
          $pull: { payment: VALID_ID },
          $inc: { credit: -250 },
        }),
        expect.any(Object)
      );
    });

    it('should recalculate invoice paymentStatus to unpaid when credit becomes 0', async () => {
      await deletePayment({ id: VALID_ID }, ctx);

      // credit (250) - amount (250) = 0 => unpaid
      expect(mockInvoiceModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $set: { paymentStatus: 'unpaid' },
        }),
        expect.any(Object)
      );
    });

    it('should set paymentStatus to partially when remaining credit > 0', async () => {
      const paymentWithMoreCredit = {
        ...paymentForDelete,
        amount: 100,
        invoice: {
          ...paymentForDelete.invoice,
          credit: 500,
        },
      };
      mockPaymentModel.findOne.mockResolvedValue(paymentWithMoreCredit);
      mockPaymentModel.findOneAndUpdate.mockReturnValue(
        chainable({ ...paymentWithMoreCredit, removed: true })
      );

      await deletePayment({ id: VALID_ID }, ctx);

      // credit (500) - amount (100) = 400 > 0 => partially
      expect(mockInvoiceModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $set: { paymentStatus: 'partially' },
        }),
        expect.any(Object)
      );
    });

    it('should return NOT_FOUND for non-existent payment', async () => {
      mockPaymentModel.findOne.mockResolvedValue(null);

      const result = await deletePayment({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return INVALID_PARAM for invalid ObjectId', async () => {
      const result = await deletePayment({ id: INVALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockPaymentModel.findOne).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when id is missing', async () => {
      const result = await deletePayment({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should handle database errors gracefully', async () => {
      mockPaymentModel.findOne.mockRejectedValue(new Error('DB error'));

      const result = await deletePayment({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  // =========================================================================
  // Tool Definitions & Registration
  // =========================================================================
  describe('Tool Definitions', () => {
    it('should define all 8 tools', () => {
      const names = Object.keys(toolDefinitions);
      expect(names).toEqual([
        'get_payment',
        'list_payments',
        'search_payments',
        'get_payment_summary',
        'create_payment',
        'update_payment',
        'delete_payment',
        'navigate_to_payments',
      ]);
    });

    it('should set all backend tools with execution: backend', () => {
      const backendTools = [
        'get_payment',
        'list_payments',
        'search_payments',
        'get_payment_summary',
        'create_payment',
        'update_payment',
        'delete_payment',
      ];
      backendTools.forEach((name) => {
        expect(toolDefinitions[name].execution).toBe('backend');
        expect(toolDefinitions[name].handler).toBeInstanceOf(Function);
      });
    });

    it('should set navigate_to_payments as frontend tool', () => {
      const nav = toolDefinitions.navigate_to_payments;
      expect(nav.execution).toBe('frontend');
      expect(nav.frontendAction).toEqual({
        type: 'navigate',
        route: '/payment',
      });
      expect(nav.handler).toBeUndefined();
    });

    it('should mark delete_payment as confirmBefore: true', () => {
      expect(toolDefinitions.delete_payment.confirmBefore).toBe(true);
    });

    it('should include DESTRUCTIVE marker in delete_payment description', () => {
      expect(toolDefinitions.delete_payment.description).toContain('DESTRUCTIVE');
    });

    it('should set all tools to authenticated access', () => {
      Object.values(toolDefinitions).forEach((tool) => {
        expect(tool.access).toBe('authenticated');
      });
    });

    it('should set all tools to payments category', () => {
      Object.values(toolDefinitions).forEach((tool) => {
        expect(tool.category).toBe('payments');
      });
    });

    it('should require id for get_payment, update_payment, delete_payment schemas', () => {
      ['get_payment', 'update_payment', 'delete_payment'].forEach((name) => {
        expect(toolDefinitions[name].schema.required).toContain('id');
      });
    });

    it('should require q for search_payments schema', () => {
      expect(toolDefinitions.search_payments.schema.required).toContain('q');
    });

    it('should require invoice, amount, number for create_payment schema', () => {
      const required = toolDefinitions.create_payment.schema.required;
      expect(required).toContain('invoice');
      expect(required).toContain('amount');
      expect(required).toContain('number');
    });

    it('should have no required params for list_payments and get_payment_summary', () => {
      expect(toolDefinitions.list_payments.schema.required).toEqual([]);
      expect(toolDefinitions.get_payment_summary.schema.required).toEqual([]);
    });

    it('should have no required params for navigation tool', () => {
      expect(toolDefinitions.navigate_to_payments.schema.required).toEqual([]);
    });

    it('should default search fields to ref,description', () => {
      const fieldsParam = toolDefinitions.search_payments.schema.properties.fields;
      expect(fieldsParam.default).toBe('ref,description');
    });

    it('should default summary type to month', () => {
      const typeParam = toolDefinitions.get_payment_summary.schema.properties.type;
      expect(typeParam.default).toBe('month');
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
