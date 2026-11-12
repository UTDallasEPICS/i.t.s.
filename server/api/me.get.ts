import { requireUser } from '../utils/session'
import { getUserOrgId, isAdmin } from '../utils/authorization'

export default defineEventHandler(async (event) => {
  const currentUser = requireUser(event)
  const orgId = await getUserOrgId(currentUser.id)

  return {
    isAdmin: isAdmin(orgId),
    user: {
      id: currentUser.id,
      name: currentUser.name,
      email: currentUser.email,
      image: currentUser.image ?? null,
    },
  }
})
