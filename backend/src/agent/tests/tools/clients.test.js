/**
 * Tests for Client Tools — Phase 2
 *
 * Tests all 7 backend handlers: get_client, list_clients, search_clients,
 * get_client_summary, create_client, update_client, delete_client.
 *
 * Also tests navigate_to_customers registration via the registry.
 */

const { mockContext, mockAdminContext, mockUnauthenticatedContext } = require('../helpers/mockContext');
const { clients } = require('../fixtures');

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

const mockClientModel = {
  findOne: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
  findOneAndUpdate: jest.fn(),
  aggregate: jest.fn(),
  create: jest.fn(),
  collection: { name: 'clients' },
};

const mockInvoiceModel = {
  collection: { name: 'invoices' },
};

jest.mock('mongoose', () => ({
  model: jest.fn((name) => {
    if (name === 'Client') return mockClientModel;
    if (name === 'Invoice') return mockInvoiceModel;
    return {};
  }),
}));

// ---------------------------------------------------------------------------
// Import handlers (after mocking)
// ---------------------------------------------------------------------------

const {
  getClient,
  listClients,
  searchClients,
  getClientSummary,
  createClient,
  updateClient,
  deleteClient,
  toolDefinitions,
  register,
} = require('../../tools/clients');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_ID = '507f1f77bcf86cd799439011';
const VALID_ID_2 = '507f1f77bcf86cd799439012';
const INVALID_ID = 'not-a-valid-id';

const sampleClient = {
  _id: VALID_ID,
  name: 'Acme Corp',
  email: 'contact@acme.com',
  phone: '+1-555-0100',
  country: 'US',
  enabled: true,
  removed: false,
  createdBy: '507f1f77bcf86cd799439099',
  created: new Date('2026-01-15'),
  updated: new Date('2026-01-15'),
};

const sampleClient2 = {
  _id: VALID_ID_2,
  name: 'Jane Doe',
  email: 'jane@example.com',
  phone: '+1-555-0200',
  country: 'UK',
  enabled: true,
  removed: false,
  createdBy: '507f1f77bcf86cd799439099',
  created: new Date('2026-02-10'),
  updated: new Date('2026-02-10'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Client Tools', () => {
  let ctx;

  beforeEach(() => {
    ctx = mockContext();
    jest.clearAllMocks();
  });

  // =========================================================================
  // get_client
  // =========================================================================
  describe('get_client', () => {
    it('should return client details for a valid ID', async () => {
      mockClientModel.findOne.mockReturnValue(chainable(sampleClient));

      const result = await getClient({ id: VALID_ID }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Acme Corp');
      expect(result.data.email).toBe('contact@acme.com');
      expect(mockClientModel.findOne).toHaveBeenCalledWith({
        _id: VALID_ID,
        removed: false,
      });
    });

    it('should return NOT_FOUND for non-existent client', async () => {
      mockClientModel.findOne.mockReturnValue(chainable(null));

      const result = await getClient({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return INVALID_PARAM for invalid ObjectId', async () => {
      const result = await getClient({ id: INVALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockClientModel.findOne).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when id is missing', async () => {
      const result = await getClient({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should handle database errors gracefully', async () => {
      mockClientModel.findOne.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('DB connection lost')),
      });

      const result = await getClient({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.error).toContain('DB connection lost');
    });
  });

  // =========================================================================
  // list_clients
  // =========================================================================
  describe('list_clients', () => {
    it('should return paginated client list with defaults', async () => {
      mockClientModel.find.mockReturnValue(chainable([sampleClient, sampleClient2]));
      mockClientModel.countDocuments.mockResolvedValue(2);

      const result = await listClients({}, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.metadata.pagination).toEqual({ page: 1, pages: 1, count: 2 });
    });

    it('should return empty results when no clients exist', async () => {
      mockClientModel.find.mockReturnValue(chainable([]));
      mockClientModel.countDocuments.mockResolvedValue(0);

      const result = await listClients({}, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
      expect(result.metadata.pagination.count).toBe(0);
    });

    it('should respect pagination parameters', async () => {
      mockClientModel.find.mockReturnValue(chainable([sampleClient2]));
      mockClientModel.countDocuments.mockResolvedValue(12);

      const result = await listClients({ page: 2, items: 5 }, ctx);

      expect(result.success).toBe(true);
      expect(result.metadata.pagination).toEqual({ page: 2, pages: 3, count: 12 });

      // Verify skip was called with correct offset
      const findChain = mockClientModel.find.mock.results[0].value;
      expect(findChain.skip).toHaveBeenCalledWith(5);
      expect(findChain.limit).toHaveBeenCalledWith(5);
    });

    it('should apply filter and equal parameters', async () => {
      mockClientModel.find.mockReturnValue(chainable([sampleClient]));
      mockClientModel.countDocuments.mockResolvedValue(1);

      const result = await listClients({ filter: 'country', equal: 'US' }, ctx);

      expect(result.success).toBe(true);
      expect(mockClientModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ country: 'US', removed: false })
      );
    });

    it('should reject object filter values', async () => {
      const result = await listClients(
        { filter: 'country', equal: { $ne: 'US' } },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should apply text search with q and fields', async () => {
      mockClientModel.find.mockReturnValue(chainable([sampleClient]));
      mockClientModel.countDocuments.mockResolvedValue(1);

      const result = await listClients({ q: 'acme', fields: 'name,email' }, ctx);

      expect(result.success).toBe(true);
      expect(mockClientModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          removed: false,
          $or: expect.any(Array),
        })
      );
    });

    it('should handle database errors gracefully', async () => {
      mockClientModel.find.mockReturnValue({
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('DB error')),
      });
      mockClientModel.countDocuments.mockRejectedValue(new Error('DB error'));

      const result = await listClients({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  // =========================================================================
  // search_clients
  // =========================================================================
  describe('search_clients', () => {
    it('should return matching clients', async () => {
      mockClientModel.find.mockReturnValue(chainable([sampleClient]));

      const result = await searchClients({ q: 'Acme' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Acme Corp');
    });

    it('should search across multiple fields', async () => {
      mockClientModel.find.mockReturnValue(chainable([sampleClient, sampleClient2]));

      const result = await searchClients({ q: 'test', fields: 'name,email,phone' }, ctx);

      expect(result.success).toBe(true);
      // Verify the $or query was built correctly
      const findArgs = mockClientModel.find.mock.calls[0][0];
      expect(findArgs.$or).toHaveLength(3);
    });

    it('should return empty results when no match', async () => {
      mockClientModel.find.mockReturnValue(chainable([]));

      const result = await searchClients({ q: 'nonexistent' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });

    it('should return INVALID_PARAM when q is missing', async () => {
      const result = await searchClients({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockClientModel.find).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when q is empty whitespace', async () => {
      const result = await searchClients({ q: '   ' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should escape special regex characters in search term', async () => {
      mockClientModel.find.mockReturnValue(chainable([]));

      await searchClients({ q: 'acme.corp (test)' }, ctx);

      const findArgs = mockClientModel.find.mock.calls[0][0];
      // The regex should have escaped special chars
      expect(findArgs.$or[0].name.$regex.source).toContain('\\.');
      expect(findArgs.$or[0].name.$regex.source).toContain('\\(');
      expect(findArgs.$or[0].name.$regex.source).toContain('\\)');
    });

    it('should limit results to 20', async () => {
      mockClientModel.find.mockReturnValue(chainable([]));

      await searchClients({ q: 'test' }, ctx);

      const findChain = mockClientModel.find.mock.results[0].value;
      expect(findChain.limit).toHaveBeenCalledWith(20);
    });
  });

  // =========================================================================
  // get_client_summary
  // =========================================================================
  describe('get_client_summary', () => {
    it('should return summary percentages for month', async () => {
      mockClientModel.aggregate.mockResolvedValue([
        {
          totalClients: [{ count: 100 }],
          newClients: [{ count: 15 }],
          activeClients: [{ count: 72 }],
        },
      ]);

      const result = await getClientSummary({ type: 'month' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.new).toBe(15);
      expect(result.data.active).toBe(72);
    });

    it('should return summary for week', async () => {
      mockClientModel.aggregate.mockResolvedValue([
        {
          totalClients: [{ count: 50 }],
          newClients: [{ count: 5 }],
          activeClients: [{ count: 30 }],
        },
      ]);

      const result = await getClientSummary({ type: 'week' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.new).toBe(10);
      expect(result.data.active).toBe(60);
    });

    it('should return summary for year', async () => {
      mockClientModel.aggregate.mockResolvedValue([
        {
          totalClients: [{ count: 200 }],
          newClients: [{ count: 80 }],
          activeClients: [{ count: 150 }],
        },
      ]);

      const result = await getClientSummary({ type: 'year' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.new).toBe(40);
      expect(result.data.active).toBe(75);
    });

    it('should default to month when type is omitted', async () => {
      mockClientModel.aggregate.mockResolvedValue([
        {
          totalClients: [{ count: 10 }],
          newClients: [{ count: 2 }],
          activeClients: [{ count: 7 }],
        },
      ]);

      const result = await getClientSummary({}, ctx);

      expect(result.success).toBe(true);
      expect(result.data.new).toBe(20);
      expect(result.data.active).toBe(70);
    });

    it('should return zeros when no clients exist', async () => {
      mockClientModel.aggregate.mockResolvedValue([
        {
          totalClients: [],
          newClients: [],
          activeClients: [],
        },
      ]);

      const result = await getClientSummary({}, ctx);

      expect(result.success).toBe(true);
      expect(result.data.new).toBe(0);
      expect(result.data.active).toBe(0);
    });

    it('should return INVALID_PARAM for invalid type', async () => {
      const result = await getClientSummary({ type: 'decade' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockClientModel.aggregate).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // create_client
  // =========================================================================
  describe('create_client', () => {
    it('should create a new client with all fields', async () => {
      const newClient = {
        _id: 'new_client_id',
        name: 'New Corp',
        email: 'new@corp.com',
        phone: '+1-555-0300',
        country: 'Canada',
        address: '456 Oak Ave',
        createdBy: ctx.userId,
        removed: false,
      };
      mockClientModel.create.mockResolvedValue(newClient);

      const result = await createClient(
        {
          name: 'New Corp',
          email: 'new@corp.com',
          phone: '+1-555-0300',
          country: 'Canada',
          address: '456 Oak Ave',
        },
        ctx
      );

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('New Corp');
      expect(mockClientModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Corp',
          email: 'new@corp.com',
          createdBy: ctx.userId,
          removed: false,
        })
      );
    });

    it('should create a client with only the name', async () => {
      const newClient = { _id: 'new_id', name: 'Minimal Client', removed: false };
      mockClientModel.create.mockResolvedValue(newClient);

      const result = await createClient({ name: 'Minimal Client' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Minimal Client');
    });

    it('should set createdBy from context userId', async () => {
      mockClientModel.create.mockResolvedValue({ _id: 'x', name: 'Test' });

      await createClient({ name: 'Test' }, ctx);

      expect(mockClientModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: ctx.userId })
      );
    });

    it('should return VALIDATION_ERROR for validation failures', async () => {
      const validationError = new Error('Validation failed: name: Path `name` is required.');
      validationError.name = 'ValidationError';
      mockClientModel.create.mockRejectedValue(validationError);

      const result = await createClient({ name: '' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should handle database errors gracefully', async () => {
      mockClientModel.create.mockRejectedValue(new Error('DB write failed'));

      const result = await createClient({ name: 'Test' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  // =========================================================================
  // update_client
  // =========================================================================
  describe('update_client', () => {
    it('should update client fields', async () => {
      const updated = { ...sampleClient, email: 'new@acme.com' };
      mockClientModel.findOneAndUpdate.mockReturnValue(chainable(updated));

      const result = await updateClient({ id: VALID_ID, email: 'new@acme.com' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.email).toBe('new@acme.com');
      expect(mockClientModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: VALID_ID, removed: false },
        expect.objectContaining({ email: 'new@acme.com', removed: false }),
        { new: true, runValidators: true }
      );
    });

    it('should update multiple fields at once', async () => {
      const updated = { ...sampleClient, name: 'Acme International', country: 'UK' };
      mockClientModel.findOneAndUpdate.mockReturnValue(chainable(updated));

      const result = await updateClient(
        { id: VALID_ID, name: 'Acme International', country: 'UK' },
        ctx
      );

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Acme International');
    });

    it('should return NOT_FOUND for non-existent client', async () => {
      mockClientModel.findOneAndUpdate.mockReturnValue(chainable(null));

      const result = await updateClient({ id: VALID_ID, name: 'New Name' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return INVALID_PARAM for invalid ObjectId', async () => {
      const result = await updateClient({ id: INVALID_ID, name: 'Test' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockClientModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when no update fields provided', async () => {
      const result = await updateClient({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(result.error).toContain('At least one field');
    });

    it('should return INVALID_PARAM when id is missing', async () => {
      const result = await updateClient({ name: 'Test' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should prevent setting removed via update', async () => {
      const updated = { ...sampleClient, name: 'Test' };
      mockClientModel.findOneAndUpdate.mockReturnValue(chainable(updated));

      await updateClient({ id: VALID_ID, name: 'Test' }, ctx);

      const updateArg = mockClientModel.findOneAndUpdate.mock.calls[0][1];
      expect(updateArg.removed).toBe(false);
    });

    it('should return VALIDATION_ERROR for validation failures', async () => {
      const validationError = new Error('Validation failed');
      validationError.name = 'ValidationError';
      mockClientModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockRejectedValue(validationError),
      });

      const result = await updateClient({ id: VALID_ID, name: '' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // delete_client
  // =========================================================================
  describe('delete_client', () => {
    it('should soft-delete a client', async () => {
      const deleted = { ...sampleClient, removed: true };
      mockClientModel.findOneAndUpdate.mockReturnValue(chainable(deleted));

      const result = await deleteClient({ id: VALID_ID }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.removed).toBe(true);
      expect(mockClientModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: VALID_ID, removed: false },
        { $set: { removed: true } },
        { new: true }
      );
    });

    it('should return NOT_FOUND for non-existent client', async () => {
      mockClientModel.findOneAndUpdate.mockReturnValue(chainable(null));

      const result = await deleteClient({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return NOT_FOUND for already-deleted client', async () => {
      // findOneAndUpdate with { removed: false } won't find a removed client
      mockClientModel.findOneAndUpdate.mockReturnValue(chainable(null));

      const result = await deleteClient({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return INVALID_PARAM for invalid ObjectId', async () => {
      const result = await deleteClient({ id: INVALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockClientModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when id is missing', async () => {
      const result = await deleteClient({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });
  });

  // =========================================================================
  // Tool Definitions & Registration
  // =========================================================================
  describe('Tool Definitions', () => {
    it('should define all 8 tools', () => {
      const names = Object.keys(toolDefinitions);
      expect(names).toEqual([
        'get_client',
        'list_clients',
        'search_clients',
        'get_client_summary',
        'create_client',
        'update_client',
        'delete_client',
        'navigate_to_customers',
      ]);
    });

    it('should set all backend tools with execution: backend', () => {
      const backendTools = [
        'get_client',
        'list_clients',
        'search_clients',
        'get_client_summary',
        'create_client',
        'update_client',
        'delete_client',
      ];
      backendTools.forEach((name) => {
        expect(toolDefinitions[name].execution).toBe('backend');
        expect(toolDefinitions[name].handler).toBeInstanceOf(Function);
      });
    });

    it('should set navigate_to_customers as frontend tool', () => {
      const nav = toolDefinitions.navigate_to_customers;
      expect(nav.execution).toBe('frontend');
      expect(nav.frontendAction).toEqual({
        type: 'navigate',
        route: '/customer',
      });
      expect(nav.handler).toBeUndefined();
    });

    it('should mark delete_client as confirmBefore: true', () => {
      expect(toolDefinitions.delete_client.confirmBefore).toBe(true);
    });

    it('should set all tools to authenticated access', () => {
      Object.values(toolDefinitions).forEach((tool) => {
        expect(tool.access).toBe('authenticated');
      });
    });

    it('should set all tools to clients category', () => {
      Object.values(toolDefinitions).forEach((tool) => {
        expect(tool.category).toBe('clients');
      });
    });

    it('should require id for get_client, update_client, delete_client schemas', () => {
      ['get_client', 'update_client', 'delete_client'].forEach((name) => {
        expect(toolDefinitions[name].schema.required).toContain('id');
      });
    });

    it('should require q for search_clients schema', () => {
      expect(toolDefinitions.search_clients.schema.required).toContain('q');
    });

    it('should require name for create_client schema', () => {
      expect(toolDefinitions.create_client.schema.required).toContain('name');
    });

    it('should have no required params for list_clients and get_client_summary', () => {
      expect(toolDefinitions.list_clients.schema.required).toEqual([]);
      expect(toolDefinitions.get_client_summary.schema.required).toEqual([]);
    });
  });

  // =========================================================================
  // Registry Integration
  // =========================================================================
  describe('Registry Integration', () => {
    it('should register tools and category without errors', () => {
      // register() calls registerTools and registerCategory from the registry
      // Since we imported the real registry, this should work
      expect(() => register()).not.toThrow();
    });
  });
});
