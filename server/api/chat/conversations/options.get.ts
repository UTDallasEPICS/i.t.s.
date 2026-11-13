import { eq } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { organization, project, user } from '~~/server/db/schema'
import { requireAdmin } from '~~/server/utils/authorization'
import { db } from '~~/server/utils/db'
import { requireUser } from '~~/server/utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(requireUser(event).id)
  return {
    projects: db.select({ id: project.id, name: project.name, orgId: project.projectPartnerId }).from(project).all(),
    people: db.select({ id: user.id, name: user.name, email: user.email, orgId: user.orgId, organizationName: organization.name })
      .from(user).leftJoin(organization, eq(organization.id, user.orgId)).where(eq(user.isArchived, false)).all(),
  }
})
