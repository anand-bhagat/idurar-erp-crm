/**
 * Standard response formatters for agent tools.
 *
 * Every tool MUST return one of these shapes.
 */

function successResponse(data, metadata = {}) {
  return {
    success: true,
    data,
    metadata,
  };
}

function errorResponse(message, code = 'ERROR') {
  return {
    success: false,
    error: message,
    code,
  };
}

function paginatedResponse(items, total, page, limit) {
  return {
    success: true,
    data: items,
    metadata: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  };
}

module.exports = { successResponse, errorResponse, paginatedResponse };
