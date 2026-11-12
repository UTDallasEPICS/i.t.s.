import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { chatThreadMembers, chatThreadMessages, chatThreads, organization, project, user } from '~~/server/db/schema'
import { db } from '~~/server/utils/db'
import { getUserOrgId } from '~~/server/utils/authorization'
import { requireUser } from '~~/server/utils/session'

export default defineEventHandler(async (event) => {
  const currentUser = requireUser(event)
  const orgId = await getUserOrgId(currentUser.id)
  const memberships = db.select({ threadId: chatThreadMembers.threadId }).from(chatThreadMembers)
    .where(eq(chatThreadMembers.userId, currentUser.id))
  const threads = db.select({ thread: chatThreads, projectName: project.name, organizationName: organization.name })
    .from(chatThreads)
    .innerJoin(project, eq(project.id, chatThreads.projectId))
    .innerJoin(organization, eq(organization.id, project.projectPartnerId))
    .where(orgId === null ? undefined : and(eq(project.projectPartnerId, orgId), inArray(chatThreads.id, memberships)))
    .all()
  if (!threads.length) return []

  const ids = threads.map(row => row.thread.id)
  const members = db.select({ threadId: chatThreadMembers.threadId, id: user.id, name: user.name, organizationName: organization.name })
    .from(chatThreadMembers).innerJoin(user, eq(user.id, chatThreadMembers.userId))
    .leftJoin(organization, eq(user.orgId, organization.id))
    .where(inArray(chatThreadMembers.threadId, ids)).all()
  const messages = db.select({
    ...getTableColumns(chatThreadMessages),
    senderName: user.name,
  }).from(chatThreads)
    .innerJoin(chatThreadMessages, sql`${chatThreadMessages.id} = (
      SELECT m.id FROM chat_thread_messages m
      WHERE m.thread_id = ${chatThreads.id}
      ORDER BY m.created_at DESC, m.id DESC LIMIT 1
    )`)
    .innerJoin(user, eq(chatThreadMessages.userId, user.id))
    .where(inArray(chatThreads.id, ids)).all()
  const latest = new Map<number, typeof messages[number]>()
  for (const message of messages) if (!latest.has(message.threadId)) latest.set(message.threadId, message)

  return threads.map(({ thread, projectName, organizationName }) => {
    const participants = members.filter(member => member.threadId === thread.id)
    return {
      ...thread, projectName, organizationName,
      members: participants.map(({ id, name, organizationName }) => ({ id, name, organizationName })),
      isMember: participants.some(member => member.id === currentUser.id),
      latestMessage: latest.get(thread.id) ?? null,
    }
  }).sort((a, b) =>
    (b.latestMessage?.createdAt ?? b.createdAt).getTime() - (a.latestMessage?.createdAt ?? a.createdAt).getTime()
    || b.id - a.id,
  )
})
