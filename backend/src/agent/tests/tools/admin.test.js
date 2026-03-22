/**
 * Tests for Admin Tools — Phase 5
 *
 * Tests 2 backend handlers: get_admin_profile, update_admin_profile.
 */

const { mockContext, mockUnauthenticatedContext } = require('../helpers/mockContext');

// ---------------------------------------------------------------------------
// Chainable query mock helper
// ---------------------------------------------------------------------------

function chainable(resolvedValue) {
  const chain = {};
  ['sort', 'where', 'select', 'populate'].forEach((method) => {
    chain[method] = jest.fn(() => chain);
  });
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

// ---------------------------------------------------------------------------
// Mock mongoose
// ---------------------------------------------------------------------------

const mockAdminModel = {
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
};

jest.mock('mongoose', () => ({
  model: jest.fn((name) => {
    if (name === 'Admin') return mockAdminModel;
    return {};
  }),
}));

// ---------------------------------------------------------------------------
// Import handlers (after mocking)
// ---------------------------------------------------------------------------

const {
  getAdminProfile,
  updateAdminProfile,
  toolDefinitions,
  register,
} = require('../../tools/admin');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_ID = '507f1f77bcf86cd799439099';
const INVALID_ID = 'not-a-valid-id';

const sampleAdmin = {
  _id: VALID_ID,
  enabled: true,
  email: 'admin@test.com',
  name: 'Test Admin',
  surname: 'User',
  photo: null,
  role: 'owner',
  removed: false,
};

const demoAdmin = {
  _id: '507f1f77bcf86cd799439088',
  enabled: true,
  email: 'admin@demo.com',
  name: 'Demo',
  surname: 'Admin',
  photo: null,
  role: 'owner',
  removed: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Admin Tools', () => {
  let ctx;

  beforeEach(() => {
    ctx = mockContext({ userId: VALID_ID });
    jest.clearAllMocks();
  });

  // =========================================================================
  // get_admin_profile
  // =========================================================================
  describe('get_admin_profile', () => {
    it('should return admin profile for a valid ID', async () => {
      mockAdminModel.findOne.mockReturnValue(chainable(sampleAdmin));

      const result = await getAdminProfile({ id: VALID_ID }, ctx);

      expect(result.success).toBe(true);
      expect(result.data._id).toBe(VALID_ID);
      expect(result.data.name).toBe('Test Admin');
      expect(result.data.email).toBe('admin@test.com');
      expect(result.data.role).toBe('owner');
      expect(mockAdminModel.findOne).toHaveBeenCalledWith({
        _id: VALID_ID,
        removed: false,
      });
    });

    it('should return only safe fields', async () => {
      const fullAdmin = {
        ...sampleAdmin,
        password: 'secret_hash',
        token: 'jwt_token',
        sessionData: { ip: '1.2.3.4' },
      };
      mockAdminModel.findOne.mockReturnValue(chainable(fullAdmin));

      const result = await getAdminProfile({ id: VALID_ID }, ctx);

      expect(result.success).toBe(true);
      // Safe fields present
      expect(result.data._id).toBeDefined();
      expect(result.data.name).toBeDefined();
      expect(result.data.email).toBeDefined();
      expect(result.data.role).toBeDefined();
      expect(result.data.enabled).toBeDefined();
      // Sensitive fields NOT present
      expect(result.data.password).toBeUndefined();
      expect(result.data.token).toBeUndefined();
      expect(result.data.sessionData).toBeUndefined();
    });

    it('should return NOT_FOUND for non-existent admin', async () => {
      mockAdminModel.findOne.mockReturnValue(chainable(null));

      const result = await getAdminProfile({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return INVALID_PARAM for invalid ObjectId', async () => {
      const result = await getAdminProfile({ id: INVALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockAdminModel.findOne).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when id is missing', async () => {
      const result = await getAdminProfile({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should handle admin with null surname and photo', async () => {
      const adminNoSurname = { ...sampleAdmin, surname: undefined, photo: undefined };
      mockAdminModel.findOne.mockReturnValue(chainable(adminNoSurname));

      const result = await getAdminProfile({ id: VALID_ID }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.surname).toBeUndefined();
      expect(result.data.photo).toBeUndefined();
    });

    it('should handle database errors gracefully', async () => {
      mockAdminModel.findOne.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('DB connection lost')),
      });

      const result = await getAdminProfile({ id: VALID_ID }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.error).toContain('DB connection lost');
    });
  });

  // =========================================================================
  // update_admin_profile
  // =========================================================================
  describe('update_admin_profile', () => {
    it('should update admin name', async () => {
      // First call: findOne to check for demo account
      mockAdminModel.findOne.mockReturnValue(chainable(sampleAdmin));
      // Second call: findOneAndUpdate
      const updated = { ...sampleAdmin, name: 'Updated Name' };
      mockAdminModel.findOneAndUpdate.mockReturnValue(chainable(updated));

      const result = await updateAdminProfile({ name: 'Updated Name' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Updated Name');
    });

    it('should update admin email', async () => {
      mockAdminModel.findOne.mockReturnValue(chainable(sampleAdmin));
      const updated = { ...sampleAdmin, email: 'new@test.com' };
      mockAdminModel.findOneAndUpdate.mockReturnValue(chainable(updated));

      const result = await updateAdminProfile({ email: 'new@test.com' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.email).toBe('new@test.com');
    });

    it('should update admin surname', async () => {
      mockAdminModel.findOne.mockReturnValue(chainable(sampleAdmin));
      const updated = { ...sampleAdmin, surname: 'NewSurname' };
      mockAdminModel.findOneAndUpdate.mockReturnValue(chainable(updated));

      const result = await updateAdminProfile({ surname: 'NewSurname' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.surname).toBe('NewSurname');
    });

    it('should update multiple fields at once', async () => {
      mockAdminModel.findOne.mockReturnValue(chainable(sampleAdmin));
      const updated = {
        ...sampleAdmin,
        name: 'New Name',
        surname: 'New Surname',
        email: 'new@email.com',
      };
      mockAdminModel.findOneAndUpdate.mockReturnValue(chainable(updated));

      const result = await updateAdminProfile(
        { name: 'New Name', surname: 'New Surname', email: 'new@email.com' },
        ctx
      );

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('New Name');
    });

    it('should use context.userId for the update query', async () => {
      mockAdminModel.findOne.mockReturnValue(chainable(sampleAdmin));
      mockAdminModel.findOneAndUpdate.mockReturnValue(chainable(sampleAdmin));

      await updateAdminProfile({ name: 'Test' }, ctx);

      expect(mockAdminModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: ctx.userId, removed: false },
        { $set: { name: 'Test' } },
        { new: true }
      );
    });

    it('should return only safe fields in response', async () => {
      mockAdminModel.findOne.mockReturnValue(chainable(sampleAdmin));
      const fullResult = {
        ...sampleAdmin,
        password: 'hash',
        __v: 0,
      };
      mockAdminModel.findOneAndUpdate.mockReturnValue(chainable(fullResult));

      const result = await updateAdminProfile({ name: 'Test' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.password).toBeUndefined();
      expect(result.data.__v).toBeUndefined();
    });

    it('should return FORBIDDEN for demo account', async () => {
      const demoCtx = mockContext({ userId: demoAdmin._id });
      mockAdminModel.findOne.mockReturnValue(chainable(demoAdmin));

      const result = await updateAdminProfile({ name: 'Hacker' }, demoCtx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('FORBIDDEN');
      expect(mockAdminModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when no fields provided', async () => {
      const result = await updateAdminProfile({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(result.error).toContain('At least one field');
      expect(mockAdminModel.findOne).not.toHaveBeenCalled();
    });

    it('should return NOT_FOUND when admin does not exist', async () => {
      mockAdminModel.findOne.mockReturnValue(chainable(null));

      const result = await updateAdminProfile({ name: 'Test' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return NOT_FOUND when update returns null', async () => {
      mockAdminModel.findOne.mockReturnValue(chainable(sampleAdmin));
      mockAdminModel.findOneAndUpdate.mockReturnValue(chainable(null));

      const result = await updateAdminProfile({ name: 'Test' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should not include photo in update fields', async () => {
      mockAdminModel.findOne.mockReturnValue(chainable(sampleAdmin));
      mockAdminModel.findOneAndUpdate.mockReturnValue(chainable(sampleAdmin));

      // Even if photo is passed, it should be ignored
      await updateAdminProfile({ name: 'Test', photo: 'image.jpg' }, ctx);

      const updateArg = mockAdminModel.findOneAndUpdate.mock.calls[0][1];
      expect(updateArg.$set.photo).toBeUndefined();
      expect(updateArg.$set.name).toBe('Test');
    });

    it('should handle database errors gracefully', async () => {
      mockAdminModel.findOne.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('DB error')),
      });

      const result = await updateAdminProfile({ name: 'Test' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  // =========================================================================
  // Tool Definitions & Registration
  // =========================================================================
  describe('Tool Definitions', () => {
    it('should define all 2 tools', () => {
      const names = Object.keys(toolDefinitions);
      expect(names).toEqual(['get_admin_profile', 'update_admin_profile']);
    });

    it('should set all tools with execution: backend', () => {
      Object.values(toolDefinitions).forEach((tool) => {
        expect(tool.execution).toBe('backend');
        expect(tool.handler).toBeInstanceOf(Function);
      });
    });

    it('should set all tools to authenticated access', () => {
      Object.values(toolDefinitions).forEach((tool) => {
        expect(tool.access).toBe('authenticated');
      });
    });

    it('should set all tools to admin category', () => {
      Object.values(toolDefinitions).forEach((tool) => {
        expect(tool.category).toBe('admin');
      });
    });

    it('should require id for get_admin_profile', () => {
      expect(toolDefinitions.get_admin_profile.schema.required).toContain('id');
    });

    it('should have no required params for update_admin_profile', () => {
      expect(toolDefinitions.update_admin_profile.schema.required).toEqual([]);
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
