import { createError, defineEventHandler, getRouterParam } from 'h3'
import { joinConversation } from '~~/server/utils/chat/service'
import { requireAdmin } from '~~/server/utils/authorization'
import { requireUser } from '~~/server/utils/session'

export default defineEventHandler(async (event) => {
  const currentUser = requireUser(event)
  await requireAdmin(currentUser.id)
  const threadId = Number(getRouterParam(event, 'threadId'))
  if (!Number.isInteger(threadId) || threadId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid thread id' })
  const result = await joinConversation({ threadId, userId: currentUser.id })
  if (!result.ok) throw createError({ statusCode: 404, statusMessage: 'Thread not found' })
  return { threadId, joined: true }
})
