import { z } from 'zod'
import type { tickets } from '../server/db/schema'

export const TICKET_TITLE_MAX = 200
export const TICKET_DESCRIPTION_MAX = 5000

// Shared by the widget, ITS form and API; identity and status are server-owned.
export const createTicketSchema = z.strictObject({
  projectId: z.number({ error: 'Choose a project.' }).int().positive(),
  title: z
    .string()
    .trim()
    .min(1, 'Enter a ticket title.')
    .max(TICKET_TITLE_MAX, `Keep the title to ${TICKET_TITLE_MAX} characters or fewer.`),
  description: z
    .string()
    .trim()
    .min(1, 'Describe the issue.')
    .max(
      TICKET_DESCRIPTION_MAX,
      `Keep the description to ${TICKET_DESCRIPTION_MAX} characters or fewer.`
    ),
})
export const updateTicketSchema = createTicketSchema.pick({ title: true, description: true })
export type TicketFormValues = z.infer<typeof createTicketSchema>
export type TicketContentValues = z.infer<typeof updateTicketSchema>
// What the shared form emits. `projectId` is absent only when the parent resolves
// the project itself (the widget's site tag).
export type TicketSubmission = TicketContentValues & Partial<Pick<TicketFormValues, 'projectId'>>
export interface TicketProjectOption {
  id: number
  name: string
}
type Ticket = typeof tickets.$inferSelect
export type TicketSummary = Pick<Ticket, 'id' | 'title' | 'status' | 'projectId' | 'timestamp'> & {
  projectName: string
}
export type TicketDetail = TicketSummary &
  Pick<Ticket, 'description' | 'userId' | 'githubIssueId'> & {
    submitterName: string | null
    githubIssueUrl: string | null
    canEdit: boolean
  }
