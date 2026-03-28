/**
 * Tax Tools
 *
 * Tools: get_tax, list_taxes, search_taxes,
 *        create_tax, update_tax, delete_tax,
 *        navigate_to_taxes
 *
 * Category: taxes
 */

const mongoose = require('mongoose');
const { successResponse, errorResponse } = require('../helpers/response');
const { isValidObjectId } = require('../helpers/validate');
const { registerTools, registerCategory } = require('../registry');

/**
 * Escape special regex characters to prevent ReDoS.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// HANDLERS
// ---------------------------------------------------------------------------

/**
 * get_tax — Get a single tax by ID.
 */
async function getTax(params) {
  const { id } = params;
  if (!id || !isValidObjectId(id)) {
    return errorResponse('Invalid or missing tax ID', 'INVALID_PARAM');
  }

  try {
    const Taxes = mongoose.model('Taxes');
    const result = await Taxes.findOne({ _id: id, removed: false }).exec();

    if (!result) {
      return errorResponse('No document found', 'NOT_FOUND');
    }

    return successResponse(result);
  } catch (err) {
    return errorResponse(`Failed to fetch tax: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * list_taxes — List taxes with pagination and sorting.
 */
async function listTaxes(params) {
  try {
    const Taxes = mongoose.model('Taxes');

    const page = parseInt(params.page, 10) || 1;
    const limit = parseInt(params.items, 10) || 10;
    const skip = page * limit - limit;
    const sortBy = params.sortBy || 'enabled';
    const sortValue = parseInt(params.sortValue, 10) || -1;

    // Build filter condition — reject object values to prevent operator injection
    let filterCondition = {};
    if (params.filter && params.equal !== undefined) {
      if (typeof params.equal === 'object') {
        return errorResponse('Invalid filter value', 'INVALID_PARAM');
      }
      filterCondition = { [params.filter]: params.equal };
    }

    const query = { removed: false, ...filterCondition };

    const [result, count] = await Promise.all([
      Taxes.find(query)
        .skip(skip)
        .limit(limit)
        .sort({ [sortBy]: sortValue })
        .exec(),
      Taxes.countDocuments(query),
    ]);

    const pages = Math.ceil(count / limit);

    return successResponse(result, {
      pagination: { page, pages, count },
    });
  } catch (err) {
    return errorResponse(`Failed to list taxes: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * search_taxes — Search taxes by keyword on taxName.
 */
async function searchTaxes(params) {
  const { q } = params;
  if (!q || !q.trim()) {
    return errorResponse('Search query is required', 'INVALID_PARAM');
  }

  try {
    const Taxes = mongoose.model('Taxes');
    const escaped = escapeRegex(q.trim());
    const regex = new RegExp(escaped, 'i');

    const result = await Taxes.find({
      removed: false,
      taxName: { $regex: regex },
    })
      .limit(20)
      .exec();

    return successResponse(result);
  } catch (err) {
    return errorResponse(`Failed to search taxes: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * create_tax — Create a new tax.
 */
async function createTax(params) {
  const { taxName, taxValue, isDefault, enabled } = params;

  if (!taxName || !taxName.trim()) {
    return errorResponse('Tax name is required', 'INVALID_PARAM');
  }
  if (taxValue === undefined || taxValue === null || String(taxValue).trim() === '') {
    return errorResponse('Tax value is required', 'INVALID_PARAM');
  }

  try {
    const Taxes = mongoose.model('Taxes');

    const doc = { taxName: taxName.trim(), taxValue: String(taxValue).trim() };
    if (isDefault !== undefined) doc.isDefault = isDefault;
    if (enabled !== undefined) doc.enabled = enabled;

    const result = await Taxes.create(doc);
    return successResponse(result);
  } catch (err) {
    if (err.name === 'ValidationError') {
      return errorResponse(`Validation failed: ${err.message}`, 'VALIDATION_ERROR');
    }
    return errorResponse(`Failed to create tax: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * update_tax — Update a tax's details.
 */
async function updateTax(params) {
  const { id, ...fields } = params;

  if (!id || !isValidObjectId(id)) {
    return errorResponse('Invalid or missing tax ID', 'INVALID_PARAM');
  }

  // Build update object from only the fields that were provided
  const updates = {};
  if (fields.taxName !== undefined) updates.taxName = fields.taxName;
  if (fields.taxValue !== undefined) updates.taxValue = String(fields.taxValue);
  if (fields.enabled !== undefined) updates.enabled = fields.enabled;
  if (fields.isDefault !== undefined) updates.isDefault = fields.isDefault;

  if (Object.keys(updates).length === 0) {
    return errorResponse('No fields to update', 'INVALID_PARAM');
  }

  updates.updated = new Date();

  try {
    const Taxes = mongoose.model('Taxes');
    const result = await Taxes.findOneAndUpdate(
      { _id: id, removed: false },
      { $set: updates },
      { new: true, runValidators: true }
    ).exec();

    if (!result) {
      return errorResponse('No document found', 'NOT_FOUND');
    }

    return successResponse(result);
  } catch (err) {
    return errorResponse(`Failed to update tax: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * delete_tax — Soft-delete a tax.
 */
async function deleteTax(params) {
  const { id } = params;

  if (!id || !isValidObjectId(id)) {
    return errorResponse('Invalid or missing tax ID', 'INVALID_PARAM');
  }

  try {
    const Taxes = mongoose.model('Taxes');

    const existing = await Taxes.findOne({ _id: id, removed: false }).exec();
    if (!existing) {
      return errorResponse('No document found', 'NOT_FOUND');
    }

    const result = await Taxes.findOneAndUpdate(
      { _id: id },
      { $set: { removed: true, enabled: false, updated: new Date() } },
      { new: true }
    ).exec();

    return successResponse(result);
  } catch (err) {
    return errorResponse(`Failed to delete tax: ${err.message}`, 'INTERNAL_ERROR');
  }
}

// ---------------------------------------------------------------------------
// TOOL DEFINITIONS
// ---------------------------------------------------------------------------

const toolDefinitions = {
  get_tax: {
    handler: getTax,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'MongoDB ObjectId of the tax to retrieve',
        },
      },
      required: ['id'],
    },
    description:
      'Get a single tax by ID. Returns tax name, tax value (percentage), enabled status, and whether it is the default. Soft-deleted taxes are excluded.',
    execution: 'backend',
    access: 'authenticated',
    category: 'taxes',
  },

  list_taxes: {
    handler: listTaxes,
    schema: {
      type: 'object',
      properties: {
        page: {
          type: 'integer',
          description: 'Page number (1-indexed)',
          default: 1,
        },
        items: {
          type: 'integer',
          description: 'Items per page',
          default: 10,
        },
        sortBy: {
          type: 'string',
          description: 'Field to sort by',
          default: 'enabled',
        },
        sortValue: {
          type: 'integer',
          description: 'Sort direction: -1 desc, 1 asc',
          enum: [-1, 1],
          default: -1,
        },
        filter: {
          type: 'string',
          description: 'Field name to filter by (use with equal)',
        },
        equal: {
          type: 'string',
          description: 'Value to match for the filter field',
        },
      },
      required: [],
    },
    description:
      'List taxes with pagination and sorting. All parameters are optional — defaults to first page of 10 items sorted by enabled status. Use filter+equal for field matching.',
    execution: 'backend',
    access: 'authenticated',
    category: 'taxes',
  },

  search_taxes: {
    handler: searchTaxes,
    schema: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Search term — case-insensitive match against tax name',
        },
      },
      required: ['q'],
    },
    description:
      'Search taxes by keyword on the tax name field. Returns max 20 results. Use this to find a tax by name or resolve a tax name to an ID.',
    execution: 'backend',
    access: 'authenticated',
    category: 'taxes',
  },

  create_tax: {
    handler: createTax,
    schema: {
      type: 'object',
      properties: {
        taxName: {
          type: 'string',
          description: 'Name of the tax (required, e.g., "VAT", "Sales Tax", "GST")',
        },
        taxValue: {
          type: 'string',
          description: 'Tax percentage value (required, e.g., "20" for 20%)',
        },
        isDefault: {
          type: 'boolean',
          description: 'Whether this is the default tax',
        },
        enabled: {
          type: 'boolean',
          description: 'Whether this tax is active',
        },
      },
      required: ['taxName', 'taxValue'],
    },
    description:
      'Create a new tax. Both taxName and taxValue are required. NEVER use placeholder values — ask the user for the name and rate first.',
    execution: 'backend',
    access: 'authenticated',
    category: 'taxes',
  },

  update_tax: {
    handler: updateTax,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'MongoDB ObjectId of the tax to update',
        },
        taxName: {
          type: 'string',
          description: 'Updated tax name',
        },
        taxValue: {
          type: 'string',
          description: 'Updated tax percentage value',
        },
        enabled: {
          type: 'boolean',
          description: 'Enable or disable the tax',
        },
        isDefault: {
          type: 'boolean',
          description: 'Set or unset as the default tax',
        },
      },
      required: ['id'],
    },
    description:
      "Update a tax's details. Pass the ID and only the fields to change. At least one field besides id is required. Changing a tax does NOT retroactively affect existing invoices.",
    execution: 'backend',
    access: 'authenticated',
    category: 'taxes',
  },

  delete_tax: {
    handler: deleteTax,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'MongoDB ObjectId of the tax to delete',
        },
      },
      required: ['id'],
    },
    description:
      'Soft-delete a tax by setting removed to true. Invoices that used this tax rate are NOT affected. ⚠️ DESTRUCTIVE: Always ask for user confirmation before calling this tool.',
    execution: 'backend',
    access: 'authenticated',
    category: 'taxes',
    confirmBefore: true,
  },

  navigate_to_taxes: {
    schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    description:
      'Navigate to the taxes management page. Shows a CRUD layout with tax list and create/edit panels.',
    execution: 'frontend',
    access: 'authenticated',
    category: 'taxes',
    frontendAction: {
      type: 'navigate',
      route: '/taxes',
    },
  },
};

// ---------------------------------------------------------------------------
// REGISTRATION
// ---------------------------------------------------------------------------

function register() {
  registerCategory(
    'taxes',
    'Tax management — CRUD operations, search, and navigation to taxes page. Taxes are lookup values used when creating invoices.'
  );
  registerTools(toolDefinitions);
}

module.exports = {
  getTax,
  listTaxes,
  searchTaxes,
  createTax,
  updateTax,
  deleteTax,
  toolDefinitions,
  register,
};
