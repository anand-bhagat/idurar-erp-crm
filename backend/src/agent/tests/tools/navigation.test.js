/**
 * Tests for Navigation Tools — Phase 5
 *
 * Tests 4 frontend navigation tool definitions:
 * navigate_to_dashboard, navigate_to_settings,
 * navigate_to_profile, navigate_to_login.
 *
 * Navigation tools are frontend-only — no handler tests needed.
 */

const { toolDefinitions, register } = require('../../tools/navigation');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Navigation Tools', () => {
  // =========================================================================
  // Tool Definitions
  // =========================================================================
  describe('Tool Definitions', () => {
    it('should define all 4 navigation tools', () => {
      const names = Object.keys(toolDefinitions);
      expect(names).toEqual([
        'navigate_to_dashboard',
        'navigate_to_settings',
        'navigate_to_profile',
        'navigate_to_login',
      ]);
    });

    it('should set all tools with execution: frontend', () => {
      Object.values(toolDefinitions).forEach((tool) => {
        expect(tool.execution).toBe('frontend');
        expect(tool.handler).toBeUndefined();
      });
    });

    it('should set all tools to navigation category', () => {
      Object.values(toolDefinitions).forEach((tool) => {
        expect(tool.category).toBe('navigation');
      });
    });

    it('should have no required parameters for any tool', () => {
      Object.values(toolDefinitions).forEach((tool) => {
        expect(tool.schema.required).toEqual([]);
        expect(tool.schema.properties).toEqual({});
      });
    });
  });

  // =========================================================================
  // navigate_to_dashboard
  // =========================================================================
  describe('navigate_to_dashboard', () => {
    it('should navigate to root route', () => {
      const tool = toolDefinitions.navigate_to_dashboard;
      expect(tool.frontendAction).toEqual({
        type: 'navigate',
        route: '/',
      });
    });

    it('should require authentication', () => {
      expect(toolDefinitions.navigate_to_dashboard.access).toBe('authenticated');
    });
  });

  // =========================================================================
  // navigate_to_settings
  // =========================================================================
  describe('navigate_to_settings', () => {
    it('should navigate to /settings route', () => {
      const tool = toolDefinitions.navigate_to_settings;
      expect(tool.frontendAction).toEqual({
        type: 'navigate',
        route: '/settings',
      });
    });

    it('should require authentication', () => {
      expect(toolDefinitions.navigate_to_settings.access).toBe('authenticated');
    });
  });

  // =========================================================================
  // navigate_to_profile
  // =========================================================================
  describe('navigate_to_profile', () => {
    it('should navigate to /profile route', () => {
      const tool = toolDefinitions.navigate_to_profile;
      expect(tool.frontendAction).toEqual({
        type: 'navigate',
        route: '/profile',
      });
    });

    it('should require authentication', () => {
      expect(toolDefinitions.navigate_to_profile.access).toBe('authenticated');
    });
  });

  // =========================================================================
  // navigate_to_login
  // =========================================================================
  describe('navigate_to_login', () => {
    it('should navigate to /login route', () => {
      const tool = toolDefinitions.navigate_to_login;
      expect(tool.frontendAction).toEqual({
        type: 'navigate',
        route: '/login',
      });
    });

    it('should be publicly accessible', () => {
      expect(toolDefinitions.navigate_to_login.access).toBe('public');
    });
  });

  // =========================================================================
  // Registry Integration
  // =========================================================================
  describe('Registry Integration', () => {
    it('should register tools and category without errors', () => {
      expect(() => register()).not.toThrow();
    });
  });
});
