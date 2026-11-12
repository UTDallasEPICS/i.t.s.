import { z } from 'zod'
import { defineEventHandler, readValidatedBody } from 'h3'
import { requireUser } from '../../../utils/session'
import { requireAdmin } from '../../../utils/authorization'
import { eq } from 'drizzle-orm'
import { db } from '../../../utils/db'
import { organization, project } from '../../../db/schema'

// Validate project creation input.
const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required'),

  organizationId: z.string().uuid(),

  siteTag: z.string().trim().min(1, 'Site tag is required'),

  githubRepo: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'GitHub repository must use owner/name format'),
})

export default defineEventHandler(async (event) => {
  const currentUser = requireUser(event)
  await requireAdmin(currentUser.id)

  const body = await readValidatedBody(event, (data) => {
    const result = createProjectSchema.safeParse(data)

    if (!result.success) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid project data',
        data: result.error.flatten(),
      })
    }

    return result.data
  })

  // Check whether the selected organization exists.
  const [existingOrganization] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, body.organizationId))

  if (!existingOrganization) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Organization not found',
    })
  }

  // Check whether the site tag is already in use.
  const [existingProject] = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.siteTag, body.siteTag))

  if (existingProject) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Site tag already exists',
    })
  }

  // Create the project.
  try {
    const [createdProject] = await db
      .insert(project)
      .values({
        name: body.name,
        projectPartnerId: body.organizationId,
        siteTag: body.siteTag,
        githubRepo: body.githubRepo,
      })
      .returning()

    return createdProject
  } catch (error) {
    // Handle a database UNIQUE constraint violation.
    const cause = error instanceof Error && 'cause' in error ? error.cause : error

    const errorCode = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined

    const errorMessage = cause instanceof Error ? cause.message : ''

    if (errorCode === 'SQLITE_CONSTRAINT_UNIQUE' && errorMessage.includes('project.siteTag')) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Site tag already exists',
      })
    }

    // Preserve unexpected database errors.
    throw error
  }
})
