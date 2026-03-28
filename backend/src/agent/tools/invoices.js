/**
 * Invoice Tools — Phase 3
 *
 * Tools: get_invoice, list_invoices, search_invoices, get_invoice_summary,
 *        create_invoice, update_invoice, delete_invoice,
 *        navigate_to_invoice, navigate_to_invoices, navigate_to_create_invoice
 *
 * Category: invoices
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
 * get_invoice — Get a single invoice by ID with populated client and creator.
 */
async function getInvoice(params) {
  const { id } = params;
  if (!id || !isValidObjectId(id)) {
    return errorResponse('Invalid or missing invoice ID', 'INVALID_PARAM');
  }

  try {
    const Invoice = mongoose.model('Invoice');
    const result = await Invoice.findOne({ _id: id, removed: false })
      .populate('createdBy', 'name')
      .exec();

    if (!result) {
      return errorResponse('No document found', 'NOT_FOUND');
    }

    return successResponse(result);
  } catch (err) {
    return errorResponse(`Failed to fetch invoice: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * list_invoices — List invoices with pagination, sorting, and filtering.
 */
async function listInvoices(params) {
  try {
    const Invoice = mongoose.model('Invoice');

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
      Invoice.find(query)
        .skip(skip)
        .limit(limit)
        .sort({ [sortBy]: sortValue })
        .populate('createdBy', 'name')
        .exec(),
      Invoice.countDocuments(query),
    ]);

    const pages = Math.ceil(count / limit);

    return successResponse(result, {
      pagination: { page, pages, count },
    });
  } catch (err) {
    return errorResponse(`Failed to list invoices: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * search_invoices — Search invoices by keyword across specified fields.
 */
async function searchInvoices(params) {
  const { q, fields = 'notes,content' } = params;

  if (!q || !q.trim()) {
    return errorResponse('Search term (q) is required', 'INVALID_PARAM');
  }

  try {
    const Invoice = mongoose.model('Invoice');
    const fieldsArray = fields.split(',');
    const escaped = escapeRegex(q);

    const searchQuery = {
      $or: fieldsArray.map((f) => ({
        [f.trim()]: { $regex: new RegExp(escaped, 'i') },
      })),
    };

    const results = await Invoice.find(searchQuery).where('removed', false).limit(20).exec();

    return successResponse(results);
  } catch (err) {
    return errorResponse(`Failed to search invoices: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * get_invoice_summary — Get invoice financial summary with status distribution.
 */
async function getInvoiceSummary(params) {
  const type = params.type || 'month';

  if (!['week', 'month', 'year'].includes(type)) {
    return errorResponse(
      'Invalid type parameter. Must be week, month, or year.',
      'INVALID_PARAM'
    );
  }

  try {
    const Invoice = mongoose.model('Invoice');

    const statuses = ['draft', 'pending', 'overdue', 'paid', 'unpaid', 'partially'];

    const response = await Invoice.aggregate([
      {
        $match: {
          removed: false,
        },
      },
      {
        $facet: {
          totalInvoice: [
            {
              $group: {
                _id: null,
                total: { $sum: '$total' },
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                total: '$total',
                count: '$count',
              },
            },
          ],
          statusCounts: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                status: '$_id',
                count: '$count',
              },
            },
          ],
          paymentStatusCounts: [
            {
              $group: {
                _id: '$paymentStatus',
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                status: '$_id',
                count: '$count',
              },
            },
          ],
          overdueCounts: [
            {
              $match: {
                expiredDate: { $lt: new Date() },
              },
            },
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                status: '$_id',
                count: '$count',
              },
            },
          ],
        },
      },
    ]);

    let result = [];

    const totalInvoices = response[0].totalInvoice ? response[0].totalInvoice[0] : 0;
    const statusResult = response[0].statusCounts || [];
    const paymentStatusResult = response[0].paymentStatusCounts || [];
    const overdueResult = response[0].overdueCounts || [];

    const totalCount = totalInvoices ? totalInvoices.count : 0;

    const statusResultMap = statusResult.map((item) => ({
      ...item,
      percentage: totalCount > 0 ? Math.round((item.count / totalCount) * 100) : 0,
    }));

    const paymentStatusResultMap = paymentStatusResult.map((item) => ({
      ...item,
      percentage: totalCount > 0 ? Math.round((item.count / totalCount) * 100) : 0,
    }));

    const overdueResultMap = overdueResult.map((item) => ({
      ...item,
      status: 'overdue',
      percentage: totalCount > 0 ? Math.round((item.count / totalCount) * 100) : 0,
    }));

    statuses.forEach((status) => {
      const found = [...paymentStatusResultMap, ...statusResultMap, ...overdueResultMap].find(
        (item) => item.status === status
      );
      if (found) {
        result.push(found);
      }
    });

    // Calculate total undue (unpaid + partially)
    const unpaid = await Invoice.aggregate([
      {
        $match: {
          removed: false,
          paymentStatus: { $in: ['unpaid', 'partially'] },
        },
      },
      {
        $group: {
          _id: null,
          total_amount: {
            $sum: { $subtract: ['$total', '$credit'] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          total_amount: '$total_amount',
        },
      },
    ]);

    const finalResult = {
      total: totalInvoices ? totalInvoices.total : 0,
      total_undue: unpaid.length > 0 ? unpaid[0].total_amount : 0,
      type,
      performance: result,
    };

    return successResponse(finalResult);
  } catch (err) {
    return errorResponse(`Failed to get invoice summary: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * create_invoice — Create a new invoice with line items.
 * Server-side calculates subTotal, taxTotal, total. Auto-increments last_invoice_number.
 */
async function createInvoice(params, context) {
  try {
    const Invoice = mongoose.model('Invoice');

    const { items = [], taxRate = 0, discount = 0 } = params;

    if (!items.length) {
      return errorResponse('Items array cannot be empty', 'INVALID_PARAM');
    }

    // Calculate totals
    let subTotal = 0;
    items.forEach((item) => {
      const lineTotal = item.quantity * item.price;
      subTotal += lineTotal;
      item.total = lineTotal;
    });

    const taxTotal = subTotal * (taxRate / 100);
    const total = subTotal + taxTotal;

    const paymentStatus = total - discount === 0 ? 'paid' : 'unpaid';

    const body = {
      client: params.client,
      number: params.number,
      year: params.year,
      status: params.status || 'draft',
      date: params.date,
      expiredDate: params.expiredDate,
      taxRate,
      items,
      subTotal,
      taxTotal,
      total,
      discount,
      paymentStatus,
      createdBy: context.userId,
      notes: params.notes,
    };

    if (params.currency) {
      body.currency = params.currency;
    }

    const result = await new Invoice(body).save();

    // Set PDF filename
    const fileId = 'invoice-' + result._id + '.pdf';
    const updateResult = await Invoice.findOneAndUpdate(
      { _id: result._id },
      { pdf: fileId },
      { new: true }
    ).exec();

    // Auto-increment invoice number setting
    try {
      const Setting = mongoose.model('Setting');
      await Setting.findOneAndUpdate(
        { settingKey: 'last_invoice_number' },
        { $inc: { settingValue: 1 } },
        { new: true, runValidators: true }
      ).exec();
    } catch {
      // Non-critical — don't fail the invoice creation
    }

    return successResponse(updateResult || result);
  } catch (err) {
    if (err.name === 'ValidationError') {
      return errorResponse(`Validation failed: ${err.message}`, 'VALIDATION_ERROR');
    }
    return errorResponse(`Failed to create invoice: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * update_invoice — Update an existing invoice. Recalculates totals when items change.
 */
async function updateInvoice(params) {
  const { id, ...updateFields } = params;

  if (!id || !isValidObjectId(id)) {
    return errorResponse('Invalid or missing invoice ID', 'INVALID_PARAM');
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
    const Invoice = mongoose.model('Invoice');

    // Get the previous invoice for credit info
    const previousInvoice = await Invoice.findOne({ _id: id, removed: false });
    if (!previousInvoice) {
      return errorResponse('No document found', 'NOT_FOUND');
    }

    const { credit } = previousInvoice;

    // If items are being updated, recalculate totals
    if (fields.items && fields.items.length > 0) {
      const taxRate = fields.taxRate !== undefined ? fields.taxRate : previousInvoice.taxRate;
      const discount = fields.discount !== undefined ? fields.discount : previousInvoice.discount;

      let subTotal = 0;
      fields.items.forEach((item) => {
        const lineTotal = item.quantity * item.price;
        subTotal += lineTotal;
        item.total = lineTotal;
      });

      const taxTotal = subTotal * (taxRate / 100);
      const total = subTotal + taxTotal;

      fields.subTotal = subTotal;
      fields.taxTotal = taxTotal;
      fields.total = total;

      // Recalculate payment status
      const effectiveTotal = total - discount;
      if (effectiveTotal === credit) {
        fields.paymentStatus = 'paid';
      } else if (credit > 0) {
        fields.paymentStatus = 'partially';
      } else {
        fields.paymentStatus = 'unpaid';
      }
    } else if (fields.discount !== undefined || fields.taxRate !== undefined) {
      // Recalculate if discount or taxRate changed without items
      const items = previousInvoice.items;
      const taxRate = fields.taxRate !== undefined ? fields.taxRate : previousInvoice.taxRate;
      const discount = fields.discount !== undefined ? fields.discount : previousInvoice.discount;

      let subTotal = 0;
      items.forEach((item) => {
        subTotal += item.total;
      });

      const taxTotal = subTotal * (taxRate / 100);
      const total = subTotal + taxTotal;

      fields.subTotal = subTotal;
      fields.taxTotal = taxTotal;
      fields.total = total;

      const effectiveTotal = total - discount;
      if (effectiveTotal === credit) {
        fields.paymentStatus = 'paid';
      } else if (credit > 0) {
        fields.paymentStatus = 'partially';
      } else {
        fields.paymentStatus = 'unpaid';
      }
    }

    // Currency cannot be changed
    delete fields.currency;

    // Prevent toggling removed via update
    fields.removed = false;

    // Set PDF filename
    fields.pdf = 'invoice-' + id + '.pdf';

    const result = await Invoice.findOneAndUpdate({ _id: id, removed: false }, fields, {
      new: true,
    }).exec();

    if (!result) {
      return errorResponse('No document found', 'NOT_FOUND');
    }

    return successResponse(result);
  } catch (err) {
    if (err.name === 'ValidationError') {
      return errorResponse(`Validation failed: ${err.message}`, 'VALIDATION_ERROR');
    }
    return errorResponse(`Failed to update invoice: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * delete_invoice — Soft-delete an invoice and cascade to related payments.
 */
async function deleteInvoice(params) {
  const { id } = params;

  if (!id || !isValidObjectId(id)) {
    return errorResponse('Invalid or missing invoice ID', 'INVALID_PARAM');
  }

  try {
    const Invoice = mongoose.model('Invoice');
    const Payment = mongoose.model('Payment');

    const deletedInvoice = await Invoice.findOneAndUpdate(
      { _id: id, removed: false },
      { $set: { removed: true } },
      { new: false }
    ).exec();

    if (!deletedInvoice) {
      return errorResponse('No document found', 'NOT_FOUND');
    }

    // Cascade soft-delete to related payments
    await Payment.updateMany({ invoice: deletedInvoice._id }, { $set: { removed: true } });

    return successResponse(deletedInvoice);
  } catch (err) {
    return errorResponse(`Failed to delete invoice: ${err.message}`, 'INTERNAL_ERROR');
  }
}

// ---------------------------------------------------------------------------
// TOOL DEFINITIONS
// ---------------------------------------------------------------------------

const toolDefinitions = {
  get_invoice: {
    handler: getInvoice,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'MongoDB ObjectId of the invoice to retrieve',
        },
      },
      required: ['id'],
    },
    description:
      'Get a single invoice by ID. Returns full invoice details including line items, client info (auto-populated), totals, tax, payment status, and creation metadata. The client field is automatically populated with full client details via mongoose-autopopulate. The createdBy field is populated with admin user info. Use this to retrieve complete invoice data before presenting details, updating, or performing any invoice-related action.',
    execution: 'backend',
    access: 'authenticated',
    category: 'invoices',
  },

  list_invoices: {
    handler: listInvoices,
    schema: {
      type: 'object',
      properties: {
        page: {
          type: 'integer',
          description: 'Page number for pagination',
          default: 1,
        },
        items: {
          type: 'integer',
          description: 'Number of items per page',
          default: 10,
        },
        sortBy: {
          type: 'string',
          description: 'Field name to sort by',
          default: 'enabled',
        },
        sortValue: {
          type: 'integer',
          description: 'Sort direction: -1 for descending, 1 for ascending',
          enum: [-1, 1],
          default: -1,
        },
        filter: {
          type: 'string',
          description:
            "Field name to filter on (e.g., 'status', 'paymentStatus', 'client')",
        },
        equal: {
          type: 'string',
          description:
            "Value to match for the filter field (e.g., 'sent', 'paid', a client ObjectId)",
        },
        q: {
          type: 'string',
          description:
            'Search keyword for inline text search across the fields specified by the fields parameter',
        },
        fields: {
          type: 'string',
          description:
            'Comma-separated field names to search in when using q parameter',
        },
      },
      required: [],
    },
    description:
      'List invoices with pagination, sorting, and filtering. Filter by status, paymentStatus, client, or any field. Supports inline text search via the q and fields parameters. Returns paginated results with populated client and creator info. Use the filter/equal pair to narrow results (e.g., filter=status, equal=sent). Use q with fields to do a keyword search across specified fields. Default sort is by the enabled field descending. Each page returns up to the specified number of items (default 10).',
    execution: 'backend',
    access: 'authenticated',
    category: 'invoices',
  },

  search_invoices: {
    handler: searchInvoices,
    schema: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description:
            'Search keyword — matched as a case-insensitive regex against the specified fields',
        },
        fields: {
          type: 'string',
          description:
            "Comma-separated list of field names to search across (e.g., 'notes,content')",
          default: 'notes,content',
        },
      },
      required: ['q'],
    },
    description:
      "Search invoices by keyword across specified fields. Uses case-insensitive regex matching. Returns max 20 results. The Invoice model has no `name` field — you MUST specify the `fields` parameter. Use `fields: \"notes,content\"` to search by text content, or `fields: \"number\"` to search by invoice number. Searching by client name is not supported here (client is a populated ObjectId); use `list_invoices` with a filter instead. Use this when the user wants to find a specific invoice but does not have its ID.",
    execution: 'backend',
    access: 'authenticated',
    category: 'invoices',
  },

  get_invoice_summary: {
    handler: getInvoiceSummary,
    schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Time period for the summary aggregation',
          enum: ['week', 'month', 'year'],
          default: 'month',
        },
      },
      required: [],
    },
    description:
      'Get invoice financial summary for a time period. Returns total invoice amount, invoice count, status distribution (draft/pending/sent/refunded/cancelled/on hold), payment status distribution (unpaid/paid/partially), and overdue totals. Uses a MongoDB $facet aggregation pipeline. The type parameter controls the time window: \'week\' for the current week, \'month\' for the current month, \'year\' for the current year. Useful for financial dashboards, reporting, and answering questions like "how much have we invoiced this month?" or "how many unpaid invoices do we have?"',
    execution: 'backend',
    access: 'authenticated',
    category: 'invoices',
  },

  create_invoice: {
    handler: createInvoice,
    schema: {
      type: 'object',
      properties: {
        client: {
          type: 'string',
          description:
            'MongoDB ObjectId of the client this invoice is for. Look up the client ID using search_clients or list_clients first — never ask the user for a raw ID.',
        },
        number: {
          type: 'integer',
          description:
            'Invoice number. Typically auto-incremented — retrieve the next number from settings before creating.',
        },
        year: {
          type: 'integer',
          description: 'Invoice year (e.g., 2025)',
        },
        status: {
          type: 'string',
          description: 'Invoice status',
          enum: ['draft', 'pending', 'sent', 'refunded', 'cancelled', 'on hold'],
          default: 'draft',
        },
        date: {
          type: 'string',
          description: "Invoice date in ISO 8601 format (e.g., '2025-06-01')",
        },
        expiredDate: {
          type: 'string',
          description: "Invoice due/expiry date in ISO 8601 format (e.g., '2025-07-01')",
        },
        taxRate: {
          type: 'number',
          description: 'Tax rate as a percentage (e.g., 10 for 10%)',
        },
        items: {
          type: 'array',
          description: 'Array of line items on the invoice',
          items: {
            type: 'object',
            properties: {
              itemName: {
                type: 'string',
                description: 'Name of the item or service',
              },
              description: {
                type: 'string',
                description: 'Optional description of the item',
              },
              quantity: {
                type: 'number',
                description: 'Quantity of the item',
              },
              price: {
                type: 'number',
                description: 'Unit price of the item',
              },
              total: {
                type: 'number',
                description: 'Line total (quantity * price)',
              },
            },
            required: ['itemName', 'quantity', 'price', 'total'],
          },
        },
        discount: {
          type: 'number',
          description: 'Discount amount applied to the invoice total',
          default: 0,
        },
        notes: {
          type: 'string',
          description: 'Additional notes or payment terms for the invoice',
        },
        currency: {
          type: 'string',
          description:
            "Currency code (e.g., 'USD', 'EUR'). Defaults to the application's configured currency from settings. Only specify if the user explicitly requests a different currency.",
        },
      },
      required: ['client', 'number', 'year', 'status', 'date', 'expiredDate', 'taxRate', 'items'],
    },
    description:
      "Create a new invoice with line items. Requires client ID, invoice number, year, status, date, due date, tax rate, and at least one line item. All monetary totals (subTotal, taxTotal, total) are auto-calculated server-side from the items array. The invoice number is auto-incremented via the `last_invoice_number` setting. The createdBy field is auto-set to the authenticated admin. If total minus discount equals zero, paymentStatus is set to 'paid'; otherwise 'unpaid'. NEVER use placeholder values — ask the user for client, items, dates, and tax rate if not provided. Use this tool when the user provides invoice details conversationally. If they prefer to fill out the visual form, use navigate_to_create_invoice instead.",
    execution: 'backend',
    access: 'authenticated',
    category: 'invoices',
  },

  update_invoice: {
    handler: updateInvoice,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'MongoDB ObjectId of the invoice to update',
        },
        client: {
          type: 'string',
          description: 'MongoDB ObjectId of the client (to change the client on the invoice)',
        },
        number: {
          type: 'integer',
          description: 'Invoice number',
        },
        year: {
          type: 'integer',
          description: 'Invoice year',
        },
        status: {
          type: 'string',
          description: 'Invoice status',
          enum: ['draft', 'pending', 'sent', 'refunded', 'cancelled', 'on hold'],
        },
        date: {
          type: 'string',
          description: 'Invoice date in ISO 8601 format',
        },
        expiredDate: {
          type: 'string',
          description: 'Invoice due/expiry date in ISO 8601 format',
        },
        taxRate: {
          type: 'number',
          description: 'Tax rate as a percentage (e.g., 10 for 10%)',
        },
        items: {
          type: 'array',
          description:
            'Replaces the entire items array — provide all line items, not just changed ones',
          items: {
            type: 'object',
            properties: {
              itemName: {
                type: 'string',
                description: 'Name of the item or service',
              },
              description: {
                type: 'string',
                description: 'Optional description of the item',
              },
              quantity: {
                type: 'number',
                description: 'Quantity of the item',
              },
              price: {
                type: 'number',
                description: 'Unit price of the item',
              },
              total: {
                type: 'number',
                description: 'Line total (quantity * price)',
              },
            },
            required: ['itemName', 'quantity', 'price', 'total'],
          },
        },
        discount: {
          type: 'number',
          description: 'Discount amount applied to the invoice total',
        },
        notes: {
          type: 'string',
          description: 'Additional notes or payment terms',
        },
      },
      required: ['id'],
    },
    description:
      "Update an existing invoice. Pass only the fields that need to change — all other fields remain untouched. If items are updated, the server automatically recalculates subTotal, taxTotal, and total. Currency cannot be changed after creation (it is stripped server-side from the request body). Payment status is recalculated based on existing credit: if total - discount - credit equals zero, paymentStatus becomes 'paid'; if credit is greater than zero but less than total - discount, it becomes 'partially'; otherwise it stays 'unpaid'. Always retrieve the invoice first to confirm it exists before updating.",
    execution: 'backend',
    access: 'authenticated',
    category: 'invoices',
  },

  delete_invoice: {
    handler: deleteInvoice,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'MongoDB ObjectId of the invoice to soft-delete',
        },
      },
      required: ['id'],
    },
    description:
      'Soft-delete an invoice and ALL related payments. Sets removed=true on the invoice and cascades to all payments linked to this invoice via Payment.updateMany. The invoice and its payments are not permanently destroyed but will no longer appear in list, search, or summary results. This action cannot be easily undone — there is no restore endpoint. \u26A0\uFE0F DESTRUCTIVE: Always ask for user confirmation before calling this tool.',
    execution: 'backend',
    access: 'authenticated',
    category: 'invoices',
    confirmBefore: true,
  },

  navigate_to_invoices: {
    schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    description:
      'Navigate to the invoice list page. Displays a data table of all invoices with columns for number, client name, date, due date, total, paid amount, status, and payment status. Users can create new invoices, view details, edit, delete, and record payments from this page.',
    execution: 'frontend',
    access: 'authenticated',
    category: 'invoices',
    frontendAction: {
      type: 'navigate',
      route: '/invoice',
    },
  },

  navigate_to_invoice: {
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'MongoDB ObjectId of the invoice to view',
        },
      },
      required: ['id'],
    },
    description:
      'Navigate to a single invoice detail page. Shows the full invoice with line items, totals, payment history, and status. Pass the invoice ID to open its detail view.',
    execution: 'frontend',
    access: 'authenticated',
    category: 'invoices',
    frontendAction: {
      type: 'navigate',
      route: '/invoice/read/:id',
    },
  },

  navigate_to_create_invoice: {
    schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    description:
      'Navigate to the new invoice creation form. The form includes client selection (searchable dropdown), line item entry (name, description, quantity, price with auto-calculated totals), tax rate selection, date and due date pickers, status selection, currency, discount, and notes. Use this when the user wants to create an invoice through the visual form rather than providing details conversationally.',
    execution: 'frontend',
    access: 'authenticated',
    category: 'invoices',
    frontendAction: {
      type: 'navigate',
      route: '/invoice/create',
    },
  },
};

// ---------------------------------------------------------------------------
// REGISTRATION
// ---------------------------------------------------------------------------

function register() {
  registerCategory(
    'invoices',
    'Invoice management — CRUD operations, search, financial summary, and navigation to invoice pages.'
  );
  registerTools(toolDefinitions);
}

module.exports = {
  getInvoice,
  listInvoices,
  searchInvoices,
  getInvoiceSummary,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  toolDefinitions,
  register,
};
