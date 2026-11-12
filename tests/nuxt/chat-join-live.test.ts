// @vitest-environment node
import { afterAll, expect, it, vi } from 'vitest'
import { createApp, createRouter, defineEventHandler, toWebHandler, type H3EventContext } from 'h3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { Peer } from 'crossws'
import { chatThreadMessages, chatThreads, organization, project, user } from '../../server/db/schema'
import { db } from '../../server/utils/db'
import { onChatMemberJoined } from '../../server/utils/chat/events'
import { publishChatMessage, subscribePeer, subscribeUserToThread, unsubscribePeer } from '../../server/utils/chat/ws'
import join from '../../server/api/chat/conversations/[threadId]/join.post'

vi.mock('../../server/utils/db', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const schema = await import('../../server/db/schema')
  return { db: drizzle(new Database(':memory:'), { schema }) }
})

vi.mock('nitropack/runtime', () => {
  const hooks = new Map<string, Array<(payload: never) => unknown>>()
  return { useNitroApp: () => ({ hooks: {
    hook: (name: string, listener: (payload: never) => unknown) => {
      hooks.set(name, [...(hooks.get(name) ?? []), listener])
    },
    callHook: async (name: string, payload: never) => {
      for (const listener of hooks.get(name) ?? []) await listener(payload)
    },
  } }) }
})

migrate(db, { migrationsFolder: './drizzle' })
db.$client.pragma('foreign_keys = ON')
afterAll(() => db.$client.close())

it('joins through HTTP and immediately delivers later messages to the existing socket', async () => {
  db.insert(organization).values({ id: 'org', name: 'Partner' }).run()
  db.insert(project).values({ id: 1, name: 'Project', githubRepo: 'test/repo', projectPartnerId: 'org' }).run()
  db.insert(user).values({ id: 'npts', name: 'NPTS', email: 'npts@example.com' }).run()
  const thread = db.insert(chatThreads).values({ projectId: 1 }).returning().get()!
  const peer = { send: vi.fn() } as unknown as Peer & { send: ReturnType<typeof vi.fn> }
  const outsider = { send: vi.fn() } as unknown as Peer & { send: ReturnType<typeof vi.fn> }
  subscribePeer('npts', [], peer)
  subscribePeer('outsider', [], outsider)
  onChatMemberJoined(({ userId, threadId }) => subscribeUserToThread(userId, threadId))

  const app = createApp()
  app.use(defineEventHandler(event => {
    event.context.user = { id: 'npts', name: 'NPTS', email: 'npts@example.com', emailVerified: true,
      createdAt: new Date(), updatedAt: new Date() } as NonNullable<H3EventContext['user']>
  }))
  const router = createRouter()
  router.post('/api/chat/conversations/:threadId/join', join)
  app.use(router)
  try {
    const response = await toWebHandler(app)(new Request(`http://localhost/api/chat/conversations/${thread.id}/join`, { method: 'POST' }))
    expect(response.status).toBe(200)
    const message = db.insert(chatThreadMessages).values({ threadId: thread.id, userId: 'npts', plainTextBody: 'Hello' }).returning().get()!
    publishChatMessage(thread.id, { ...message, createdAt: message.createdAt.toISOString() })
    expect(peer.send).toHaveBeenCalledOnce()
    expect(outsider.send).not.toHaveBeenCalled()
  } finally {
    unsubscribePeer(peer)
    unsubscribePeer(outsider)
  }
})
