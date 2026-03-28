/**
 * Tests for Tax Tools
 *
 * Tests all 6 backend handlers: get_tax, list_taxes,
 * search_taxes, create_tax, update_tax, delete_tax.
 *
 * Also tests navigate_to_taxes registration via the registry.
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

const mockTaxesModel = {
  findOne: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
  findOneAndUpdate: jest.fn(),
  create: jest.fn(),
};

jest.mock('mongoose', () => ({
  model: jest.fn((name) => {
    if (name === 'Taxes') return mockTaxesModel;
    return {};
  }),
}));

// ---------------------------------------------------------------------------
// Import handlers (after mocking)
// ---------------------------------------------------------------------------

const {
  getTax,
  listTaxes,
  searchTaxes,
  createTax,
  updateTax,
  deleteTax,
  toolDefinitions,
} = require('../../tools/taxes');

const VALID_ID = '507f1f77bcf86cd799439011';
const INVALID_ID = 'not-valid';
const ctx = mockContext();

const sampleTax = {
  _id: VALID_ID,
  taxName: 'VAT',
  taxValue: '20',
  enabled: true,
  isDefault: true,
  removed: false,
  created: new Date('2024-05-20'),
  updated: new Date('2024-05-20'),
};

const sampleTax2 = {
  _id: '507f1f77bcf86cd799439012',
  taxName: 'Sales Tax',
  taxValue: '10',
  enabled: true,
  isDefault: false,
  removed: false,
  created: new Date('2024-05-21'),
  updated: new Date('2024-05-21'),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockTaxesModel.findOne.mockReturnValue(chainable(sampleTax));
  mockTaxesModel.findOneAndUpdate.mockReturnValue(chainable(sampleTax));
});

// =========================================================================
// get_tax
// =========================================================================

describe('get_tax', () => {
  it('should return tax for valid ID', async () => {
    mockTaxesModel.findOne.mockReturnValue(chainable(sampleTax));
    const result = await getTax({ id: VALID_ID });
    expect(result.success).toBe(true);
    expect(result.data.taxName).toBe('VAT');
    expect(result.data.taxValue).toBe('20');
  });

  it('should return NOT_FOUND for non-existent ID', async () => {
    mockTaxesModel.findOne.mockReturnValue(chainable(null));
    const result = await getTax({ id: VALID_ID });
    expect(result.success).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
  });

  it('should return INVALID_PARAM for missing ID', async () => {
    const result = await getTax({});
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should return INVALID_PARAM for malformed ID', async () => {
    const result = await getTax({ id: INVALID_ID });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should handle database errors', async () => {
    mockTaxesModel.findOne.mockReturnValue({
      exec: jest.fn().mockRejectedValue(new Error('DB error')),
    });
    const result = await getTax({ id: VALID_ID });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INTERNAL_ERROR');
  });
});

// =========================================================================
// list_taxes
// =========================================================================

describe('list_taxes', () => {
  it('should return paginated list', async () => {
    mockTaxesModel.find.mockReturnValue(chainable([sampleTax, sampleTax2]));
    mockTaxesModel.countDocuments.mockResolvedValue(2);

    const result = await listTaxes({});
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.metadata.pagination.count).toBe(2);
  });

  it('should return empty list when no taxes', async () => {
    mockTaxesModel.find.mockReturnValue(chainable([]));
    mockTaxesModel.countDocuments.mockResolvedValue(0);

    const result = await listTaxes({});
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(0);
  });

  it('should respect pagination params', async () => {
    mockTaxesModel.find.mockReturnValue(chainable([sampleTax2]));
    mockTaxesModel.countDocuments.mockResolvedValue(12);

    const result = await listTaxes({ page: 2, items: 5 });
    expect(result.success).toBe(true);
    expect(result.metadata.pagination.page).toBe(2);

    const findChain = mockTaxesModel.find.mock.results[0].value;
    expect(findChain.skip).toHaveBeenCalledWith(5);
    expect(findChain.limit).toHaveBeenCalledWith(5);
  });

  it('should apply filter+equal', async () => {
    mockTaxesModel.find.mockReturnValue(chainable([sampleTax]));
    mockTaxesModel.countDocuments.mockResolvedValue(1);

    await listTaxes({ filter: 'enabled', equal: 'true' });
    expect(mockTaxesModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: 'true', removed: false })
    );
  });

  it('should reject object filter values', async () => {
    const result = await listTaxes({ filter: 'enabled', equal: { $gt: '' } });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should handle database errors', async () => {
    mockTaxesModel.find.mockReturnValue({
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockRejectedValue(new Error('DB error')),
    });
    mockTaxesModel.countDocuments.mockRejectedValue(new Error('DB error'));

    const result = await listTaxes({});
    expect(result.success).toBe(false);
    expect(result.code).toBe('INTERNAL_ERROR');
  });
});

// =========================================================================
// search_taxes
// =========================================================================

describe('search_taxes', () => {
  it('should return matching taxes', async () => {
    mockTaxesModel.find.mockReturnValue(chainable([sampleTax]));

    const result = await searchTaxes({ q: 'vat' });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it('should return empty array for no matches', async () => {
    mockTaxesModel.find.mockReturnValue(chainable([]));

    const result = await searchTaxes({ q: 'nonexistent' });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(0);
  });

  it('should search on taxName field', async () => {
    mockTaxesModel.find.mockReturnValue(chainable([]));

    await searchTaxes({ q: 'sales' });
    const findArgs = mockTaxesModel.find.mock.calls[0][0];
    expect(findArgs).toHaveProperty('taxName');
    expect(findArgs.taxName).toHaveProperty('$regex');
  });

  it('should return INVALID_PARAM for missing query', async () => {
    const result = await searchTaxes({});
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should return INVALID_PARAM for empty string query', async () => {
    const result = await searchTaxes({ q: '   ' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should escape regex special characters', async () => {
    mockTaxesModel.find.mockReturnValue(chainable([]));

    await searchTaxes({ q: 'test.*+' });
    const findArgs = mockTaxesModel.find.mock.calls[0][0];
    expect(findArgs.taxName.$regex.source).toContain('\\.');
    expect(findArgs.taxName.$regex.source).toContain('\\*');
    expect(findArgs.taxName.$regex.source).toContain('\\+');
  });

  it('should handle database errors', async () => {
    mockTaxesModel.find.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = await searchTaxes({ q: 'vat' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INTERNAL_ERROR');
  });
});

// =========================================================================
// create_tax
// =========================================================================

describe('create_tax', () => {
  it('should create tax with required fields', async () => {
    mockTaxesModel.create.mockResolvedValue({
      _id: '664c3d4e5f6a7b8c9d0e1f2a',
      taxName: 'GST',
      taxValue: '18',
      enabled: true,
      isDefault: false,
      removed: false,
    });

    const result = await createTax({ taxName: 'GST', taxValue: '18' });
    expect(result.success).toBe(true);
    expect(result.data.taxName).toBe('GST');
    expect(mockTaxesModel.create).toHaveBeenCalledWith({ taxName: 'GST', taxValue: '18' });
  });

  it('should create tax with all fields', async () => {
    mockTaxesModel.create.mockResolvedValue({
      _id: '664c3d4e5f6a7b8c9d0e1f2a',
      taxName: 'Custom Tax',
      taxValue: '5',
      enabled: false,
      isDefault: true,
      removed: false,
    });

    const result = await createTax(
      { taxName: 'Custom Tax', taxValue: '5', enabled: false, isDefault: true }
    );
    expect(result.success).toBe(true);
    const createCall = mockTaxesModel.create.mock.calls[0][0];
    expect(createCall.taxName).toBe('Custom Tax');
    expect(createCall.taxValue).toBe('5');
    expect(createCall.enabled).toBe(false);
    expect(createCall.isDefault).toBe(true);
  });

  it('should return INVALID_PARAM for missing taxName', async () => {
    const result = await createTax({ taxValue: '20' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
    expect(result.error).toContain('name');
  });

  it('should return INVALID_PARAM for missing taxValue', async () => {
    const result = await createTax({ taxName: 'VAT' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
    expect(result.error).toContain('value');
  });

  it('should return INVALID_PARAM for empty taxName', async () => {
    const result = await createTax({ taxName: '   ', taxValue: '10' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should return INVALID_PARAM for empty taxValue', async () => {
    const result = await createTax({ taxName: 'VAT', taxValue: '' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should trim the taxName', async () => {
    mockTaxesModel.create.mockResolvedValue({ taxName: 'GST', taxValue: '18' });

    await createTax({ taxName: '  GST  ', taxValue: '18' });
    const createCall = mockTaxesModel.create.mock.calls[0][0];
    expect(createCall.taxName).toBe('GST');
  });

  it('should coerce taxValue to string', async () => {
    mockTaxesModel.create.mockResolvedValue({ taxName: 'VAT', taxValue: '20' });

    await createTax({ taxName: 'VAT', taxValue: 20 });
    const createCall = mockTaxesModel.create.mock.calls[0][0];
    expect(createCall.taxValue).toBe('20');
  });

  it('should return VALIDATION_ERROR on mongoose validation failure', async () => {
    const validationError = new Error('Validation failed');
    validationError.name = 'ValidationError';
    mockTaxesModel.create.mockRejectedValue(validationError);

    const result = await createTax({ taxName: 'Bad', taxValue: '0' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('should handle database errors', async () => {
    mockTaxesModel.create.mockRejectedValue(new Error('DB write failed'));

    const result = await createTax({ taxName: 'Test', taxValue: '10' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INTERNAL_ERROR');
  });
});

// =========================================================================
// update_tax
// =========================================================================

describe('update_tax', () => {
  it('should update tax name', async () => {
    mockTaxesModel.findOneAndUpdate.mockReturnValue(
      chainable({ ...sampleTax, taxName: 'VAT Updated' })
    );

    const result = await updateTax({ id: VALID_ID, taxName: 'VAT Updated' });
    expect(result.success).toBe(true);
    expect(result.data.taxName).toBe('VAT Updated');
    expect(mockTaxesModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: VALID_ID, removed: false },
      { $set: expect.objectContaining({ taxName: 'VAT Updated' }) },
      { new: true, runValidators: true }
    );
  });

  it('should update multiple fields', async () => {
    mockTaxesModel.findOneAndUpdate.mockReturnValue(
      chainable({ ...sampleTax, taxName: 'Updated', taxValue: '25' })
    );

    await updateTax({
      id: VALID_ID,
      taxName: 'Updated',
      taxValue: '25',
      enabled: false,
      isDefault: true,
    });
    expect(mockTaxesModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: VALID_ID, removed: false },
      {
        $set: expect.objectContaining({
          taxName: 'Updated',
          taxValue: '25',
          enabled: false,
          isDefault: true,
        }),
      },
      { new: true, runValidators: true }
    );
  });

  it('should coerce taxValue to string', async () => {
    mockTaxesModel.findOneAndUpdate.mockReturnValue(chainable({ ...sampleTax, taxValue: '25' }));

    await updateTax({ id: VALID_ID, taxValue: 25 });
    expect(mockTaxesModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: VALID_ID, removed: false },
      { $set: expect.objectContaining({ taxValue: '25' }) },
      { new: true, runValidators: true }
    );
  });

  it('should return NOT_FOUND for non-existent ID', async () => {
    mockTaxesModel.findOneAndUpdate.mockReturnValue(chainable(null));

    const result = await updateTax({ id: VALID_ID, taxName: 'Updated' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
  });

  it('should return INVALID_PARAM for missing ID', async () => {
    const result = await updateTax({ taxName: 'Updated' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should return INVALID_PARAM for invalid ID', async () => {
    const result = await updateTax({ id: INVALID_ID, taxName: 'Updated' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should return INVALID_PARAM when no update fields provided', async () => {
    const result = await updateTax({ id: VALID_ID });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
    expect(result.error).toContain('No fields to update');
  });

  it('should handle database errors', async () => {
    mockTaxesModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = await updateTax({ id: VALID_ID, taxName: 'Updated' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INTERNAL_ERROR');
  });
});

// =========================================================================
// delete_tax
// =========================================================================

describe('delete_tax', () => {
  it('should soft-delete tax', async () => {
    mockTaxesModel.findOne.mockReturnValue(chainable(sampleTax));
    mockTaxesModel.findOneAndUpdate.mockReturnValue(
      chainable({ ...sampleTax, removed: true, enabled: false })
    );

    const result = await deleteTax({ id: VALID_ID });
    expect(result.success).toBe(true);
    expect(result.data.removed).toBe(true);
    expect(mockTaxesModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: VALID_ID },
      { $set: expect.objectContaining({ removed: true, enabled: false }) },
      { new: true }
    );
  });

  it('should return NOT_FOUND for non-existent ID', async () => {
    mockTaxesModel.findOne.mockReturnValue(chainable(null));

    const result = await deleteTax({ id: VALID_ID });
    expect(result.success).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
  });

  it('should return INVALID_PARAM for missing ID', async () => {
    const result = await deleteTax({});
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should return INVALID_PARAM for invalid ID', async () => {
    const result = await deleteTax({ id: INVALID_ID });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  it('should handle database errors', async () => {
    mockTaxesModel.findOne.mockReturnValue({
      exec: jest.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = await deleteTax({ id: VALID_ID });
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
      'get_tax',
      'list_taxes',
      'search_taxes',
      'create_tax',
      'update_tax',
      'delete_tax',
      'navigate_to_taxes',
    ]);
  });

  it('should have correct category for all tools', () => {
    Object.values(toolDefinitions).forEach((tool) => {
      expect(tool.category).toBe('taxes');
    });
  });

  it('should have backend execution for CRUD tools', () => {
    ['get_tax', 'list_taxes', 'search_taxes',
     'create_tax', 'update_tax', 'delete_tax'].forEach((name) => {
      expect(toolDefinitions[name].execution).toBe('backend');
    });
  });

  it('should have frontend execution for navigation tool', () => {
    expect(toolDefinitions.navigate_to_taxes.execution).toBe('frontend');
    expect(toolDefinitions.navigate_to_taxes.frontendAction.type).toBe('navigate');
    expect(toolDefinitions.navigate_to_taxes.frontendAction.route).toBe('/taxes');
  });

  it('should mark delete as confirmBefore', () => {
    expect(toolDefinitions.delete_tax.confirmBefore).toBe(true);
  });

  it('should have handler for all backend tools', () => {
    ['get_tax', 'list_taxes', 'search_taxes',
     'create_tax', 'update_tax', 'delete_tax'].forEach((name) => {
      expect(typeof toolDefinitions[name].handler).toBe('function');
    });
  });

  it('should NOT have handler for navigation tool', () => {
    expect(toolDefinitions.navigate_to_taxes.handler).toBeUndefined();
  });

  it('should require taxName and taxValue for create_tax', () => {
    expect(toolDefinitions.create_tax.schema.required).toContain('taxName');
    expect(toolDefinitions.create_tax.schema.required).toContain('taxValue');
  });

  it('should require id for get, update, delete', () => {
    expect(toolDefinitions.get_tax.schema.required).toContain('id');
    expect(toolDefinitions.update_tax.schema.required).toContain('id');
    expect(toolDefinitions.delete_tax.schema.required).toContain('id');
  });

  it('should require q for search_taxes', () => {
    expect(toolDefinitions.search_taxes.schema.required).toContain('q');
  });
});
