import { z } from 'zod'
import { defineEventHandler, readValidatedBody, getRouterParam, createError } from 'h3'
import { requireUser } from '../../../utils/session'
import { requireAdmin } from '../../../utils/authorization'
import { eq, or, ne, and } from 'drizzle-orm'
import { db } from '../../../utils/db'
import { project, organization } from '../../../db/schema'
import { githubRepoSchema } from '../../../utils/github-repo-schema'
import { projectUrlSchema } from '../../../utils/project-url-schema'
import { subdomainSchema } from '../../../utils/npts-host'

// Validate fields that can be updated.
const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    organizationId: z.string().trim().min(1).optional(),
    stageUrl: projectUrlSchema.nullable().optional(),
    prodUrl: projectUrlSchema.nullable().optional(),
    subdomain: subdomainSchema.nullable().optional(),
    githubRepo: githubRepoSchema.optional(),
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
  // Determine the URLs after applying the requested changes.
  const newStageUrl = body.stageUrl !== undefined ? body.stageUrl : existingProject.stageUrl

  const newProdUrl = body.prodUrl !== undefined ? body.prodUrl : existingProject.prodUrl

  const newSubdomain = body.subdomain !== undefined ? body.subdomain : existingProject.subdomain

  // The widget needs at least one way to find the project.
  if (newStageUrl === null && newProdUrl === null && newSubdomain === null) {
    throw createError({
      statusCode: 400,
      statusMessage: 'At least one of stageUrl, prodUrl or subdomain is required',
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

  // Check URL uniqueness across other projects.
  const urls = [newStageUrl, newProdUrl].filter(
    (url): url is string => url !== null && url !== undefined
  )

  // No URLs (subdomain only): skip, since an empty or() would match every project.
  const [duplicateProject] = urls.length
    ? await db
        .select({ id: project.id })
        .from(project)
        .where(
          and(
            ne(project.id, projectId),
            or(...urls.flatMap((url) => [eq(project.stageUrl, url), eq(project.prodUrl, url)]))
          )
        )
    : []

  if (duplicateProject) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Site URL already exists in another project',
    })
  }

  if (newSubdomain !== null) {
    const [subdomainOwner] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(ne(project.id, projectId), eq(project.subdomain, newSubdomain)))

    if (subdomainOwner) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Subdomain already exists in another project',
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
      ...(body.stageUrl !== undefined && { stageUrl: body.stageUrl }),
      ...(body.prodUrl !== undefined && { prodUrl: body.prodUrl }),
      ...(body.subdomain !== undefined && { subdomain: body.subdomain }),
      ...(body.githubRepo !== undefined && { githubRepo: body.githubRepo }),
    })
    .where(eq(project.id, projectId))
    .returning()

  return updatedProject
})
