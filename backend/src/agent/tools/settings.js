/**
 * Settings Tools — Phase 5
 *
 * Tools: get_setting, list_settings, get_settings_by_keys,
 *        update_setting, update_many_settings
 *
 * Category: settings
 */

const mongoose = require('mongoose');
const { successResponse, errorResponse } = require('../helpers/response');
const { registerTools, registerCategory } = require('../registry');

// ---------------------------------------------------------------------------
// HANDLERS
// ---------------------------------------------------------------------------

/**
 * get_setting — Get a single setting by its key.
 */
async function getSetting(params) {
  const { settingKey } = params;

  if (!settingKey || !settingKey.trim()) {
    return errorResponse('settingKey is required', 'INVALID_PARAM');
  }

  try {
    const Setting = mongoose.model('Setting');

    const result = await Setting.findOne({ settingKey }).exec();

    if (!result) {
      return errorResponse(
        `No document found by this settingKey: ${settingKey}`,
        'NOT_FOUND'
      );
    }

    return successResponse(result);
  } catch (err) {
    return errorResponse(`Failed to fetch setting: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * list_settings — List all non-private settings.
 */
async function listSettings() {
  try {
    const Setting = mongoose.model('Setting');

    const result = await Setting.find({
      removed: false,
      isPrivate: false,
    })
      .sort({ created: 'desc' })
      .exec();

    return successResponse(result);
  } catch (err) {
    return errorResponse(`Failed to list settings: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * get_settings_by_keys — Get multiple settings by comma-separated keys.
 */
async function getSettingsByKeys(params) {
  const { settingKeyArray } = params;

  if (!settingKeyArray || !settingKeyArray.trim()) {
    return errorResponse('settingKeyArray is required', 'INVALID_PARAM');
  }

  try {
    const Setting = mongoose.model('Setting');

    const keys = settingKeyArray.split(',').map((k) => k.trim()).filter(Boolean);

    if (keys.length === 0) {
      return errorResponse('Please provide settings you need', 'INVALID_PARAM');
    }

    const settingsToShow = {
      $or: keys.map((settingKey) => ({ settingKey })),
    };

    const results = await Setting.find(settingsToShow).where('removed', false).exec();

    return successResponse(results);
  } catch (err) {
    return errorResponse(`Failed to fetch settings: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * update_setting — Update a single setting by key.
 */
async function updateSetting(params) {
  const { settingKey, settingValue } = params;

  if (!settingKey || !settingKey.trim()) {
    return errorResponse('settingKey is required', 'INVALID_PARAM');
  }

  if (settingValue === undefined || settingValue === null) {
    return errorResponse('settingValue is required', 'INVALID_PARAM');
  }

  try {
    const Setting = mongoose.model('Setting');

    const result = await Setting.findOneAndUpdate(
      { settingKey },
      { settingValue },
      { new: true, runValidators: true }
    ).exec();

    if (!result) {
      return errorResponse(
        `No document found by this settingKey: ${settingKey}`,
        'NOT_FOUND'
      );
    }

    return successResponse(result);
  } catch (err) {
    return errorResponse(`Failed to update setting: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * update_many_settings — Update multiple settings in one bulk write.
 */
async function updateManySettings(params) {
  const { settings } = params;

  if (!settings || !Array.isArray(settings) || settings.length === 0) {
    return errorResponse('settings array is required and must not be empty', 'INVALID_PARAM');
  }

  // Validate each entry has settingKey and settingValue
  for (const setting of settings) {
    if (
      !setting.hasOwnProperty('settingKey') ||
      !setting.hasOwnProperty('settingValue')
    ) {
      return errorResponse(
        'Each setting must have settingKey and settingValue',
        'VALIDATION_ERROR'
      );
    }
  }

  try {
    const Setting = mongoose.model('Setting');

    const updateDataArray = settings.map((s) => ({
      updateOne: {
        filter: { settingKey: s.settingKey },
        update: { settingValue: s.settingValue },
      },
    }));

    const result = await Setting.bulkWrite(updateDataArray);

    if (!result || result.matchedCount < 1) {
      return errorResponse('No settings found to update', 'NOT_FOUND');
    }

    return successResponse({
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    return errorResponse(`Failed to update settings: ${err.message}`, 'INTERNAL_ERROR');
  }
}

// ---------------------------------------------------------------------------
// TOOL DEFINITIONS
// ---------------------------------------------------------------------------

const toolDefinitions = {
  get_setting: {
    handler: getSetting,
    schema: {
      type: 'object',
      properties: {
        settingKey: {
          type: 'string',
          description:
            'The setting key to retrieve (e.g. company_name, default_currency_code, idurar_app_language)',
        },
      },
      required: ['settingKey'],
    },
    description:
      "Get a single application setting by its key. Returns the setting's value, category, and metadata. Common keys: company_name, company_email, default_currency_code, invoice_prefix, idurar_app_language. Common categories: app_settings, company_settings, finance_settings, money_format_settings.",
    execution: 'backend',
    access: 'authenticated',
    category: 'settings',
  },

  list_settings: {
    handler: listSettings,
    schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    description:
      'List all application settings that are not marked as private. Returns a flat array of settings grouped by settingCategory. Excludes removed and private settings.',
    execution: 'backend',
    access: 'authenticated',
    category: 'settings',
  },

  get_settings_by_keys: {
    handler: getSettingsByKeys,
    schema: {
      type: 'object',
      properties: {
        settingKeyArray: {
          type: 'string',
          description:
            'Comma-separated setting keys to retrieve (e.g. "company_name,company_email,company_phone"). No spaces between keys.',
        },
      },
      required: ['settingKeyArray'],
    },
    description:
      'Get multiple settings by comma-separated keys in one request. More efficient than calling get_setting multiple times. Keys that do not match are silently omitted.',
    execution: 'backend',
    access: 'authenticated',
    category: 'settings',
  },

  update_setting: {
    handler: updateSetting,
    schema: {
      type: 'object',
      properties: {
        settingKey: {
          type: 'string',
          description: 'The setting key to update',
        },
        settingValue: {
          description: 'The new value (string, number, boolean, array, or object)',
        },
      },
      required: ['settingKey', 'settingValue'],
    },
    description:
      'Update a single application setting by key. The setting must already exist. The value can be any type (string, number, boolean, array, object). Only the settingValue is updated — settingCategory, valueType, isPrivate, and isCoreSetting are not modifiable.',
    execution: 'backend',
    access: 'authenticated',
    category: 'settings',
  },

  update_many_settings: {
    handler: updateManySettings,
    schema: {
      type: 'object',
      properties: {
        settings: {
          type: 'array',
          description: 'Array of settings to update',
          items: {
            type: 'object',
            properties: {
              settingKey: {
                type: 'string',
                description: 'The setting key',
              },
              settingValue: {
                description: 'The new value',
              },
            },
            required: ['settingKey', 'settingValue'],
          },
          minItems: 1,
        },
      },
      required: ['settings'],
    },
    description:
      'Update multiple settings in one request using bulk write. Each entry must have settingKey and settingValue. All settings must already exist. Returns match and modification counts.',
    execution: 'backend',
    access: 'authenticated',
    category: 'settings',
  },
};

// ---------------------------------------------------------------------------
// REGISTRATION
// ---------------------------------------------------------------------------

function register() {
  registerCategory(
    'settings',
    'Application settings — read, update, and bulk-update configuration values like company name, currency, language, and invoice settings.'
  );
  registerTools(toolDefinitions);
}

module.exports = {
  getSetting,
  listSettings,
  getSettingsByKeys,
  updateSetting,
  updateManySettings,
  toolDefinitions,
  register,
};
