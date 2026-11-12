// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createRouter, defineEventHandler, toWebHandler, type H3EventContext } from 'h3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { chatThreadMembers, chatThreadMessages, chatThreads, organization, project, user } from '../../server/db/schema'
import { db } from '../../server/utils/db'
import list from '../../server/api/chat/conversations/index.get'
import create from '../../server/api/chat/conversations/index.post'
import join from '../../server/api/chat/conversations/[threadId]/join.post'
import history from '../../server/api/chat/threads/[threadId]/messages.get'
import send from '../../server/api/chat/threads/[threadId]/messages.post'
import { emitChatMemberJoined } from '../../server/utils/chat/events'

vi.mock('../../server/utils/db', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const schema = await import('../../server/db/schema')
  return { db: drizzle(new Database(':memory:'), { schema }) }
})
vi.mock('../../server/utils/chat/events', () => ({
  emitChatMessage: vi.fn(), emitChatThreadCreated: vi.fn(), emitChatMemberJoined: vi.fn(),
}))

migrate(db, { migrationsFolder: './drizzle' })
db.$client.pragma('foreign_keys = ON')
afterAll(() => db.$client.close())

function request(path: string, userId: string, method = 'GET', body?: unknown) {
  const app = createApp()
  app.use(defineEventHandler(event => {
    event.context.user = { id: userId, name: userId, email: `${userId}@example.com`, emailVerified: true,
      createdAt: new Date(), updatedAt: new Date() } as NonNullable<H3EventContext['user']>
  }))
  const router = createRouter()
  router.get('/api/chat/conversations', list)
  router.post('/api/chat/conversations', create)
  router.post('/api/chat/conversations/:threadId/join', join)
  router.get('/api/chat/threads/:threadId/messages', history)
  router.post('/api/chat/threads/:threadId/messages', send)
  app.use(router)
  return toWebHandler(app)(new Request(`http://localhost${path}`, {
    method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  db.delete(chatThreadMessages).run()
  db.delete(chatThreadMembers).run()
  db.delete(chatThreads).run()
  db.delete(project).run()
  db.delete(user).run()
  db.delete(organization).run()
  db.insert(organization).values([{ id: 'org', name: 'Partner' }, { id: 'other', name: 'Other' }]).run()
  db.insert(project).values({ id: 1, name: 'Project', githubRepo: 'test/repo', projectPartnerId: 'org' }).run()
  db.insert(user).values([
    { id: 'npts', name: 'NPTS', email: 'npts@example.com' },
    { id: 'other-npts', name: 'NPTS 2', email: 'other-npts@example.com' },
    { id: 'partner', name: 'Partner', email: 'partner@example.com', orgId: 'org' },
    { id: 'peer', name: 'Peer', email: 'peer@example.com', orgId: 'org' },
    { id: 'outsider', name: 'Other', email: 'outsider@example.com', orgId: 'other' },
  ]).run()
})

const payload = { projectId: 1, memberIds: ['partner'], message: 'Hello' }

describe('partner conversations', () => {
  it('creates channels independently and reuses group DMs while sending the new message', async () => {
    const first = await (await request('/api/chat/conversations', 'npts', 'POST', payload)).json()
    const next = await (await request('/api/chat/conversations', 'npts', 'POST', { ...payload, message: 'Again' })).json()
    const channel = await (await request('/api/chat/conversations', 'npts', 'POST', { ...payload, name: 'Planning' })).json()
    expect(next.thread.id).toBe(first.thread.id)
    expect(channel.thread.id).not.toBe(first.thread.id)
    expect(db.select().from(chatThreadMessages).all()).toHaveLength(3)
  })

  it('prevents partners from creating and rejects cross-organization members', async () => {
    expect((await request('/api/chat/conversations', 'partner', 'POST', payload)).status).toBe(403)
    expect((await request('/api/chat/conversations', 'npts', 'POST', { ...payload, memberIds: ['outsider'] })).status).toBe(400)
    expect(db.select().from(chatThreads).all()).toHaveLength(0)
  })

  it('rejects messages over 4000 characters for new conversations and replies', async () => {
    expect((await request('/api/chat/conversations', 'npts', 'POST', { ...payload, message: 'x'.repeat(4001) })).status).toBe(400)
    const { thread } = await (await request('/api/chat/conversations', 'npts', 'POST', { ...payload, message: 'x'.repeat(4000) })).json()
    expect((await request(`/api/chat/threads/${thread.id}/messages`, 'npts', 'POST', { plainTextBody: 'x'.repeat(4001) })).status).toBe(400)
    expect((await request(`/api/chat/threads/${thread.id}/messages`, 'npts', 'POST', { plainTextBody: 'x'.repeat(4000) })).status).toBe(201)
  })

  it('lets NPTS preview before joining but only members can send; join is idempotent', async () => {
    const { thread } = await (await request('/api/chat/conversations', 'npts', 'POST', payload)).json()
    const path = `/api/chat/threads/${thread.id}/messages`
    expect((await request(path, 'other-npts')).status).toBe(200)
    expect((await request(path, 'peer')).status).toBe(404)
    expect((await request(path, 'other-npts', 'POST', { plainTextBody: 'Reply' })).status).toBe(404)
    expect((await request(`/api/chat/conversations/${thread.id}/join`, 'peer', 'POST')).status).toBe(403)
    expect((await request(`/api/chat/conversations/${thread.id}/join`, 'other-npts', 'POST')).status).toBe(200)
    expect((await request(`/api/chat/conversations/${thread.id}/join`, 'other-npts', 'POST')).status).toBe(200)
    expect(emitChatMemberJoined).toHaveBeenCalledTimes(2)
    expect(emitChatMemberJoined).toHaveBeenCalledWith('other-npts', thread.id)
    expect((await request(path, 'other-npts', 'POST', { plainTextBody: 'Reply' })).status).toBe(201)
  })

  it('lists only memberships for partners but allows NPTS to discover all', async () => {
    await request('/api/chat/conversations', 'npts', 'POST', payload)
    expect(await (await request('/api/chat/conversations', 'peer')).json()).toEqual([])
    expect(await (await request('/api/chat/conversations', 'outsider')).json()).toEqual([])
    expect(await (await request('/api/chat/conversations', 'partner')).json()).toHaveLength(1)
    expect(await (await request('/api/chat/conversations', 'other-npts')).json()).toMatchObject([{ isMember: false }])
  })

  it('sorts by latest activity time, using creation time for conversations without messages', async () => {
    const threads = db.insert(chatThreads).values([
      { projectId: 1, name: 'Recent message', createdAt: new Date('2026-01-01T00:00:00Z') },
      { projectId: 1, name: 'Older message', createdAt: new Date('2026-01-02T00:00:00Z') },
      { projectId: 1, name: 'No messages', createdAt: new Date('2026-01-03T00:00:00Z') },
    ]).returning().all()
    db.insert(chatThreadMessages).values([
      { threadId: threads[0]!.id, userId: 'npts', plainTextBody: 'Newest', createdAt: new Date('2026-01-05T00:00:00Z') },
      { threadId: threads[0]!.id, userId: 'npts', plainTextBody: 'Inserted later but older', createdAt: new Date('2026-01-01T00:00:00Z') },
      { threadId: threads[1]!.id, userId: 'npts', plainTextBody: 'Older', createdAt: new Date('2026-01-02T00:00:00Z') },
    ]).run()
    const result = await (await request('/api/chat/conversations', 'npts')).json()
    expect(result.map((thread: { name: string }) => thread.name)).toEqual(['Recent message', 'No messages', 'Older message'])
    expect(result[0].latestMessage.plainTextBody).toBe('Newest')
  })
})
