/**
 * Agent Auth Middleware
 *
 * Reuses the same JWT validation as the main app (isValidAuthToken pattern).
 * Extracts user context for the agent engine.
 */

const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

/**
 * Authenticate agent requests.
 * Extracts Bearer token, verifies JWT, checks session, attaches user context.
 */
async function agentAuth(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No authentication token provided',
        code: 'AUTH_REQUIRED',
      });
    }

    const verified = jwt.verify(token, process.env.JWT_SECRET);
    if (!verified) {
      return res.status(401).json({
        success: false,
        error: 'Token verification failed',
        code: 'AUTH_INVALID',
      });
    }

    const AdminPassword = mongoose.model('AdminPassword');
    const Admin = mongoose.model('Admin');

    const [user, userPassword] = await Promise.all([
      Admin.findOne({ _id: verified.id, removed: false }),
      AdminPassword.findOne({ user: verified.id, removed: false }),
    ]);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found',
        code: 'AUTH_USER_NOT_FOUND',
      });
    }

    if (!userPassword || !userPassword.loggedSessions.includes(token)) {
      return res.status(401).json({
        success: false,
        error: 'Session expired. Please log in again.',
        code: 'AUTH_SESSION_EXPIRED',
      });
    }

    // Attach user context for the agent engine
    req.agentContext = {
      userId: user._id.toString(),
      role: user.role || 'owner',
      name: `${user.name || ''} ${user.surname || ''}`.trim(),
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
        code: 'AUTH_TOKEN_EXPIRED',
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Authentication error',
      code: 'INTERNAL_ERROR',
    });
  }
}

module.exports = agentAuth;
