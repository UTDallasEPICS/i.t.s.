import { defineEventHandler } from 'h3'
import { getUserOrgId } from '~~/server/utils/authorization'
import { requireUser } from '~~/server/utils/session'

export default defineEventHandler(async (event) => {
  const currentUser = requireUser(event)
  return { userId: currentUser.id, isAdmin: await getUserOrgId(currentUser.id) === null }
})
