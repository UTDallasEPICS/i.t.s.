import { eq } from 'drizzle-orm'
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { chatThreadMembers, chatThreads } from '~~/server/db/schema'
import { requireAdmin } from '~~/server/utils/authorization'
import { emitChatMemberJoined } from '~~/server/utils/chat/events'
import { db } from '~~/server/utils/db'
import { requireUser } from '~~/server/utils/session'

export default defineEventHandler(async (event) => {
  const currentUser = requireUser(event)
  await requireAdmin(currentUser.id)
  const threadId = Number(getRouterParam(event, 'threadId'))
  if (!Number.isInteger(threadId) || threadId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid thread id' })
  const thread = db.select().from(chatThreads).where(eq(chatThreads.id, threadId)).get()
  if (!thread || thread.closedAt) throw createError({ statusCode: 404, statusMessage: 'Thread not found' })
  db.insert(chatThreadMembers).values({ threadId, userId: currentUser.id }).onConflictDoNothing().run()
  try {
    await emitChatMemberJoined(currentUser.id, threadId)
  } catch (error) {
    console.error('[chat] failed to emit chat:member-joined', error)
  }
  return { threadId, joined: true }
})
