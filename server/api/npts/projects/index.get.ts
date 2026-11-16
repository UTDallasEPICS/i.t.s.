import { asc } from 'drizzle-orm'
import { db } from '../../../utils/db'
import { project } from '../../../db/schema'
import { requireUser } from '../../../utils/session'
import { requireAdmin } from '../../../utils/authorization'

export default defineEventHandler(async (event) => {
  // Get the authenticated user.
  const currentUser = await requireUser(event)

  // Only NPTS admins can access this endpoint.
  await requireAdmin(currentUser.id)

  return db
    .select({
      id: project.id,
      name: project.name,
      stageUrl: project.stageUrl,
      prodUrl: project.prodUrl,
      githubRepo: project.githubRepo,
      projectPartnerId: project.projectPartnerId,
    })
    .from(project)
    .orderBy(asc(project.name), asc(project.id))
    .all()
})
