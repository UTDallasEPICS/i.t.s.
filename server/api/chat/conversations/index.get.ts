import { defineEventHandler } from 'h3'
import { listConversations } from '~~/server/utils/chat/service'
import { requireUser } from '~~/server/utils/session'

export default defineEventHandler(async (event) => {
  const currentUser = requireUser(event)
  return listConversations({ userId: currentUser.id })
})
