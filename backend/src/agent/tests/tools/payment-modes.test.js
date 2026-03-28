/**
 * Tests for Payment Mode Tools
 *
 * Tests all 6 backend handlers: get_payment_mode, list_payment_modes,
 * search_payment_modes, create_payment_mode, update_payment_mode, delete_payment_mode.
 *
 * Also tests navigate_to_payment_modes registration via the registry.
 */

const { mockContext } = require('../helpers/mockContext');

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

const mockPaymentModeModel = {
  findOne: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
  findOneAndUpdate: jest.fn(),
  create: jest.fn(),
};

jest.mock('mongoose', () => ({
  model: jest.fn((name) => {
    if (name === 'PaymentMode') return mockPaymentModeModel;
    return {};
  }),
}));

// ---------------------------------------------------------------------------
// Import handlers (after mocking)
// ---------------------------------------------------------------------------

const {
  getPaymentMode,
  listPaymentModes,
  searchPaymentModes,
  createPaymentMode,
  updatePaymentMode,
  deletePaymentMode,
  toolDefinitions,
} = require('../../tools/payment-modes');

const VALID_ID = '507f1f77bcf86cd799439011';
const INVALID_ID = 'not-valid';
const ctx = mockContext();

const samplePaymentMode = {
  _id: VALID_ID,
  name: 'Bank Transfer',
  description: 'Direct bank wire transfer',
  enabled: true,
  isDefault: true,
  removed: false,
  created: new Date('2024-05-20'),
  updated: new Date('2024-05-20'),
};

const samplePaymentMode2 = {
  _id: '507f1f77bcf86cd799439012',
  name: 'Cash',
  description: 'Cash payment',
  enabled: true,
  isDefault: false,
  removed: false,
  created: new Date('2024-05-21'),
  updated: new Date('2024-05-21'),
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default: findOne returns chainable with null exec result for update/delete pre-checks
  mockPaymentModeModel.findOne.mockReturnValue(chainable(samplePaymentMode));
  mockPaymentModeModel.findOneAndUpdate.mockReturnValue(chainable(samplePaymentMode));
});

// =========================================================================
// get_payment_mode
// =========================================================================

describe('get_payment_mode', () => {
  it('should return payment mode for valid ID', async () => {
    mockPaymentModeModel.findOne.mockReturnValue(chainable(samplePaymentMode));
    const result = await getPaymentMode({ id: VALID_ID });
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('Bank Transfer');
  });

  it('should return NOT_FOUND for non-existent ID', async () => {
    mockPaymentModeModel.findOne.mockReturnValue(chainable(null));
    const result = await getPaymentMode({ id: VALID_ID });
    expect(result.success).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
  });

  it('should return INVALID_PARAM for missing ID', async () => {
    const result = await getPaymentMode({});
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should return INVALID_PARAM for malformed ID', async () => {
    const result = await getPaymentMode({ id: INVALID_ID });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should handle database errors', async () => {
    mockPaymentModeModel.findOne.mockReturnValue({
      exec: jest.fn().mockRejectedValue(new Error('DB error')),
    });
    const result = await getPaymentMode({ id: VALID_ID });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INTERNAL_ERROR');
  });
});

// =========================================================================
// list_payment_modes
// =========================================================================

describe('list_payment_modes', () => {
  it('should return paginated list', async () => {
    mockPaymentModeModel.find.mockReturnValue(chainable([samplePaymentMode, samplePaymentMode2]));
    mockPaymentModeModel.countDocuments.mockResolvedValue(2);

    const result = await listPaymentModes({});
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.metadata.pagination.count).toBe(2);
  });

  it('should return empty list when no payment modes', async () => {
    mockPaymentModeModel.find.mockReturnValue(chainable([]));
    mockPaymentModeModel.countDocuments.mockResolvedValue(0);

    const result = await listPaymentModes({});
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(0);
    expect(result.metadata.pagination.count).toBe(0);
  });

  it('should respect pagination params', async () => {
    mockPaymentModeModel.find.mockReturnValue(chainable([samplePaymentMode2]));
    mockPaymentModeModel.countDocuments.mockResolvedValue(12);

    const result = await listPaymentModes({ page: 2, items: 5 });
    expect(result.success).toBe(true);
    expect(result.metadata.pagination.page).toBe(2);

    const findChain = mockPaymentModeModel.find.mock.results[0].value;
    expect(findChain.skip).toHaveBeenCalledWith(5);
    expect(findChain.limit).toHaveBeenCalledWith(5);
  });

  it('should apply filter+equal', async () => {
    mockPaymentModeModel.find.mockReturnValue(chainable([samplePaymentMode]));
    mockPaymentModeModel.countDocuments.mockResolvedValue(1);

    const result = await listPaymentModes({ filter: 'enabled', equal: 'true' });
    expect(result.success).toBe(true);
    expect(mockPaymentModeModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: 'true', removed: false })
    );
  });

  it('should reject object filter values', async () => {
    const result = await listPaymentModes({ filter: 'enabled', equal: { $gt: '' } });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should handle database errors', async () => {
    mockPaymentModeModel.find.mockReturnValue({
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockRejectedValue(new Error('DB error')),
    });
    mockPaymentModeModel.countDocuments.mockRejectedValue(new Error('DB error'));

    const result = await listPaymentModes({});
    expect(result.success).toBe(false);
    expect(result.code).toBe('INTERNAL_ERROR');
  });
});

// =========================================================================
// search_payment_modes
// =========================================================================

describe('search_payment_modes', () => {
  it('should return matching payment modes', async () => {
    mockPaymentModeModel.find.mockReturnValue(chainable([samplePaymentMode]));

    const result = await searchPaymentModes({ q: 'bank' });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it('should return empty array for no matches', async () => {
    mockPaymentModeModel.find.mockReturnValue(chainable([]));

    const result = await searchPaymentModes({ q: 'nonexistent' });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(0);
  });

  it('should search across name and description', async () => {
    mockPaymentModeModel.find.mockReturnValue(chainable([]));

    await searchPaymentModes({ q: 'wire' });
    const findArgs = mockPaymentModeModel.find.mock.calls[0][0];
    expect(findArgs.$or).toHaveLength(2);
    expect(findArgs.$or[0]).toHaveProperty('name');
    expect(findArgs.$or[1]).toHaveProperty('description');
  });

  it('should return INVALID_PARAM for missing query', async () => {
    const result = await searchPaymentModes({});
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should return INVALID_PARAM for empty string query', async () => {
    const result = await searchPaymentModes({ q: '   ' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should escape regex special characters', async () => {
    mockPaymentModeModel.find.mockReturnValue(chainable([]));

    await searchPaymentModes({ q: 'test.*+' });
    const findArgs = mockPaymentModeModel.find.mock.calls[0][0];
    // The regex should have escaped the special chars
    expect(findArgs.$or[0].name.$regex.source).toContain('\\.');
    expect(findArgs.$or[0].name.$regex.source).toContain('\\*');
    expect(findArgs.$or[0].name.$regex.source).toContain('\\+');
  });

  it('should handle database errors', async () => {
    mockPaymentModeModel.find.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = await searchPaymentModes({ q: 'bank' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INTERNAL_ERROR');
  });
});

// =========================================================================
// create_payment_mode
// =========================================================================

describe('create_payment_mode', () => {
  it('should create payment mode with name only', async () => {
    mockPaymentModeModel.create.mockResolvedValue({
      _id: '664c3d4e5f6a7b8c9d0e1f2a',
      name: 'Credit Card',
      enabled: true,
      isDefault: false,
      removed: false,
    });

    const result = await createPaymentMode({ name: 'Credit Card' }, ctx);
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('Credit Card');
    expect(mockPaymentModeModel.create).toHaveBeenCalledWith({ name: 'Credit Card' });
  });

  it('should create payment mode with all fields', async () => {
    mockPaymentModeModel.create.mockResolvedValue({
      _id: '664c3d4e5f6a7b8c9d0e1f2a',
      name: 'Check',
      description: 'Payment by check',
      enabled: false,
      isDefault: true,
      removed: false,
    });

    const result = await createPaymentMode(
      { name: 'Check', description: 'Payment by check', enabled: false, isDefault: true },
      ctx
    );
    expect(result.success).toBe(true);
    const createCall = mockPaymentModeModel.create.mock.calls[0][0];
    expect(createCall.name).toBe('Check');
    expect(createCall.description).toBe('Payment by check');
    expect(createCall.enabled).toBe(false);
    expect(createCall.isDefault).toBe(true);
  });

  it('should return INVALID_PARAM for missing name', async () => {
    const result = await createPaymentMode({}, ctx);
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should return INVALID_PARAM for empty name', async () => {
    const result = await createPaymentMode({ name: '   ' }, ctx);
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should trim the name', async () => {
    mockPaymentModeModel.create.mockResolvedValue({ name: 'Wire Transfer' });

    await createPaymentMode({ name: '  Wire Transfer  ' }, ctx);
    const createCall = mockPaymentModeModel.create.mock.calls[0][0];
    expect(createCall.name).toBe('Wire Transfer');
  });

  it('should return VALIDATION_ERROR on mongoose validation failure', async () => {
    const validationError = new Error('Validation failed');
    validationError.name = 'ValidationError';
    mockPaymentModeModel.create.mockRejectedValue(validationError);

    const result = await createPaymentMode({ name: 'Bad Mode' }, ctx);
    expect(result.success).toBe(false);
    expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('should handle database errors', async () => {
    mockPaymentModeModel.create.mockRejectedValue(new Error('DB write failed'));

    const result = await createPaymentMode({ name: 'Test' }, ctx);
    expect(result.success).toBe(false);
    expect(result.code).toBe('INTERNAL_ERROR');
  });
});

// =========================================================================
// update_payment_mode
// =========================================================================

describe('update_payment_mode', () => {
  it('should update payment mode name', async () => {
    mockPaymentModeModel.findOneAndUpdate.mockReturnValue(
      chainable({ ...samplePaymentMode, name: 'Wire Transfer' })
    );

    const result = await updatePaymentMode({ id: VALID_ID, name: 'Wire Transfer' });
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('Wire Transfer');
    expect(mockPaymentModeModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: VALID_ID, removed: false },
      { $set: expect.objectContaining({ name: 'Wire Transfer' }) },
      { new: true, runValidators: true }
    );
  });

  it('should update multiple fields', async () => {
    mockPaymentModeModel.findOneAndUpdate.mockReturnValue(
      chainable({ ...samplePaymentMode, name: 'Updated', enabled: false })
    );

    const result = await updatePaymentMode({
      id: VALID_ID,
      name: 'Updated',
      description: 'New description',
      enabled: false,
      isDefault: true,
    });
    expect(result.success).toBe(true);
    expect(mockPaymentModeModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: VALID_ID, removed: false },
      {
        $set: expect.objectContaining({
          name: 'Updated',
          description: 'New description',
          enabled: false,
          isDefault: true,
        }),
      },
      { new: true, runValidators: true }
    );
  });

  it('should return NOT_FOUND for non-existent ID', async () => {
    mockPaymentModeModel.findOneAndUpdate.mockReturnValue(chainable(null));

    const result = await updatePaymentMode({ id: VALID_ID, name: 'Updated' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
  });

  it('should return INVALID_PARAM for missing ID', async () => {
    const result = await updatePaymentMode({ name: 'Updated' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should return INVALID_PARAM for invalid ID', async () => {
    const result = await updatePaymentMode({ id: INVALID_ID, name: 'Updated' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should return INVALID_PARAM when no update fields provided', async () => {
    const result = await updatePaymentMode({ id: VALID_ID });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
    expect(result.error).toContain('No fields to update');
  });

  it('should handle database errors', async () => {
    mockPaymentModeModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = await updatePaymentMode({ id: VALID_ID, name: 'Updated' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INTERNAL_ERROR');
  });
});

// =========================================================================
// delete_payment_mode
// =========================================================================

describe('delete_payment_mode', () => {
  it('should soft-delete payment mode', async () => {
    mockPaymentModeModel.findOne.mockReturnValue(chainable(samplePaymentMode));
    mockPaymentModeModel.findOneAndUpdate.mockReturnValue(
      chainable({ ...samplePaymentMode, removed: true, enabled: false })
    );

    const result = await deletePaymentMode({ id: VALID_ID });
    expect(result.success).toBe(true);
    expect(result.data.removed).toBe(true);
    expect(mockPaymentModeModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: VALID_ID },
      { $set: expect.objectContaining({ removed: true, enabled: false }) },
      { new: true }
    );
  });

  it('should return NOT_FOUND for non-existent ID', async () => {
    mockPaymentModeModel.findOne.mockReturnValue(chainable(null));

    const result = await deletePaymentMode({ id: VALID_ID });
    expect(result.success).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
  });

  it('should return INVALID_PARAM for missing ID', async () => {
    const result = await deletePaymentMode({});
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should return INVALID_PARAM for invalid ID', async () => {
    const result = await deletePaymentMode({ id: INVALID_ID });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should handle database errors', async () => {
    mockPaymentModeModel.findOne.mockReturnValue({
      exec: jest.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = await deletePaymentMode({ id: VALID_ID });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INTERNAL_ERROR');
  });
});

// =========================================================================
// Tool Definitions
// =========================================================================

describe('tool definitions', () => {
  it('should define all 7 tools', () => {
    const names = Object.keys(toolDefinitions);
    expect(names).toEqual([
      'get_payment_mode',
      'list_payment_modes',
      'search_payment_modes',
      'create_payment_mode',
      'update_payment_mode',
      'delete_payment_mode',
      'navigate_to_payment_modes',
    ]);
  });

  it('should have correct category for all tools', () => {
    Object.values(toolDefinitions).forEach((tool) => {
      expect(tool.category).toBe('payment_modes');
    });
  });

  it('should have backend execution for CRUD tools', () => {
    ['get_payment_mode', 'list_payment_modes', 'search_payment_modes',
     'create_payment_mode', 'update_payment_mode', 'delete_payment_mode'].forEach((name) => {
      expect(toolDefinitions[name].execution).toBe('backend');
    });
  });

  it('should have frontend execution for navigation tool', () => {
    expect(toolDefinitions.navigate_to_payment_modes.execution).toBe('frontend');
    expect(toolDefinitions.navigate_to_payment_modes.frontendAction.type).toBe('navigate');
    expect(toolDefinitions.navigate_to_payment_modes.frontendAction.route).toBe('/payment/mode');
  });

  it('should mark delete as confirmBefore', () => {
    expect(toolDefinitions.delete_payment_mode.confirmBefore).toBe(true);
  });

  it('should have handler for all backend tools', () => {
    ['get_payment_mode', 'list_payment_modes', 'search_payment_modes',
     'create_payment_mode', 'update_payment_mode', 'delete_payment_mode'].forEach((name) => {
      expect(typeof toolDefinitions[name].handler).toBe('function');
    });
  });

  it('should NOT have handler for navigation tool', () => {
    expect(toolDefinitions.navigate_to_payment_modes.handler).toBeUndefined();
  });

  it('should require name for create_payment_mode', () => {
    expect(toolDefinitions.create_payment_mode.schema.required).toContain('name');
  });

  it('should require id for get, update, delete', () => {
    expect(toolDefinitions.get_payment_mode.schema.required).toContain('id');
    expect(toolDefinitions.update_payment_mode.schema.required).toContain('id');
    expect(toolDefinitions.delete_payment_mode.schema.required).toContain('id');
  });

  it('should require q for search_payment_modes', () => {
    expect(toolDefinitions.search_payment_modes.schema.required).toContain('q');
  });
});
