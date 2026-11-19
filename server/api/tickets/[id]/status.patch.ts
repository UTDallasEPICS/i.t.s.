import { eq } from 'drizzle-orm'
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'h3'
import { updateStatusSchema } from '#shared/tickets'
import { tickets } from '../../../db/schema'
import { db } from '../../../utils/db'
import { isAdmin } from '../../../utils/authorization'
import { parseTicketId, readAccessibleTicket, requireTicketUser } from '../../../utils/ticket-access'

export default defineEventHandler(async (event) => {
  // 1. Authenticate & load user row (throws 401 / 403 if missing)
  const currentUser = requireTicketUser(event)

  // 2. NPTS-only: orgId === null means admin/NPTS; partners have an orgId.
  if (!isAdmin(currentUser.orgId)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  // 3. Parse & validate the ticket ID (throws 404 on bad format)
  const id = parseTicketId(getRouterParam(event, 'id'))

  // 4. Validate request body with Zod (throws 400 on invalid status)
  const body = await readValidatedBody(event, (raw) => updateStatusSchema.parse(raw))

  // 5. Confirm the ticket exists and is visible (throws 404 if not found)
  readAccessibleTicket(id, currentUser)

  // 6. Apply the status update
  const updated = db.transaction((tx) => {
    tx.update(tickets)
      .set({ status: body.status })
      .where(eq(tickets.id, id))
      .run()
    return readAccessibleTicket(id, currentUser, tx)
  })

  return updated
})

