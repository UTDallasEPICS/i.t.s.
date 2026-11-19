import { z } from 'zod'
import { defineEventHandler, readValidatedBody } from 'h3'
import { organization } from '../../db/schema'
import { db } from '../../utils/db'
import { requireUser } from '../../utils/session'
import { requireAdmin } from '../../utils/authorization'

// Validate the request body.
const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'Organization name is required'),
})

export default defineEventHandler(async (event) => {
  // Check authentication and admin authorization.
  const currentUser = requireUser(event)
  await requireAdmin(currentUser.id)

  // Validate the organization name.
  const { name } = await readValidatedBody(event, (data) => {
    const result = createOrganizationSchema.safeParse(data)

    if (!result.success) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid organization data',
        data: result.error.flatten(),
      })
    }

    return result.data
  })

  // Create a new organization.
  const [createdOrganization] = await db.insert(organization).values({ name }).returning()

  return createdOrganization
})
