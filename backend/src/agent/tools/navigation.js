/**
 * Navigation Tools — Phase 5
 *
 * Tools: navigate_to_dashboard, navigate_to_settings,
 *        navigate_to_profile, navigate_to_login
 *
 * Category: navigation
 *
 * All navigation tools are frontend-only — no backend handlers.
 */

const { registerTools, registerCategory } = require('../registry');

// ---------------------------------------------------------------------------
// TOOL DEFINITIONS
// ---------------------------------------------------------------------------

const toolDefinitions = {
  navigate_to_dashboard: {
    schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    description:
      'Navigate to the dashboard home page. Shows summary cards with invoice totals, payment totals, client statistics, and recent activity.',
    execution: 'frontend',
    access: 'authenticated',
    category: 'navigation',
    frontendAction: {
      type: 'navigate',
      route: '/',
    },
  },

  navigate_to_settings: {
    schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    description:
      'Navigate to the settings page. Provides a tabbed interface for general app settings, company info, logo upload, currency/money format, and finance settings.',
    execution: 'frontend',
    access: 'authenticated',
    category: 'navigation',
    frontendAction: {
      type: 'navigate',
      route: '/settings',
    },
  },

  navigate_to_profile: {
    schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    description:
      'Navigate to the profile management page. Users can update profile details from this page. Password changes and photo uploads are only available through the UI.',
    execution: 'frontend',
    access: 'authenticated',
    category: 'navigation',
    frontendAction: {
      type: 'navigate',
      route: '/profile',
    },
  },

  navigate_to_login: {
    schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    description:
      'Navigate to the login page. Used when the user needs to log in, create an account, or reset their password.',
    execution: 'frontend',
    access: 'public',
    category: 'navigation',
    frontendAction: {
      type: 'navigate',
      route: '/login',
    },
  },
};

// ---------------------------------------------------------------------------
// REGISTRATION
// ---------------------------------------------------------------------------

function register() {
  registerCategory(
    'navigation',
    'Page navigation — navigate to dashboard, settings, profile, login, and other application pages.'
  );
  registerTools(toolDefinitions);
}

module.exports = {
  toolDefinitions,
  register,
};
