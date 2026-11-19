import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { requireUser } from '../../utils/session'
import { requireAdmin } from '../../utils/authorization'
import { db } from '../../utils/db'
import { validateOrganization } from '../../utils/user-validation'
import { user } from '../../db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  // guard
  const currentUser = requireUser(event)
  await requireAdmin(currentUser.id)

  const targetUserId = getRouterParam(event, 'id')

  if (!targetUserId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'User ID is required',
    })
  }

  const body = (await readBody(event)) ?? {}
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
    })
  }

  const { orgId, name } = body as {
    orgId?: unknown
    name?: unknown
  }

  // Check which fields are being updated
  const updatingOrg = orgId !== undefined
  const updatingName = name !== undefined

  if (!updatingOrg && !updatingName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No fields provided for update',
    })
  }

  // Validate the new name
  let validatedName: string | undefined

  if (updatingName) {
    if (typeof name !== 'string' || !name.trim()) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Name cannot be empty',
      })
    }

    if (name.trim().length > 100) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Name must be 100 characters or fewer',
      })
    }

    validatedName = name.trim()
  }

  // Validate organization only when it is being updated
  let validatedOrgId: string | undefined

  if (updatingOrg) {
    const result = await validateOrganization(orgId)

    if (result === null) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Administrator promotion is not supported',
      })
    }

    validatedOrgId = result
  }

  // Prevent users from changing their own organization
  if (updatingOrg && currentUser.id === targetUserId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'You cannot change your own organization',
    })
  }

  const [targetUser] = await db
    .select({
      id: user.id,
      orgId: user.orgId,
      isArchived: user.isArchived,
    })
    .from(user)
    .where(eq(user.id, targetUserId))

  if (!targetUser) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found',
    })
  }

  // Preserve the existing restriction on administrator accounts

  if (updatingOrg && targetUser.orgId === null) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Administrator organization cannot be changed',
    })
  }

  if (targetUser.isArchived) {
    throw createError({
      statusCode: 409,
      statusMessage: 'User is archived',
    })
  }

  // Update the user's organization ID
  const [updatedUser] = await db
    .update(user)
    .set({
      ...(updatingOrg ? { orgId: validatedOrgId } : {}),
      ...(updatingName ? { name: validatedName } : {}),
      updatedAt: new Date(),
    })
    .where(eq(user.id, targetUserId))
    .returning({
      id: user.id,
      name: user.name,
      email: user.email,
      orgId: user.orgId,
    })

  if (!updatedUser) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found',
    })
  }

  return {
    message: 'User updated successfully',
    user: updatedUser,
  }
})
