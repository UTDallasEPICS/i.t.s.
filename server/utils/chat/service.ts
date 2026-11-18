import { z } from 'zod'
import {
  and,
  eq,
  getTableColumns,
  inArray,
  sql,
} from 'drizzle-orm'
import {
  chatThreadMembers,
  chatThreadMessages,
  chatThreads,
  organization,
  project,
  user,
  type insertChatThreadMembersSchema,
  type insertChatThreadMessagesSchema,
  type insertChatThreadsSchema,
  type selectChatThreadMessagesSchema,
  type selectChatThreadsSchema,
} from '../../db/schema'
import type { ConversationView } from '../../../shared/types/chat'
import { db } from '../db'
import { emitChatMemberJoined, emitChatMessage, emitChatThreadCreated } from './events'
import { getUserOrgId } from '../authorization'
import {
  findOpenThreadWithThisSetOfMembers,
  messageBelongsToThread,
  readMessagePage,
  readThreadPage,
  threadExists,
} from './internal/queries'

export type Result<T, E> = { ok: true, value: T } | { ok: false, error: E }

type PaginationError = 'invalid-page-size' | 'thread-not-found' | 'invalid-cursor'

export const chatPageDirectionSchema = z.enum(['latest', 'oldest'])

export type ChatPageDirection = z.infer<typeof chatPageDirectionSchema>

type CreateThreadInput = {
  projectId: insertChatThreadsSchema["projectId"],
  name?: string,
  initialMessage: Omit<insertChatThreadMessagesSchema, "threadId" | "createdAt" | "id">,
  otherMembers: insertChatThreadMembersSchema["userId"][]
}


type CreateThreadOutput = {
  created: boolean,
  thread: selectChatThreadsSchema
}

type CreateThreadTransactionOutput =
  | { created: false, thread: selectChatThreadsSchema }
  | { created: true, thread: selectChatThreadsSchema, initialMessage: selectChatThreadMessagesSchema }

export const getOrCreateThread = async (data: CreateThreadInput): Promise<Result<CreateThreadOutput, 'thread-not-found'>> => {
  const allMembers = [...new Set([...data.otherMembers, data.initialMessage.userId])]

  const result = db.transaction((trx): CreateThreadTransactionOutput => {
    const existingThread = data.name === undefined
      ? findOpenThreadWithThisSetOfMembers(trx, data.projectId, allMembers)
      : null
    if (existingThread) {
      return { created: false, thread: existingThread }
    }

    const thread = trx
      .insert(chatThreads)
      .values({ projectId: data.projectId, name: data.name })
      .returning()
      .get()
    if (!thread) {
      throw new Error("Failed to insert chat thread record.")
    }

    trx
      .insert(chatThreadMembers)
      .values(allMembers.map(userId => ({ threadId: thread.id, userId })))
      .run()
    const initialMessage = trx
      .insert(chatThreadMessages)
      .values({ ...data.initialMessage, threadId: thread.id })
      .returning()
      .get()
    if (!initialMessage) {
      throw new Error("Failed to insert initial chat message.")
    }

    return { created: true, thread, initialMessage }
  }, { behavior: 'immediate' })

  if (result.created) {
    try {
      await emitChatThreadCreated(result.thread, allMembers)
    } catch (error) {
      console.error('[chat] failed to emit chat:thread-created', error)
    }

    try {
      await emitChatMessage(result.initialMessage)
    } catch (error) {
      console.error('[chat] failed to emit chat:message', error)
    }
  } else {
    const sent = await sendMessage({
      threadId: result.thread.id,
      userId: data.initialMessage.userId,
      plainTextBody: data.initialMessage.plainTextBody,
    })
    if (!sent.ok) {
      return { ok: false, error: 'thread-not-found' }
    }
  }

  return { ok: true, value: result }
}

type JoinConversationInput = {
  threadId: number,
  userId: string,
}

export const joinConversation = async (data: JoinConversationInput): Promise<Result<{ threadId: number }, 'thread-not-found'>> => {
  const thread = db.select().from(chatThreads).where(eq(chatThreads.id, data.threadId)).get()
  if (!thread || thread.closedAt) {
    return { ok: false, error: 'thread-not-found' }
  }

  db.insert(chatThreadMembers).values({ threadId: data.threadId, userId: data.userId }).onConflictDoNothing().run()

  try {
    await emitChatMemberJoined(data.userId, data.threadId)
  } catch (error) {
    console.error('[chat] failed to emit chat:member-joined', error)
  }

  return { ok: true, value: { threadId: data.threadId } }
}

export const sendMessage = async (data: insertChatThreadMessagesSchema): Promise<Result<selectChatThreadMessagesSchema, 'thread-not-found'>> => {
  if (!threadExists(data.threadId)) {
    return { ok: false, error: 'thread-not-found' }
  }

  const message = await db.insert(chatThreadMessages).values(data).returning().get()
  if (!message) {
    throw new Error("Failed to insert chat message.")
  }

  try {
    await emitChatMessage(message)
  } catch (error) {
    console.error('[chat] failed to emit chat:message', error)
  }

  return { ok: true, value: message }
}

type PaginateThreadMessagesInput = {
  threadId: selectChatThreadMessagesSchema["threadId"]
  direction: ChatPageDirection
  cursorMessageId?: selectChatThreadMessagesSchema["id"]
  pageSize?: number
}

type PaginateThreadMessagesOutput = {
  messages: selectChatThreadMessagesSchema[],
  metadata: {
    hasMore: boolean
  }
}

const THREAD_PAGE_MAX = 25

export const paginateThreadMessages = async (data: PaginateThreadMessagesInput): Promise<Result<PaginateThreadMessagesOutput, PaginationError>> => {
  if (!validPageSize(data.pageSize)) return { ok: false, error: 'invalid-page-size' }

  const resolvedPageSize = data.pageSize ?? THREAD_PAGE_MAX

  if (!threadExists(data.threadId)) {
    return { ok: false, error: 'thread-not-found' }
  }

  if (data.cursorMessageId !== undefined && !messageBelongsToThread(data.cursorMessageId, data.threadId)) {
    return { ok: false, error: 'invalid-cursor' }
  }

  const readingForward = data.direction === 'oldest'

  const rows = readMessagePage({ ...data, limit: resolvedPageSize + 1 })

  // The extra row only tells us whether another page exists in the direction we
  // are reading, so it never reaches the caller.
  const hasMore = rows.length > resolvedPageSize
  const page = hasMore ? rows.slice(0, resolvedPageSize) : rows

  return {
    ok: true,
    value: { messages: readingForward ? page : [...page].reverse(), metadata: { hasMore } },
  }
}

type ListThreadsInput = {
  userId: string,
  afterThreadId?: selectChatThreadsSchema["id"],
  pageSize?: number,
}

type ListThreadsOutput = {
  threads: selectChatThreadsSchema[],
  metadata: {
    hasMore: boolean
  }
}

export const listThreadsForUser = async (data: ListThreadsInput): Promise<Result<ListThreadsOutput, 'invalid-page-size'>> => {
  if (!validPageSize(data.pageSize)) return { ok: false, error: 'invalid-page-size' }

  const resolvedPageSize = data.pageSize ?? THREAD_PAGE_MAX

  const rows = readThreadPage({ ...data, limit: resolvedPageSize + 1 })

  const hasMore = rows.length > resolvedPageSize
  const page = hasMore ? rows.slice(0, resolvedPageSize) : rows

  return { ok: true, value: { threads: page, metadata: { hasMore } } }
}

type ListConversationsInput = {
  userId: string,
}

export const listConversations = async (data: ListConversationsInput): Promise<ConversationView[]> => {
  const orgId = await getUserOrgId(data.userId)

  const membershipRows = db.select({ threadId: chatThreadMembers.threadId }).from(chatThreadMembers)
    .where(eq(chatThreadMembers.userId, data.userId))
    .all()

  const membershipIds = membershipRows.map(row => row.threadId)

  const threads = db.select({ thread: chatThreads, projectName: project.name, organizationName: organization.name })
    .from(chatThreads)
    .innerJoin(project, eq(project.id, chatThreads.projectId))
    .innerJoin(organization, eq(organization.id, project.projectPartnerId))
    .where(orgId === null ? sql`1=1` : and(eq(project.projectPartnerId, orgId), inArray(chatThreads.id, membershipIds)))
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
    const latestMsg = latest.get(thread.id)
    return {
      id: thread.id,
      name: thread.name,
      projectId: thread.projectId,
      projectName,
      organizationName,
      createdAt: thread.createdAt.toISOString(),
      closedAt: thread.closedAt ? new Date(thread.closedAt).toISOString() : null,
      members: participants.map(({ id, name, organizationName }) => ({ id, name, organizationName })),
      isMember: participants.some(member => member.id === data.userId),
      latestMessage: latestMsg ? {
        id: latestMsg.id,
        plainTextBody: latestMsg.plainTextBody,
        senderName: latestMsg.senderName ?? '',
        createdAt: latestMsg.createdAt.toISOString(),
      } : null,
    }
  }).sort((a, b) =>
    (new Date(b.latestMessage?.createdAt ?? b.createdAt ?? '').getTime() - new Date(a.latestMessage?.createdAt ?? a.createdAt ?? '').getTime())
    || b.id - a.id,
  )
}

function validPageSize(size: number | undefined) {
  return size === undefined || (Number.isInteger(size) && size > 0 && size <= THREAD_PAGE_MAX)
}
