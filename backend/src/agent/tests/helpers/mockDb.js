/**
 * Test database helpers.
 *
 * Provides in-memory setup/teardown and seed data utilities.
 * Uses simple mock objects rather than a real DB for unit tests.
 */

const fixtures = require('../fixtures');

/**
 * Create a mock Mongoose model with common methods.
 */
function createMockModel(data = []) {
  const store = [...data];

  const model = {
    _store: store,

    findById: jest.fn(async (id) => {
      return store.find((item) => item._id === id || item._id?.toString() === id) || null;
    }),

    findOne: jest.fn(async (query) => {
      return (
        store.find((item) => {
          return Object.entries(query).every(([key, val]) => {
            if (typeof val === 'object' && val.$regex) {
              return new RegExp(val.$regex, val.$options || '').test(item[key]);
            }
            return item[key] === val;
          });
        }) || null
      );
    }),

    find: jest.fn(async (query = {}) => {
      const results = store.filter((item) => {
        if (query.removed !== undefined && item.removed !== query.removed) return false;
        return true;
      });
      // Return chainable query mock
      return results;
    }),

    countDocuments: jest.fn(async (query = {}) => {
      return store.filter((item) => {
        if (query.removed !== undefined && item.removed !== query.removed) return false;
        return true;
      }).length;
    }),

    create: jest.fn(async (doc) => {
      const newDoc = { _id: 'new_' + Date.now(), ...doc, removed: false };
      store.push(newDoc);
      return newDoc;
    }),

    findByIdAndUpdate: jest.fn(async (id, update, opts = {}) => {
      const idx = store.findIndex((item) => item._id === id || item._id?.toString() === id);
      if (idx === -1) return null;
      const updated = { ...store[idx], ...update };
      store[idx] = updated;
      return opts.new !== false ? updated : store[idx];
    }),

    aggregate: jest.fn(async () => []),
  };

  return model;
}

/**
 * Reset all mock functions on a mock model.
 */
function resetMockModel(model) {
  Object.values(model).forEach((val) => {
    if (typeof val?.mockClear === 'function') {
      val.mockClear();
    }
  });
}

module.exports = { createMockModel, resetMockModel };
