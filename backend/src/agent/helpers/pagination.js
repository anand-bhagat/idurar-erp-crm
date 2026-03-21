/**
 * Standard pagination helper for list tools.
 */

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/**
 * Normalize pagination parameters from LLM input.
 *
 * @param {object} params - { page, limit } from tool params
 * @returns {{ page: number, limit: number, skip: number }}
 */
function normalizePagination(params = {}) {
  let page = parseInt(params.page, 10) || DEFAULT_PAGE;
  let limit = parseInt(params.limit, 10) || DEFAULT_LIMIT;

  if (page < 1) page = DEFAULT_PAGE;
  if (limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

module.exports = { normalizePagination, DEFAULT_PAGE, DEFAULT_LIMIT, MAX_LIMIT };
