import { z } from 'zod'
import { defineEventHandler, readValidatedBody, getRouterParam, createError } from 'h3'
import { requireUser } from '../../../utils/session'
import { requireAdmin } from '../../../utils/authorization'
import { eq } from 'drizzle-orm'
import { db } from '../../../utils/db'
import { project, organization } from '../../../db/schema'

// Validate fields that can be updated.
const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    organizationId: z.string().trim().min(1).optional(),
    siteTag: z.string().trim().min(1).optional(),
    githubRepo: z
      .string()
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'GitHub repository must use owner/name format')
      .optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'At least one field is required')

export default defineEventHandler(async (event) => {
  const currentUser = requireUser(event)
  await requireAdmin(currentUser.id)

  const body = await readValidatedBody(event, (data) => {
    const result = updateProjectSchema.safeParse(data)

    if (!result.success) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid project update data',
        data: result.error.flatten(),
      })
    }

    return result.data
  })

  // Validate the project ID from the URL.
  const projectId = Number(getRouterParam(event, 'id'))

  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid project ID',
    })
  }

  // Check whether the project exists.
  const [existingProject] = await db.select().from(project).where(eq(project.id, projectId))

  if (!existingProject) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Project not found',
    })
  }

  // Check whether the new organization exists.
  if (body.organizationId !== undefined) {
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
  }

  // Check site tag uniqueness, excluding the current project.
  if (body.siteTag !== undefined) {
    const [duplicateProject] = await db
      .select({ id: project.id })
      .from(project)
      .where(eq(project.siteTag, body.siteTag))

    if (duplicateProject && duplicateProject.id !== projectId) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Site tag already exists',
      })
    }
  }
  // Update only the fields provided in the request.
  const [updatedProject] = await db
    .update(project)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.organizationId !== undefined && {
        projectPartnerId: body.organizationId,
      }),
      ...(body.siteTag !== undefined && { siteTag: body.siteTag }),
      ...(body.githubRepo !== undefined && { githubRepo: body.githubRepo }),
    })
    .where(eq(project.id, projectId))
    .returning()

  return updatedProject
})
