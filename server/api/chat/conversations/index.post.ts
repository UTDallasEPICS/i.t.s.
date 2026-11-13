import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { createError, defineEventHandler, readBody, setResponseStatus } from 'h3'
import { z } from 'zod'
import { project, user } from '~~/server/db/schema'
import { requireAdmin } from '~~/server/utils/authorization'
import { getOrCreateThread } from '~~/server/utils/chat/service'
import { db } from '~~/server/utils/db'
import { requireUser } from '~~/server/utils/session'
import { CHAT_MESSAGE_MAX_LENGTH } from '#shared/chat-limits'

const schema = z.strictObject({
  projectId: z.number().int().positive(),
  name: z.string().trim().min(1).max(100).optional(),
  memberIds: z.array(z.string().min(1)).min(1),
  message: z.string().max(CHAT_MESSAGE_MAX_LENGTH).trim().min(1),
})

export default defineEventHandler(async (event) => {
  const currentUser = requireUser(event)
  await requireAdmin(currentUser.id)
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid conversation' })
  const data = parsed.data
  if (!data.memberIds.some(id => id !== currentUser.id)) {
    throw createError({ statusCode: 400, statusMessage: 'Choose at least one other member' })
  }
  const selectedProject = db.select().from(project).where(eq(project.id, data.projectId)).get()
  if (!selectedProject) throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  const memberIds = [...new Set([...data.memberIds, currentUser.id])]
  const validMembers = db.select({ id: user.id }).from(user).where(and(
    inArray(user.id, memberIds), eq(user.isArchived, false),
    or(isNull(user.orgId), eq(user.orgId, selectedProject.projectPartnerId)),
  )).all()
  if (validMembers.length !== memberIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid conversation members' })
  }
  const result = await getOrCreateThread({
    projectId: data.projectId, name: data.name,
    initialMessage: { userId: currentUser.id, plainTextBody: data.message },
    otherMembers: memberIds,
  })
  if (!result.ok) throw createError({ statusCode: 500, statusMessage: 'Unable to create conversation' })
  setResponseStatus(event, result.value.created ? 201 : 200)
  return result.value
})
