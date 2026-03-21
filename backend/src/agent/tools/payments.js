/**
 * Payment Tools — Phase 4
 *
 * Tools: get_payment, list_payments, search_payments, get_payment_summary,
 *        create_payment, update_payment, delete_payment, navigate_to_payments
 *
 * Category: payments
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
 * get_payment — Get a single payment by ID with populated client, invoice, and creator.
 */
async function getPayment(params) {
  const { id } = params;
  if (!id || !isValidObjectId(id)) {
    return errorResponse('Invalid or missing payment ID', 'INVALID_PARAM');
  }

  try {
    const Payment = mongoose.model('Payment');
    const result = await Payment.findOne({ _id: id, removed: false }).exec();

    if (!result) {
      return errorResponse('No document found', 'NOT_FOUND');
    }

    return successResponse(result);
  } catch (err) {
    return errorResponse(`Failed to fetch payment: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * list_payments — List payments with pagination, sorting, and filtering.
 */
async function listPayments(params) {
  try {
    const Payment = mongoose.model('Payment');

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
      Payment.find(query)
        .skip(skip)
        .limit(limit)
        .sort({ [sortBy]: sortValue })
        .populate()
        .exec(),
      Payment.countDocuments(query),
    ]);

    const pages = Math.ceil(count / limit);

    return successResponse(result, {
      pagination: { page, pages, count },
    });
  } catch (err) {
    return errorResponse(`Failed to list payments: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * search_payments — Search payments by keyword across specified fields.
 */
async function searchPayments(params) {
  const { q, fields = 'ref,description' } = params;

  if (!q || !q.trim()) {
    return errorResponse('Search term (q) is required', 'INVALID_PARAM');
  }

  try {
    const Payment = mongoose.model('Payment');
    const fieldsArray = fields.split(',');
    const escaped = escapeRegex(q);

    const searchQuery = {
      $or: fieldsArray.map((f) => ({
        [f.trim()]: { $regex: new RegExp(escaped, 'i') },
      })),
    };

    const results = await Payment.find(searchQuery).where('removed', false).limit(20).exec();

    return successResponse(results);
  } catch (err) {
    return errorResponse(`Failed to search payments: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * get_payment_summary — Get payment totals for a time period.
 */
async function getPaymentSummary(params) {
  const type = params.type || 'month';

  if (!['week', 'month', 'year'].includes(type)) {
    return errorResponse(
      'Invalid type parameter. Must be week, month, or year.',
      'INVALID_PARAM'
    );
  }

  try {
    const Payment = mongoose.model('Payment');

    const result = await Payment.aggregate([
      {
        $match: {
          removed: false,
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          total: { $sum: '$amount' },
        },
      },
      {
        $project: {
          _id: 0,
          count: 1,
          total: 1,
        },
      },
    ]);

    return successResponse(
      result.length > 0 ? result[0] : { count: 0, total: 0 },
      { type }
    );
  } catch (err) {
    return errorResponse(`Failed to get payment summary: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * create_payment — Record a payment against an invoice.
 * Validates amount against invoice remaining balance.
 * Updates invoice credit + paymentStatus.
 */
async function createPayment(params, context) {
  try {
    const Payment = mongoose.model('Payment');
    const Invoice = mongoose.model('Invoice');
    const { calculate } = require('@/helpers');

    if (params.amount === 0) {
      return errorResponse("The Minimum Amount couldn't be 0", 'INVALID_PARAM');
    }

    // Fetch the parent invoice
    const currentInvoice = await Invoice.findOne({
      _id: params.invoice,
      removed: false,
    });

    if (!currentInvoice) {
      return errorResponse('Invoice not found', 'NOT_FOUND');
    }

    const {
      total: previousTotal,
      discount: previousDiscount,
      credit: previousCredit,
    } = currentInvoice;

    const maxAmount = calculate.sub(calculate.sub(previousTotal, previousDiscount), previousCredit);

    if (params.amount > maxAmount) {
      return errorResponse(
        `The Max Amount you can add is ${maxAmount}`,
        'INVALID_PARAM'
      );
    }

    // Create the payment
    const body = {
      number: params.number,
      date: params.date || new Date(),
      amount: params.amount,
      invoice: params.invoice,
      client: currentInvoice.client?._id || currentInvoice.client,
      ref: params.ref,
      description: params.description,
      createdBy: context.userId,
    };

    if (params.currency) {
      body.currency = params.currency;
    }

    const result = await Payment.create(body);

    // Set PDF filename
    const fileId = 'payment-' + result._id + '.pdf';
    const updatePath = await Payment.findOneAndUpdate(
      { _id: result._id.toString(), removed: false },
      { pdf: fileId },
      { new: true }
    ).exec();

    // Update invoice: push payment, increment credit, set paymentStatus
    const { _id: paymentId, amount } = result;
    const { credit, total, discount } = currentInvoice;

    let paymentStatus =
      calculate.sub(total, discount) === calculate.add(credit, amount)
        ? 'paid'
        : calculate.add(credit, amount) > 0
        ? 'partially'
        : 'unpaid';

    await Invoice.findOneAndUpdate(
      { _id: params.invoice },
      {
        $push: { payment: paymentId.toString() },
        $inc: { credit: amount },
        $set: { paymentStatus: paymentStatus },
      },
      { new: true, runValidators: true }
    ).exec();

    return successResponse(updatePath || result);
  } catch (err) {
    if (err.name === 'ValidationError') {
      return errorResponse(`Validation failed: ${err.message}`, 'VALIDATION_ERROR');
    }
    return errorResponse(`Failed to create payment: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * update_payment — Update payment details. Recalculates invoice credit when amount changes.
 */
async function updatePayment(params) {
  const { id, ...updateFields } = params;

  if (!id || !isValidObjectId(id)) {
    return errorResponse('Invalid or missing payment ID', 'INVALID_PARAM');
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
    const Payment = mongoose.model('Payment');
    const Invoice = mongoose.model('Invoice');
    const { calculate } = require('@/helpers');

    if (fields.amount === 0) {
      return errorResponse("The Minimum Amount couldn't be 0", 'INVALID_PARAM');
    }

    // Fetch existing payment
    const previousPayment = await Payment.findOne({ _id: id, removed: false });

    if (!previousPayment) {
      return errorResponse('No document found', 'NOT_FOUND');
    }

    const { amount: previousAmount } = previousPayment;
    const { id: invoiceId, total, discount, credit: previousCredit } = previousPayment.invoice;

    // If amount is being changed, validate against invoice balance
    if (fields.amount !== undefined) {
      const changedAmount = calculate.sub(fields.amount, previousAmount);
      const maxAmount = calculate.sub(total, calculate.add(discount, previousCredit));

      if (changedAmount > maxAmount) {
        return errorResponse(
          `The Max Amount you can add is ${maxAmount + previousAmount}`,
          'INVALID_PARAM'
        );
      }
    }

    // Calculate payment status
    const currentAmount = fields.amount !== undefined ? fields.amount : previousAmount;
    const changedAmount = calculate.sub(currentAmount, previousAmount);

    let paymentStatus =
      calculate.sub(total, discount) === calculate.add(previousCredit, changedAmount)
        ? 'paid'
        : calculate.add(previousCredit, changedAmount) > 0
        ? 'partially'
        : 'unpaid';

    // Build update object
    const updates = {
      updated: new Date(),
    };
    if (fields.number !== undefined) updates.number = fields.number;
    if (fields.date !== undefined) updates.date = fields.date;
    if (fields.amount !== undefined) updates.amount = fields.amount;
    if (fields.paymentMode !== undefined) updates.paymentMode = fields.paymentMode;
    if (fields.ref !== undefined) updates.ref = fields.ref;
    if (fields.description !== undefined) updates.description = fields.description;

    const result = await Payment.findOneAndUpdate(
      { _id: id, removed: false },
      { $set: updates },
      { new: true }
    ).exec();

    // Update invoice credit and paymentStatus
    await Invoice.findOneAndUpdate(
      { _id: result.invoice._id ? result.invoice._id.toString() : result.invoice.toString() },
      {
        $inc: { credit: changedAmount },
        $set: { paymentStatus: paymentStatus },
      },
      { new: true }
    ).exec();

    return successResponse(result);
  } catch (err) {
    if (err.name === 'ValidationError') {
      return errorResponse(`Validation failed: ${err.message}`, 'VALIDATION_ERROR');
    }
    return errorResponse(`Failed to update payment: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * delete_payment — Soft-delete a payment and reverse its effect on the parent invoice.
 */
async function deletePayment(params) {
  const { id } = params;

  if (!id || !isValidObjectId(id)) {
    return errorResponse('Invalid or missing payment ID', 'INVALID_PARAM');
  }

  try {
    const Payment = mongoose.model('Payment');
    const Invoice = mongoose.model('Invoice');

    const previousPayment = await Payment.findOne({ _id: id, removed: false });

    if (!previousPayment) {
      return errorResponse('No document found', 'NOT_FOUND');
    }

    const { _id: paymentId, amount: previousAmount } = previousPayment;
    const { id: invoiceId, total, discount, credit: previousCredit } = previousPayment.invoice;

    // Soft-delete the payment
    const result = await Payment.findOneAndUpdate(
      { _id: id, removed: false },
      { $set: { removed: true } },
      { new: true }
    ).exec();

    // Recalculate invoice payment status
    let paymentStatus =
      total - discount === previousCredit - previousAmount
        ? 'paid'
        : previousCredit - previousAmount > 0
        ? 'partially'
        : 'unpaid';

    // Update invoice: pull payment, decrement credit, set paymentStatus
    await Invoice.findOneAndUpdate(
      { _id: invoiceId },
      {
        $pull: { payment: paymentId },
        $inc: { credit: -previousAmount },
        $set: { paymentStatus: paymentStatus },
      },
      { new: true }
    ).exec();

    return successResponse(result);
  } catch (err) {
    return errorResponse(`Failed to delete payment: ${err.message}`, 'INTERNAL_ERROR');
  }
}

// ---------------------------------------------------------------------------
// TOOL DEFINITIONS
// ---------------------------------------------------------------------------

const toolDefinitions = {
  get_payment: {
    handler: getPayment,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'MongoDB ObjectId of the payment to retrieve',
        },
      },
      required: ['id'],
    },
    description:
      'Get a single payment by ID. Returns full payment details with auto-populated client, invoice, and creator information. Includes amount, date, currency, reference number, and description. Soft-deleted payments are excluded.',
    execution: 'backend',
    access: 'authenticated',
    category: 'payments',
  },

  list_payments: {
    handler: listPayments,
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
          description: "Field name to filter by (use with 'equal' parameter). E.g., 'currency', 'client', 'invoice'",
        },
        equal: {
          type: 'string',
          description: "Value to match for the filter field. E.g., 'USD', an ObjectId for client/invoice",
        },
        q: {
          type: 'string',
          description: 'Text search query to filter results inline',
        },
        fields: {
          type: 'string',
          description: 'Comma-separated list of fields to search within when using q parameter',
        },
      },
      required: [],
    },
    description:
      "List payments with pagination, sorting, and filtering. Filter by invoice, client, currency, or any field. Use filter+equal for field matching, q+fields for text search. Returns paginated results with auto-populated client, invoice, and creator references.",
    execution: 'backend',
    access: 'authenticated',
    category: 'payments',
  },

  search_payments: {
    handler: searchPayments,
    schema: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Search keyword. Case-insensitive regex match against the specified fields.',
        },
        fields: {
          type: 'string',
          description: "Comma-separated list of Payment string fields to search (e.g., 'ref', 'description', 'ref,description'). The Payment model has no 'name' field — always specify this.",
          default: 'ref,description',
        },
      },
      required: ['q'],
    },
    description:
      "Search payments by keyword across specified fields. Case-insensitive regex matching. Returns max 20 results. The Payment model has no `name` field — you MUST specify the `fields` parameter. Use `fields: \"ref\"` to search by transaction reference, or `fields: \"description\"` to search by description. Only string fields work — numeric fields like amount or number cannot be searched here; use list_payments with a filter instead.",
    execution: 'backend',
    access: 'authenticated',
    category: 'payments',
  },

  get_payment_summary: {
    handler: getPaymentSummary,
    schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: "Time period for the summary aggregation. 'week' = current week, 'month' = current month, 'year' = current year.",
          enum: ['week', 'month', 'year'],
          default: 'month',
        },
      },
      required: [],
    },
    description:
      "Get payment totals for a time period. Returns the total number of payments and the total payment amount. Useful for financial reporting and dashboard metrics. If no payments exist in the period, returns count: 0 and total: 0.",
    execution: 'backend',
    access: 'authenticated',
    category: 'payments',
  },

  create_payment: {
    handler: createPayment,
    schema: {
      type: 'object',
      properties: {
        invoice: {
          type: 'string',
          description: 'MongoDB ObjectId of the invoice this payment is applied to. The invoice must exist and have a remaining balance.',
        },
        amount: {
          type: 'number',
          description: 'Payment amount. Must be greater than 0 and cannot exceed the invoice remaining balance (total - discount - credit).',
        },
        number: {
          type: 'integer',
          description: 'Payment number. A unique sequential identifier for the payment.',
        },
        date: {
          type: 'string',
          description: "Payment date in ISO 8601 format (e.g., '2024-06-15'). Defaults to the current date if not provided.",
        },
        ref: {
          type: 'string',
          description: 'External reference or transaction ID (e.g., bank transfer reference, check number).',
        },
        description: {
          type: 'string',
          description: 'Free-text description of the payment.',
        },
      },
      required: ['invoice', 'amount', 'number'],
    },
    description:
      "Record a payment against an invoice. The payment amount must be greater than zero and cannot exceed the invoice's remaining balance (total - discount - existing credit). Automatically updates the parent invoice's credit and payment status. The createdBy field is auto-set from the authenticated session. NEVER use placeholder values — ask the user for the invoice and amount.",
    execution: 'backend',
    access: 'authenticated',
    category: 'payments',
  },

  update_payment: {
    handler: updatePayment,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'MongoDB ObjectId of the payment to update',
        },
        amount: {
          type: 'number',
          description: 'Updated payment amount. Must be greater than 0. The delta is validated against the invoice remaining balance.',
        },
        date: {
          type: 'string',
          description: "Updated payment date in ISO 8601 format (e.g., '2024-06-20').",
        },
        number: {
          type: 'integer',
          description: 'Updated payment number.',
        },
        ref: {
          type: 'string',
          description: 'Updated external reference or transaction ID.',
        },
        description: {
          type: 'string',
          description: 'Updated free-text description of the payment.',
        },
        paymentMode: {
          type: 'string',
          description: "Payment method/mode (e.g., 'cash', 'bank_transfer', 'credit_card', 'check').",
        },
      },
      required: ['id'],
    },
    description:
      "Update an existing payment's details. If the amount is changed, the new amount is validated against the invoice's remaining balance and the parent invoice's credit and payment status are automatically recalculated. Only provide the fields you want to change.",
    execution: 'backend',
    access: 'authenticated',
    category: 'payments',
  },

  delete_payment: {
    handler: deletePayment,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'MongoDB ObjectId of the payment to delete',
        },
      },
      required: ['id'],
    },
    description:
      "Soft-delete a payment. Automatically removes the payment from the parent invoice's payment list, decreases the invoice's credit by the payment amount, and recalculates the invoice's payment status. \u26A0\uFE0F DESTRUCTIVE: Always ask for user confirmation before calling this tool.",
    execution: 'backend',
    access: 'authenticated',
    category: 'payments',
    confirmBefore: true,
  },

  navigate_to_payments: {
    schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    description:
      'Navigate to the payment list page. Displays a data table of all recorded payments with columns for number, client, amount, date, invoice number, year, and payment mode.',
    execution: 'frontend',
    access: 'authenticated',
    category: 'payments',
    frontendAction: {
      type: 'navigate',
      route: '/payment',
    },
  },
};

// ---------------------------------------------------------------------------
// REGISTRATION
// ---------------------------------------------------------------------------

function register() {
  registerCategory(
    'payments',
    'Payment management — CRUD operations, search, financial summary, and navigation to payment pages.'
  );
  registerTools(toolDefinitions);
}

module.exports = {
  getPayment,
  listPayments,
  searchPayments,
  getPaymentSummary,
  createPayment,
  updatePayment,
  deletePayment,
  toolDefinitions,
  register,
};
