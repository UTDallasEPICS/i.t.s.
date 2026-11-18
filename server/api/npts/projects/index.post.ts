import { z } from 'zod'
import { defineEventHandler, readValidatedBody } from 'h3'
import { requireUser } from '../../../utils/session'
import { requireAdmin } from '../../../utils/authorization'
import { eq, or } from 'drizzle-orm'
import { db } from '../../../utils/db'
import { organization, project } from '../../../db/schema'
import { githubRepoSchema } from '../../../utils/github-repo-schema'
import { projectUrlSchema } from '../../../utils/project-url-schema'

// Validate project creation input.
const createProjectSchema = z
  .object({
    name: z.string().trim().min(1, 'Project name is required'),

    organizationId: z.string().uuid(),
    stageUrl: projectUrlSchema.optional(),
    prodUrl: projectUrlSchema.optional(),

    githubRepo: githubRepoSchema,
  })
  .refine((data) => data.stageUrl !== undefined || data.prodUrl !== undefined, {
    message: 'At least one of stageUrl or prodUrl is required',
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

  // Check whether either URL is already used by another project.
  const urls = [body.stageUrl, body.prodUrl].filter((url): url is string => url !== undefined)

  const [existingProject] = await db
    .select({ id: project.id })
    .from(project)
    .where(or(...urls.flatMap((url) => [eq(project.stageUrl, url), eq(project.prodUrl, url)])))

  if (existingProject) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Site URL already exists in another project',
    })
  }
  // Create the project.

  const [createdProject] = await db
    .insert(project)
    .values({
      name: body.name,
      projectPartnerId: body.organizationId,
      stageUrl: body.stageUrl,
      prodUrl: body.prodUrl,
      githubRepo: body.githubRepo,
    })
    .returning()

  return createdProject
})
