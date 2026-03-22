/**
 * Admin Tools — Phase 5
 *
 * Tools: get_admin_profile, update_admin_profile
 *
 * Category: admin
 */

const mongoose = require('mongoose');
const { successResponse, errorResponse } = require('../helpers/response');
const { isValidObjectId } = require('../helpers/validate');
const { registerTools, registerCategory } = require('../registry');

// ---------------------------------------------------------------------------
// HANDLERS
// ---------------------------------------------------------------------------

/**
 * get_admin_profile — Get an admin user's profile by ID.
 * Returns only safe fields (no passwords, tokens, or session data).
 */
async function getAdminProfile(params) {
  const { id } = params;

  if (!id || !isValidObjectId(id)) {
    return errorResponse('Invalid or missing admin ID', 'INVALID_PARAM');
  }

  try {
    const Admin = mongoose.model('Admin');

    const tmpResult = await Admin.findOne({
      _id: id,
      removed: false,
    }).exec();

    if (!tmpResult) {
      return errorResponse('No document found', 'NOT_FOUND');
    }

    // Return only safe fields — matches existing read controller
    const result = {
      _id: tmpResult._id,
      enabled: tmpResult.enabled,
      email: tmpResult.email,
      name: tmpResult.name,
      surname: tmpResult.surname,
      photo: tmpResult.photo,
      role: tmpResult.role,
    };

    return successResponse(result);
  } catch (err) {
    return errorResponse(`Failed to fetch admin profile: ${err.message}`, 'INTERNAL_ERROR');
  }
}

/**
 * update_admin_profile — Update the current admin user's profile.
 * Only allows name, surname, and email updates.
 * Photo and password changes must go through the UI.
 */
async function updateAdminProfile(params, context) {
  const { email, name, surname } = params;

  // Build update fields — only include provided values
  const updates = {};
  if (email !== undefined) updates.email = email;
  if (name !== undefined) updates.name = name;
  if (surname !== undefined) updates.surname = surname;

  if (Object.keys(updates).length === 0) {
    return errorResponse(
      'At least one field to update is required (email, name, or surname)',
      'INVALID_PARAM'
    );
  }

  try {
    const Admin = mongoose.model('Admin');

    // Check demo account protection
    const currentAdmin = await Admin.findOne({
      _id: context.userId,
      removed: false,
    }).exec();

    if (!currentAdmin) {
      return errorResponse('No profile found', 'NOT_FOUND');
    }

    if (currentAdmin.email === 'admin@demo.com') {
      return errorResponse("You can't update demo account information", 'FORBIDDEN');
    }

    // Update profile — uses context.userId (can only update own profile)
    const result = await Admin.findOneAndUpdate(
      { _id: context.userId, removed: false },
      { $set: updates },
      { new: true }
    ).exec();

    if (!result) {
      return errorResponse('No profile found', 'NOT_FOUND');
    }

    return successResponse({
      _id: result._id,
      enabled: result.enabled,
      email: result.email,
      name: result.name,
      surname: result.surname,
      photo: result.photo,
      role: result.role,
    });
  } catch (err) {
    return errorResponse(`Failed to update admin profile: ${err.message}`, 'INTERNAL_ERROR');
  }
}

// ---------------------------------------------------------------------------
// TOOL DEFINITIONS
// ---------------------------------------------------------------------------

const toolDefinitions = {
  get_admin_profile: {
    handler: getAdminProfile,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'MongoDB ObjectId of the admin user to retrieve',
        },
      },
      required: ['id'],
    },
    description:
      "Get an admin user's profile by ID. Returns safe fields only: name, email, surname, photo, role, enabled. Does not expose passwords, tokens, or session data.",
    execution: 'backend',
    access: 'authenticated',
    category: 'admin',
  },

  update_admin_profile: {
    handler: updateAdminProfile,
    schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Updated email address',
        },
        name: {
          type: 'string',
          description: 'Updated first name',
        },
        surname: {
          type: 'string',
          description: 'Updated last name',
        },
      },
      required: [],
    },
    description:
      "Update the current admin user's profile. At least one field (email, name, or surname) must be provided. Photo uploads and password changes are only available through the profile page UI. The demo account (admin@demo.com) cannot be updated.",
    execution: 'backend',
    access: 'authenticated',
    category: 'admin',
  },
};

// ---------------------------------------------------------------------------
// REGISTRATION
// ---------------------------------------------------------------------------

function register() {
  registerCategory(
    'admin',
    'Admin profile management — view and update admin user profile details.'
  );
  registerTools(toolDefinitions);
}

module.exports = {
  getAdminProfile,
  updateAdminProfile,
  toolDefinitions,
  register,
};
