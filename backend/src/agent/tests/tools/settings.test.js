/**
 * Tests for Settings Tools — Phase 5
 *
 * Tests all 5 backend handlers: get_setting, list_settings,
 * get_settings_by_keys, update_setting, update_many_settings.
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

const mockSettingModel = {
  findOne: jest.fn(),
  find: jest.fn(),
  findOneAndUpdate: jest.fn(),
  bulkWrite: jest.fn(),
};

jest.mock('mongoose', () => ({
  model: jest.fn((name) => {
    if (name === 'Setting') return mockSettingModel;
    return {};
  }),
}));

// ---------------------------------------------------------------------------
// Import handlers (after mocking)
// ---------------------------------------------------------------------------

const {
  getSetting,
  listSettings,
  getSettingsByKeys,
  updateSetting,
  updateManySettings,
  toolDefinitions,
  register,
} = require('../../tools/settings');

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleSetting = {
  _id: '807f1f77bcf86cd799439041',
  settingCategory: 'app_settings',
  settingKey: 'idurar_app_language',
  settingValue: 'en_us',
  valueType: 'String',
  isPrivate: false,
  isCoreSetting: false,
  removed: false,
};

const sampleSetting2 = {
  _id: '807f1f77bcf86cd799439042',
  settingCategory: 'company_settings',
  settingKey: 'company_name',
  settingValue: 'Acme Corp',
  valueType: 'String',
  isPrivate: false,
  isCoreSetting: false,
  removed: false,
};

const privateSetting = {
  _id: '807f1f77bcf86cd799439043',
  settingCategory: 'app_settings',
  settingKey: 'secret_key',
  settingValue: 'abc123',
  valueType: 'String',
  isPrivate: true,
  isCoreSetting: false,
  removed: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Settings Tools', () => {
  let ctx;

  beforeEach(() => {
    ctx = mockContext();
    jest.clearAllMocks();
  });

  // =========================================================================
  // get_setting
  // =========================================================================
  describe('get_setting', () => {
    it('should return a setting by key', async () => {
      mockSettingModel.findOne.mockReturnValue(chainable(sampleSetting));

      const result = await getSetting({ settingKey: 'idurar_app_language' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.settingKey).toBe('idurar_app_language');
      expect(result.data.settingValue).toBe('en_us');
      expect(mockSettingModel.findOne).toHaveBeenCalledWith({
        settingKey: 'idurar_app_language',
      });
    });

    it('should return NOT_FOUND for non-existent key', async () => {
      mockSettingModel.findOne.mockReturnValue(chainable(null));

      const result = await getSetting({ settingKey: 'nonexistent_key' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return INVALID_PARAM when settingKey is missing', async () => {
      const result = await getSetting({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockSettingModel.findOne).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when settingKey is empty', async () => {
      const result = await getSetting({ settingKey: '   ' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should handle database errors gracefully', async () => {
      mockSettingModel.findOne.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('DB connection lost')),
      });

      const result = await getSetting({ settingKey: 'idurar_app_language' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.error).toContain('DB connection lost');
    });
  });

  // =========================================================================
  // list_settings
  // =========================================================================
  describe('list_settings', () => {
    it('should return all non-private settings', async () => {
      const chain = chainable([sampleSetting, sampleSetting2]);
      mockSettingModel.find.mockReturnValue(chain);

      const result = await listSettings({}, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(mockSettingModel.find).toHaveBeenCalledWith({
        removed: false,
        isPrivate: false,
      });
    });

    it('should return empty array when no settings exist', async () => {
      mockSettingModel.find.mockReturnValue(chainable([]));

      const result = await listSettings({}, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });

    it('should sort by created descending', async () => {
      const chain = chainable([sampleSetting]);
      mockSettingModel.find.mockReturnValue(chain);

      await listSettings({}, ctx);

      expect(chain.sort).toHaveBeenCalledWith({ created: 'desc' });
    });

    it('should handle database errors gracefully', async () => {
      mockSettingModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockRejectedValue(new Error('DB error')),
        }),
      });

      const result = await listSettings({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  // =========================================================================
  // get_settings_by_keys
  // =========================================================================
  describe('get_settings_by_keys', () => {
    it('should return settings for multiple keys', async () => {
      mockSettingModel.find.mockReturnValue(
        chainable([sampleSetting, sampleSetting2])
      );

      const result = await getSettingsByKeys(
        { settingKeyArray: 'idurar_app_language,company_name' },
        ctx
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('should build $or query from comma-separated keys', async () => {
      mockSettingModel.find.mockReturnValue(chainable([sampleSetting]));

      await getSettingsByKeys(
        { settingKeyArray: 'idurar_app_language,company_name' },
        ctx
      );

      expect(mockSettingModel.find).toHaveBeenCalledWith({
        $or: [
          { settingKey: 'idurar_app_language' },
          { settingKey: 'company_name' },
        ],
      });
    });

    it('should filter by removed: false', async () => {
      const chain = chainable([sampleSetting]);
      mockSettingModel.find.mockReturnValue(chain);

      await getSettingsByKeys({ settingKeyArray: 'idurar_app_language' }, ctx);

      expect(chain.where).toHaveBeenCalledWith('removed', false);
    });

    it('should return empty results when no keys match', async () => {
      mockSettingModel.find.mockReturnValue(chainable([]));

      const result = await getSettingsByKeys(
        { settingKeyArray: 'nonexistent' },
        ctx
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });

    it('should return INVALID_PARAM when settingKeyArray is missing', async () => {
      const result = await getSettingsByKeys({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockSettingModel.find).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when settingKeyArray is empty', async () => {
      const result = await getSettingsByKeys({ settingKeyArray: '  ' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should handle database errors gracefully', async () => {
      mockSettingModel.find.mockReturnValue({
        where: jest.fn().mockReturnValue({
          exec: jest.fn().mockRejectedValue(new Error('DB error')),
        }),
      });

      const result = await getSettingsByKeys(
        { settingKeyArray: 'idurar_app_language' },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  // =========================================================================
  // update_setting
  // =========================================================================
  describe('update_setting', () => {
    it('should update a setting value', async () => {
      const updated = { ...sampleSetting, settingValue: 'fr_fr' };
      mockSettingModel.findOneAndUpdate.mockReturnValue(chainable(updated));

      const result = await updateSetting(
        { settingKey: 'idurar_app_language', settingValue: 'fr_fr' },
        ctx
      );

      expect(result.success).toBe(true);
      expect(result.data.settingValue).toBe('fr_fr');
      expect(mockSettingModel.findOneAndUpdate).toHaveBeenCalledWith(
        { settingKey: 'idurar_app_language' },
        { settingValue: 'fr_fr' },
        { new: true, runValidators: true }
      );
    });

    it('should accept non-string values (number)', async () => {
      const updated = { ...sampleSetting, settingValue: 42 };
      mockSettingModel.findOneAndUpdate.mockReturnValue(chainable(updated));

      const result = await updateSetting(
        { settingKey: 'some_number', settingValue: 42 },
        ctx
      );

      expect(result.success).toBe(true);
      expect(result.data.settingValue).toBe(42);
    });

    it('should accept boolean values', async () => {
      const updated = { ...sampleSetting, settingValue: false };
      mockSettingModel.findOneAndUpdate.mockReturnValue(chainable(updated));

      const result = await updateSetting(
        { settingKey: 'some_flag', settingValue: false },
        ctx
      );

      expect(result.success).toBe(true);
    });

    it('should return NOT_FOUND for non-existent key', async () => {
      mockSettingModel.findOneAndUpdate.mockReturnValue(chainable(null));

      const result = await updateSetting(
        { settingKey: 'nonexistent', settingValue: 'val' },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return INVALID_PARAM when settingKey is missing', async () => {
      const result = await updateSetting({ settingValue: 'val' }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockSettingModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when settingValue is undefined', async () => {
      const result = await updateSetting(
        { settingKey: 'idurar_app_language' },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should return INVALID_PARAM when settingValue is null', async () => {
      const result = await updateSetting(
        { settingKey: 'idurar_app_language', settingValue: null },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should handle database errors gracefully', async () => {
      mockSettingModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('DB error')),
      });

      const result = await updateSetting(
        { settingKey: 'key', settingValue: 'val' },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  // =========================================================================
  // update_many_settings
  // =========================================================================
  describe('update_many_settings', () => {
    it('should update multiple settings', async () => {
      mockSettingModel.bulkWrite.mockResolvedValue({
        matchedCount: 2,
        modifiedCount: 2,
      });

      const result = await updateManySettings(
        {
          settings: [
            { settingKey: 'company_name', settingValue: 'New Corp' },
            { settingKey: 'idurar_app_language', settingValue: 'fr_fr' },
          ],
        },
        ctx
      );

      expect(result.success).toBe(true);
      expect(result.data.matchedCount).toBe(2);
      expect(result.data.modifiedCount).toBe(2);
    });

    it('should build correct bulkWrite operations', async () => {
      mockSettingModel.bulkWrite.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      });

      await updateManySettings(
        {
          settings: [{ settingKey: 'company_name', settingValue: 'Test' }],
        },
        ctx
      );

      expect(mockSettingModel.bulkWrite).toHaveBeenCalledWith([
        {
          updateOne: {
            filter: { settingKey: 'company_name' },
            update: { settingValue: 'Test' },
          },
        },
      ]);
    });

    it('should return NOT_FOUND when no settings matched', async () => {
      mockSettingModel.bulkWrite.mockResolvedValue({
        matchedCount: 0,
        modifiedCount: 0,
      });

      const result = await updateManySettings(
        {
          settings: [{ settingKey: 'nonexistent', settingValue: 'val' }],
        },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return INVALID_PARAM when settings array is empty', async () => {
      const result = await updateManySettings({ settings: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
      expect(mockSettingModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('should return INVALID_PARAM when settings is missing', async () => {
      const result = await updateManySettings({}, ctx);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PARAM');
    });

    it('should return VALIDATION_ERROR when entry missing settingKey', async () => {
      const result = await updateManySettings(
        {
          settings: [{ settingValue: 'val' }],
        },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(mockSettingModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('should return VALIDATION_ERROR when entry missing settingValue', async () => {
      const result = await updateManySettings(
        {
          settings: [{ settingKey: 'company_name' }],
        },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should handle database errors gracefully', async () => {
      mockSettingModel.bulkWrite.mockRejectedValue(new Error('DB error'));

      const result = await updateManySettings(
        {
          settings: [{ settingKey: 'key', settingValue: 'val' }],
        },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  // =========================================================================
  // Tool Definitions & Registration
  // =========================================================================
  describe('Tool Definitions', () => {
    it('should define all 5 tools', () => {
      const names = Object.keys(toolDefinitions);
      expect(names).toEqual([
        'get_setting',
        'list_settings',
        'get_settings_by_keys',
        'update_setting',
        'update_many_settings',
      ]);
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

    it('should set all tools to settings category', () => {
      Object.values(toolDefinitions).forEach((tool) => {
        expect(tool.category).toBe('settings');
      });
    });

    it('should require settingKey for get_setting', () => {
      expect(toolDefinitions.get_setting.schema.required).toContain('settingKey');
    });

    it('should require settingKeyArray for get_settings_by_keys', () => {
      expect(toolDefinitions.get_settings_by_keys.schema.required).toContain(
        'settingKeyArray'
      );
    });

    it('should require settingKey and settingValue for update_setting', () => {
      expect(toolDefinitions.update_setting.schema.required).toContain('settingKey');
      expect(toolDefinitions.update_setting.schema.required).toContain('settingValue');
    });

    it('should require settings array for update_many_settings', () => {
      expect(toolDefinitions.update_many_settings.schema.required).toContain(
        'settings'
      );
    });

    it('should have no required params for list_settings', () => {
      expect(toolDefinitions.list_settings.schema.required).toEqual([]);
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
