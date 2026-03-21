/**
 * Tests for agent helper modules:
 * - response.js
 * - auth.js
 * - validate.js
 * - pagination.js
 */

const { successResponse, errorResponse, paginatedResponse } = require('../helpers/response');
const { checkAccess, ACCESS } = require('../helpers/auth');
const { validateParams, isValidObjectId } = require('../helpers/validate');
const { normalizePagination, DEFAULT_PAGE, DEFAULT_LIMIT, MAX_LIMIT } = require('../helpers/pagination');
const { mockContext, mockAdminContext, mockUnauthenticatedContext } = require('./helpers/mockContext');

// ─── Response Helpers ───────────────────────────────────────

describe('response helpers', () => {
  describe('successResponse', () => {
    it('should return structured success response', () => {
      const result = successResponse({ id: '123', name: 'Test' });
      expect(result).toEqual({
        success: true,
        data: { id: '123', name: 'Test' },
        metadata: {},
      });
    });

    it('should include metadata when provided', () => {
      const result = successResponse({ id: '123' }, { executionTime: 42 });
      expect(result.metadata).toEqual({ executionTime: 42 });
    });
  });

  describe('errorResponse', () => {
    it('should return structured error response', () => {
      const result = errorResponse('Something went wrong', 'INTERNAL_ERROR');
      expect(result).toEqual({
        success: false,
        error: 'Something went wrong',
        code: 'INTERNAL_ERROR',
      });
    });

    it('should default code to ERROR', () => {
      const result = errorResponse('Bad input');
      expect(result.code).toBe('ERROR');
    });
  });

  describe('paginatedResponse', () => {
    it('should return paginated response with correct metadata', () => {
      const items = [{ id: 1 }, { id: 2 }];
      const result = paginatedResponse(items, 25, 1, 10);
      expect(result).toEqual({
        success: true,
        data: items,
        metadata: {
          total: 25,
          page: 1,
          limit: 10,
          totalPages: 3,
          hasMore: true,
        },
      });
    });

    it('should set hasMore to false on last page', () => {
      const result = paginatedResponse([], 10, 1, 10);
      expect(result.metadata.hasMore).toBe(false);
    });

    it('should calculate totalPages correctly', () => {
      const result = paginatedResponse([], 0, 1, 10);
      expect(result.metadata.totalPages).toBe(0);
    });
  });
});

// ─── Auth Helpers ───────────────────────────────────────────

describe('auth helpers', () => {
  describe('checkAccess', () => {
    it('should allow public access without context', () => {
      const result = checkAccess(ACCESS.PUBLIC, null);
      expect(result.allowed).toBe(true);
    });

    it('should require authentication for AUTHENTICATED', () => {
      const result = checkAccess(ACCESS.AUTHENTICATED, mockUnauthenticatedContext());
      expect(result.allowed).toBe(false);
      expect(result.error).toMatch(/Authentication required/);
    });

    it('should allow authenticated users for AUTHENTICATED', () => {
      const result = checkAccess(ACCESS.AUTHENTICATED, mockContext());
      expect(result.allowed).toBe(true);
    });

    it('should reject non-admin for ADMIN access', () => {
      const result = checkAccess(ACCESS.ADMIN, mockContext({ role: 'owner' }));
      expect(result.allowed).toBe(false);
      expect(result.error).toMatch(/Admin access required/);
    });

    it('should allow admin for ADMIN access', () => {
      const result = checkAccess(ACCESS.ADMIN, mockAdminContext());
      expect(result.allowed).toBe(true);
    });

    it('should allow admin for OWNER access', () => {
      const result = checkAccess(ACCESS.OWNER, mockAdminContext(), 'other-user-id');
      expect(result.allowed).toBe(true);
    });

    it('should reject non-owner for OWNER access', () => {
      const ctx = mockContext({ userId: 'user-1' });
      const result = checkAccess(ACCESS.OWNER, ctx, 'user-2');
      expect(result.allowed).toBe(false);
    });

    it('should allow resource owner for OWNER access', () => {
      const ctx = mockContext({ userId: 'user-1' });
      const result = checkAccess(ACCESS.OWNER, ctx, 'user-1');
      expect(result.allowed).toBe(true);
    });
  });
});

// ─── Validate Helpers ───────────────────────────────────────

describe('validate helpers', () => {
  describe('validateParams', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        page: { type: 'integer', minimum: 1 },
      },
      required: ['id'],
    };

    it('should validate correct params', () => {
      const result = validateParams({ id: 'abc123' }, schema);
      expect(result.valid).toBe(true);
    });

    it('should reject missing required params', () => {
      const result = validateParams({}, schema);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/required/i);
    });

    it('should coerce string to integer (open-source model compat)', () => {
      const result = validateParams({ id: 'abc', page: '3' }, schema);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid integer', () => {
      const result = validateParams({ id: 'abc', page: 0 }, schema);
      expect(result.valid).toBe(false);
    });
  });

  describe('isValidObjectId', () => {
    it('should accept valid ObjectId', () => {
      expect(isValidObjectId('507f1f77bcf86cd799439011')).toBe(true);
    });

    it('should reject short string', () => {
      expect(isValidObjectId('abc')).toBe(false);
    });

    it('should reject non-hex string', () => {
      expect(isValidObjectId('zzzzzzzzzzzzzzzzzzzzzzzz')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidObjectId('')).toBe(false);
    });
  });
});

// ─── Pagination Helpers ─────────────────────────────────────

describe('pagination helpers', () => {
  describe('normalizePagination', () => {
    it('should return defaults for empty params', () => {
      const result = normalizePagination();
      expect(result).toEqual({ page: DEFAULT_PAGE, limit: DEFAULT_LIMIT, skip: 0 });
    });

    it('should calculate skip correctly', () => {
      const result = normalizePagination({ page: 3, limit: 10 });
      expect(result.skip).toBe(20);
    });

    it('should cap limit at MAX_LIMIT', () => {
      const result = normalizePagination({ limit: 100 });
      expect(result.limit).toBe(MAX_LIMIT);
    });

    it('should coerce negative page to default', () => {
      const result = normalizePagination({ page: -1 });
      expect(result.page).toBe(DEFAULT_PAGE);
    });

    it('should coerce string values', () => {
      const result = normalizePagination({ page: '2', limit: '15' });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(15);
    });
  });
});
