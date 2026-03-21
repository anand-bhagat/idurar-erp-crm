/**
 * Permission checking helpers for agent tools.
 */

const ACCESS = {
  PUBLIC: 'public',
  AUTHENTICATED: 'authenticated',
  OWNER: 'owner',
  ADMIN: 'admin',
};

/**
 * Check if a user context has access to a tool.
 *
 * @param {string} toolAccess - One of ACCESS values
 * @param {object} context - { userId, role, ... }
 * @param {string|null} resourceOwnerId - Owner ID of the resource (for OWNER checks)
 * @returns {{ allowed: boolean, error?: string }}
 */
function checkAccess(toolAccess, context, resourceOwnerId = null) {
  if (toolAccess === ACCESS.PUBLIC) return { allowed: true };

  if (!context || !context.userId) {
    return { allowed: false, error: 'Authentication required' };
  }

  if (toolAccess === ACCESS.AUTHENTICATED) return { allowed: true };

  if (toolAccess === ACCESS.ADMIN) {
    if (context.role !== 'admin') {
      return { allowed: false, error: 'Admin access required' };
    }
    return { allowed: true };
  }

  if (toolAccess === ACCESS.OWNER) {
    if (context.role === 'admin') return { allowed: true };
    if (resourceOwnerId && resourceOwnerId.toString() !== context.userId) {
      return { allowed: false, error: 'You can only access your own resources' };
    }
    return { allowed: true };
  }

  return { allowed: true };
}

module.exports = { ACCESS, checkAccess };
