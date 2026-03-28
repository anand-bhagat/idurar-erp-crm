/**
 * Payment Mode Tools
 *
 * Tools: get_payment_mode, list_payment_modes, search_payment_modes,
 *        create_payment_mode, update_payment_mode, delete_payment_mode,
 *        navigate_to_payment_modes
 *
 * Category: payment_modes
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
 * get_payment_mode — Get a single payment mode by ID.
 */
async function getPaymentMode(params) {
  const { id } = params;
  if (!id || !isValidObjectId(id)) {
    return errorResponse('Invalid or missing payment mode ID', 'INVALID_PARAM');
  }

  try {
    const PaymentMode = mongoose.model('PaymentMode');
    const result = await PaymentMode.findOne({ _id: id, removed: false }).exec();

    if (!result) {
      return errorResponse('No document found', 'NOT_FOUND');
    }

    return successResponse(result);
  } catch (err) {
    return errorResponse(`Failed to fetch payment mode: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * list_payment_modes — List payment modes with pagination and sorting.
 */
async function listPaymentModes(params) {
  try {
    const PaymentMode = mongoose.model('PaymentMode');

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
      PaymentMode.find(query)
        .skip(skip)
        .limit(limit)
        .sort({ [sortBy]: sortValue })
        .exec(),
      PaymentMode.countDocuments(query),
    ]);

    const pages = Math.ceil(count / limit);

    return successResponse(result, {
      pagination: { page, pages, count },
    });
  } catch (err) {
    return errorResponse(`Failed to list payment modes: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * search_payment_modes — Search payment modes by keyword across name and description.
 */
async function searchPaymentModes(params) {
  const { q } = params;
  if (!q || !q.trim()) {
    return errorResponse('Search query is required', 'INVALID_PARAM');
  }

  try {
    const PaymentMode = mongoose.model('PaymentMode');
    const escaped = escapeRegex(q.trim());
    const regex = new RegExp(escaped, 'i');

    const result = await PaymentMode.find({
      removed: false,
      $or: [{ name: { $regex: regex } }, { description: { $regex: regex } }],
    })
      .limit(20)
      .exec();

    return successResponse(result);
  } catch (err) {
    return errorResponse(`Failed to search payment modes: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * create_payment_mode — Create a new payment mode.
 */
async function createPaymentMode(params, context) {
  const { name, description, isDefault, enabled } = params;

  if (!name || !name.trim()) {
    return errorResponse('Payment mode name is required', 'INVALID_PARAM');
  }

  try {
    const PaymentMode = mongoose.model('PaymentMode');

    const doc = { name: name.trim() };
    if (description !== undefined) doc.description = description;
    if (isDefault !== undefined) doc.isDefault = isDefault;
    if (enabled !== undefined) doc.enabled = enabled;

    const result = await PaymentMode.create(doc);
    return successResponse(result);
  } catch (err) {
    if (err.name === 'ValidationError') {
      return errorResponse(`Validation failed: ${err.message}`, 'VALIDATION_ERROR');
    }
    return errorResponse(`Failed to create payment mode: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * update_payment_mode — Update a payment mode's details.
 */
async function updatePaymentMode(params) {
  const { id, ...fields } = params;

  if (!id || !isValidObjectId(id)) {
    return errorResponse('Invalid or missing payment mode ID', 'INVALID_PARAM');
  }

  // Build update object from only the fields that were provided
  const updates = {};
  if (fields.name !== undefined) updates.name = fields.name;
  if (fields.description !== undefined) updates.description = fields.description;
  if (fields.enabled !== undefined) updates.enabled = fields.enabled;
  if (fields.isDefault !== undefined) updates.isDefault = fields.isDefault;

  if (Object.keys(updates).length === 0) {
    return errorResponse('No fields to update', 'INVALID_PARAM');
  }

  updates.updated = new Date();

  try {
    const PaymentMode = mongoose.model('PaymentMode');
    const result = await PaymentMode.findOneAndUpdate(
      { _id: id, removed: false },
      { $set: updates },
      { new: true, runValidators: true }
    ).exec();

    if (!result) {
      return errorResponse('No document found', 'NOT_FOUND');
    }

    return successResponse(result);
  } catch (err) {
    return errorResponse(`Failed to update payment mode: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * delete_payment_mode — Soft-delete a payment mode.
 */
async function deletePaymentMode(params) {
  const { id } = params;

  if (!id || !isValidObjectId(id)) {
    return errorResponse('Invalid or missing payment mode ID', 'INVALID_PARAM');
  }

  try {
    const PaymentMode = mongoose.model('PaymentMode');

    const existing = await PaymentMode.findOne({ _id: id, removed: false }).exec();
    if (!existing) {
      return errorResponse('No document found', 'NOT_FOUND');
    }

    const result = await PaymentMode.findOneAndUpdate(
      { _id: id },
      { $set: { removed: true, enabled: false, updated: new Date() } },
      { new: true }
    ).exec();

    return successResponse(result);
  } catch (err) {
    return errorResponse(`Failed to delete payment mode: ${err.message}`, 'INTERNAL_ERROR');
  }
}

// ---------------------------------------------------------------------------
// TOOL DEFINITIONS
// ---------------------------------------------------------------------------

const toolDefinitions = {
  get_payment_mode: {
    handler: getPaymentMode,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'MongoDB ObjectId of the payment mode to retrieve',
        },
      },
      required: ['id'],
    },
    description:
      'Get a single payment mode by ID. Returns name, description, enabled status, and whether it is the default. Soft-deleted payment modes are excluded.',
    execution: 'backend',
    access: 'authenticated',
    category: 'payment_modes',
  },

  list_payment_modes: {
    handler: listPaymentModes,
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
      'List payment modes with pagination and sorting. All parameters are optional — defaults to first page of 10 items sorted by enabled status. Use filter+equal for field matching.',
    execution: 'backend',
    access: 'authenticated',
    category: 'payment_modes',
  },

  search_payment_modes: {
    handler: searchPaymentModes,
    schema: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Search term — case-insensitive match against name and description',
        },
      },
      required: ['q'],
    },
    description:
      'Search payment modes by keyword across name and description fields. Returns max 20 results. Use this to find a payment mode by name or resolve a name to an ID.',
    execution: 'backend',
    access: 'authenticated',
    category: 'payment_modes',
  },

  create_payment_mode: {
    handler: createPaymentMode,
    schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the payment mode (required)',
        },
        description: {
          type: 'string',
          description: 'Optional description',
        },
        isDefault: {
          type: 'boolean',
          description: 'Whether this is the default payment mode',
        },
        enabled: {
          type: 'boolean',
          description: 'Whether this payment mode is active',
        },
      },
      required: ['name'],
    },
    description:
      'Create a new payment mode. Only name is required. NEVER use placeholder values — ask the user for the name first.',
    execution: 'backend',
    access: 'authenticated',
    category: 'payment_modes',
  },

  update_payment_mode: {
    handler: updatePaymentMode,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'MongoDB ObjectId of the payment mode to update',
        },
        name: {
          type: 'string',
          description: 'Updated name',
        },
        description: {
          type: 'string',
          description: 'Updated description',
        },
        enabled: {
          type: 'boolean',
          description: 'Enable or disable the payment mode',
        },
        isDefault: {
          type: 'boolean',
          description: 'Set or unset as the default payment mode',
        },
      },
      required: ['id'],
    },
    description:
      "Update a payment mode's details. Pass the ID and only the fields to change. At least one field besides id is required.",
    execution: 'backend',
    access: 'authenticated',
    category: 'payment_modes',
  },

  delete_payment_mode: {
    handler: deletePaymentMode,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'MongoDB ObjectId of the payment mode to delete',
        },
      },
      required: ['id'],
    },
    description:
      'Soft-delete a payment mode by setting removed to true. Payments referencing this mode are NOT affected. ⚠️ DESTRUCTIVE: Always ask for user confirmation before calling this tool.',
    execution: 'backend',
    access: 'authenticated',
    category: 'payment_modes',
    confirmBefore: true,
  },

  navigate_to_payment_modes: {
    schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    description:
      'Navigate to the payment modes management page. Shows a CRUD layout with payment mode list and create/edit panels.',
    execution: 'frontend',
    access: 'authenticated',
    category: 'payment_modes',
    frontendAction: {
      type: 'navigate',
      route: '/payment/mode',
    },
  },
};

// ---------------------------------------------------------------------------
// REGISTRATION
// ---------------------------------------------------------------------------

function register() {
  registerCategory(
    'payment_modes',
    'Payment mode management — CRUD operations, search, and navigation to payment modes page.'
  );
  registerTools(toolDefinitions);
}

module.exports = {
  getPaymentMode,
  listPaymentModes,
  searchPaymentModes,
  createPaymentMode,
  updatePaymentMode,
  deletePaymentMode,
  toolDefinitions,
  register,
};
