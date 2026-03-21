/**
 * Client Tools — Phase 2 (Reference Implementation)
 *
 * Tools: get_client, list_clients, search_clients, get_client_summary,
 *        create_client, update_client, delete_client, navigate_to_customers
 *
 * Category: clients
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
 * get_client — Get a single client by ID.
 */
async function getClient(params) {
  const { id } = params;
  if (!id || !isValidObjectId(id)) {
    return errorResponse('Invalid or missing client ID', 'INVALID_PARAM');
  }

  try {
    const Client = mongoose.model('Client');
    const result = await Client.findOne({ _id: id, removed: false }).exec();

    if (!result) {
      return errorResponse('No document found', 'NOT_FOUND');
    }

    return successResponse(result);
  } catch (err) {
    return errorResponse(`Failed to fetch client: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * list_clients — List clients with pagination, sorting, and filtering.
 */
async function listClients(params) {
  try {
    const Client = mongoose.model('Client');

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

    // Build text search fields
    let fields = {};
    if (params.q && params.fields) {
      const fieldsArray = params.fields.split(',');
      const escaped = escapeRegex(params.q);
      fields = {
        $or: fieldsArray.map((f) => ({
          [f.trim()]: { $regex: new RegExp(escaped, 'i') },
        })),
      };
    }

    const query = { removed: false, ...filterCondition, ...fields };

    const [result, count] = await Promise.all([
      Client.find(query)
        .skip(skip)
        .limit(limit)
        .sort({ [sortBy]: sortValue })
        .populate()
        .exec(),
      Client.countDocuments(query),
    ]);

    const pages = Math.ceil(count / limit);

    return successResponse(result, {
      pagination: { page, pages, count },
    });
  } catch (err) {
    return errorResponse(`Failed to list clients: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * search_clients — Search clients by keyword across specified fields.
 */
async function searchClients(params) {
  const { q, fields = 'name' } = params;

  if (!q || !q.trim()) {
    return errorResponse('Search term (q) is required', 'INVALID_PARAM');
  }

  try {
    const Client = mongoose.model('Client');
    const fieldsArray = fields.split(',');
    const escaped = escapeRegex(q);

    const searchQuery = {
      $or: fieldsArray.map((f) => ({
        [f.trim()]: { $regex: new RegExp(escaped, 'i') },
      })),
    };

    const results = await Client.find(searchQuery).where('removed', false).limit(20).exec();

    return successResponse(results);
  } catch (err) {
    return errorResponse(`Failed to search clients: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * get_client_summary — Get new/active client percentage statistics.
 */
async function getClientSummary(params) {
  const type = params.type || 'month';

  if (!['week', 'month', 'year'].includes(type)) {
    return errorResponse(
      'Invalid type parameter. Must be week, month, or year.',
      'INVALID_PARAM'
    );
  }

  try {
    const Client = mongoose.model('Client');
    const InvoiceModel = mongoose.model('Invoice');
    const moment = require('moment');

    const currentDate = moment();
    const startDate = currentDate.clone().startOf(type);
    const endDate = currentDate.clone().endOf(type);

    const pipeline = [
      {
        $facet: {
          totalClients: [
            { $match: { removed: false, enabled: true } },
            { $count: 'count' },
          ],
          newClients: [
            {
              $match: {
                removed: false,
                created: { $gte: startDate.toDate(), $lte: endDate.toDate() },
                enabled: true,
              },
            },
            { $count: 'count' },
          ],
          activeClients: [
            {
              $lookup: {
                from: InvoiceModel.collection.name,
                localField: '_id',
                foreignField: 'client',
                as: 'invoice',
              },
            },
            { $match: { 'invoice.removed': false } },
            { $group: { _id: '$_id' } },
            { $count: 'count' },
          ],
        },
      },
    ];

    const aggregationResult = await Client.aggregate(pipeline);
    const result = aggregationResult[0];

    const totalClients = result.totalClients[0] ? result.totalClients[0].count : 0;
    const totalNewClients = result.newClients[0] ? result.newClients[0].count : 0;
    const activeClients = result.activeClients[0] ? result.activeClients[0].count : 0;

    const newPct = totalClients > 0 ? (totalNewClients / totalClients) * 100 : 0;
    const activePct = totalClients > 0 ? (activeClients / totalClients) * 100 : 0;

    return successResponse({
      new: Math.round(newPct),
      active: Math.round(activePct),
    });
  } catch (err) {
    return errorResponse(`Failed to get client summary: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * create_client — Create a new client record.
 */
async function createClient(params, context) {
  try {
    const Client = mongoose.model('Client');

    const result = await Client.create({
      name: params.name,
      email: params.email,
      phone: params.phone,
      country: params.country,
      address: params.address,
      createdBy: context.userId,
      removed: false,
    });

    return successResponse(result);
  } catch (err) {
    if (err.name === 'ValidationError') {
      return errorResponse(`Validation failed: ${err.message}`, 'VALIDATION_ERROR');
    }
    return errorResponse(`Failed to create client: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * update_client — Update an existing client's details.
 */
async function updateClient(params) {
  const { id, ...updateFields } = params;

  if (!id || !isValidObjectId(id)) {
    return errorResponse('Invalid or missing client ID', 'INVALID_PARAM');
  }

  // Filter out undefined values
  const fields = {};
  for (const [key, val] of Object.entries(updateFields)) {
    if (val !== undefined) fields[key] = val;
  }

  if (Object.keys(fields).length === 0) {
    return errorResponse('At least one field to update is required', 'INVALID_PARAM');
  }

  try {
    const Client = mongoose.model('Client');

    // Prevent toggling removed via update
    fields.removed = false;

    const result = await Client.findOneAndUpdate({ _id: id, removed: false }, fields, {
      new: true,
      runValidators: true,
    }).exec();

    if (!result) {
      return errorResponse('No document found', 'NOT_FOUND');
    }

    return successResponse(result);
  } catch (err) {
    if (err.name === 'ValidationError') {
      return errorResponse(`Validation failed: ${err.message}`, 'VALIDATION_ERROR');
    }
    return errorResponse(`Failed to update client: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * delete_client — Soft-delete a client (set removed: true).
 */
async function deleteClient(params) {
  const { id } = params;

  if (!id || !isValidObjectId(id)) {
    return errorResponse('Invalid or missing client ID', 'INVALID_PARAM');
  }

  try {
    const Client = mongoose.model('Client');

    const result = await Client.findOneAndUpdate(
      { _id: id, removed: false },
      { $set: { removed: true } },
      { new: true }
    ).exec();

    if (!result) {
      return errorResponse('No document found', 'NOT_FOUND');
    }

    return successResponse(result);
  } catch (err) {
    return errorResponse(`Failed to delete client: ${err.message}`, 'INTERNAL_ERROR');
  }
}

// ---------------------------------------------------------------------------
// TOOL DEFINITIONS
// ---------------------------------------------------------------------------

const toolDefinitions = {
  get_client: {
    handler: getClient,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'MongoDB ObjectId of the client to retrieve',
        },
      },
      required: ['id'],
    },
    description:
      "Get a single client by ID. Returns client details including name, email, phone, country, address, and creation date. Pass the client's MongoDB ObjectId as the `id` parameter. Soft-deleted clients are excluded.",
    execution: 'backend',
    access: 'authenticated',
    category: 'clients',
  },

  list_clients: {
    handler: listClients,
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
        q: {
          type: 'string',
          description: 'Text search query (use with fields)',
        },
        fields: {
          type: 'string',
          description: 'Comma-separated field names to search (e.g. name,email)',
        },
      },
      required: [],
    },
    description:
      'List clients with pagination, sorting, and filtering. All parameters are optional — defaults to first page of 10 clients sorted by enabled status. Use filter+equal for field matching, q+fields for text search.',
    execution: 'backend',
    access: 'authenticated',
    category: 'clients',
  },

  search_clients: {
    handler: searchClients,
    schema: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Search term — case-insensitive match',
        },
        fields: {
          type: 'string',
          description: 'Comma-separated field names to search (default: name)',
          default: 'name',
        },
      },
      required: ['q'],
    },
    description:
      'Search clients by keyword across specified fields. Returns max 20 results. Use this to find a client by name, email, or other fields. Preferred tool when resolving a client name to an ID.',
    execution: 'backend',
    access: 'authenticated',
    category: 'clients',
  },

  get_client_summary: {
    handler: getClientSummary,
    schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Time period: week, month, or year',
          enum: ['week', 'month', 'year'],
          default: 'month',
        },
      },
      required: [],
    },
    description:
      'Get client statistics showing percentage of new and active clients for a time period. Returns { new: %, active: % }. Active means the client has at least one invoice.',
    execution: 'backend',
    access: 'authenticated',
    category: 'clients',
  },

  create_client: {
    handler: createClient,
    schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Full name or company name (required)',
        },
        email: {
          type: 'string',
          description: 'Email address',
        },
        phone: {
          type: 'string',
          description: 'Phone number',
        },
        country: {
          type: 'string',
          description: 'Country',
        },
        address: {
          type: 'string',
          description: 'Full mailing address',
        },
      },
      required: ['name'],
    },
    description:
      'Create a new client. Only name is required. NEVER use placeholder values — ask the user for details first. The createdBy field is auto-set from the authenticated session.',
    execution: 'backend',
    access: 'authenticated',
    category: 'clients',
  },

  update_client: {
    handler: updateClient,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'MongoDB ObjectId of the client to update',
        },
        name: {
          type: 'string',
          description: 'Updated name',
        },
        email: {
          type: 'string',
          description: 'Updated email',
        },
        phone: {
          type: 'string',
          description: 'Updated phone',
        },
        country: {
          type: 'string',
          description: 'Updated country',
        },
        address: {
          type: 'string',
          description: 'Updated address',
        },
        enabled: {
          type: 'boolean',
          description: 'Enable or disable the client',
        },
      },
      required: ['id'],
    },
    description:
      "Update a client's details. Pass the ID and only the fields to change. At least one field besides id is required.",
    execution: 'backend',
    access: 'authenticated',
    category: 'clients',
  },

  delete_client: {
    handler: deleteClient,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'MongoDB ObjectId of the client to delete',
        },
      },
      required: ['id'],
    },
    description:
      'Soft-delete a client by setting removed to true. The client data is preserved but hidden from listings. Invoices referencing this client are NOT affected.',
    execution: 'backend',
    access: 'authenticated',
    category: 'clients',
    confirmBefore: true,
  },

  navigate_to_customers: {
    schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    description:
      'Navigate to the customer management page. Shows a CRUD layout with client list and create/edit panels.',
    execution: 'frontend',
    access: 'authenticated',
    category: 'clients',
    frontendAction: {
      type: 'navigate',
      route: '/customer',
    },
  },
};

// ---------------------------------------------------------------------------
// REGISTRATION
// ---------------------------------------------------------------------------

function register() {
  registerCategory(
    'clients',
    'Client management — CRUD operations, search, summary statistics, and navigation to client pages.'
  );
  registerTools(toolDefinitions);
}

module.exports = {
  getClient,
  listClients,
  searchClients,
  getClientSummary,
  createClient,
  updateClient,
  deleteClient,
  toolDefinitions,
  register,
};
