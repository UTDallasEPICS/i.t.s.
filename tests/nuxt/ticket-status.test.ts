// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createRouter, defineEventHandler, toWebHandler, type H3EventContext } from 'h3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { organization, project, tickets, user } from '../../server/db/schema'
import { db } from '../../server/utils/db'
import statusHandler from '../../server/api/tickets/[id]/status.patch'
import detailHandler from '../../server/api/tickets/[id].get'
import { ticketStatuses } from '../../shared/tickets'

vi.mock('../../server/utils/db', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const schema = await import('../../server/db/schema')
  return { db: drizzle(new Database(':memory:'), { schema }) }
})

migrate(db, { migrationsFolder: './drizzle' })
db.$client.pragma('foreign_keys = ON')
afterAll(() => db.$client.close())

/** Build a test request against status.patch + [id].get. */
function request(id: string, identity: string | null = 'npts', body?: unknown) {
  const app = createApp()
  app.use(
    defineEventHandler((event) => {
      event.context.user =
        identity === null ? undefined : ({ id: identity } as H3EventContext['user'])
    })
  )
  const router = createRouter()
  router.patch('/api/tickets/:id/status', statusHandler)
  router.get('/api/tickets/:id', detailHandler)
  app.use(router)
  const isPatch = body !== undefined
  return toWebHandler(app)(
    new Request(
      isPatch
        ? `http://localhost/api/tickets/${id}/status`
        : `http://localhost/api/tickets/${id}`,
      {
        method: isPatch ? 'PATCH' : 'GET',
        headers: { 'content-type': 'application/json' },
        body: isPatch ? JSON.stringify(body) : undefined,
      }
    )
  )
}

beforeEach(() => {
  db.delete(tickets).run()
  db.delete(project).run()
  db.delete(user).run()
  db.delete(organization).run()
  db.insert(organization)
    .values([
      { id: 'org-a', name: 'A' },
    ])
    .run()
  db.insert(user)
    .values([
      { id: 'npts', name: 'NPTS User', email: 'npts@example.com', orgId: null },
      { id: 'partner', name: 'Partner User', email: 'partner@example.com', orgId: 'org-a' },
    ])
    .run()
  db.insert(project)
    .values([{ id: 1, name: 'Website A', githubRepo: 'example/a', projectPartnerId: 'org-a' }])
    .run()
  db.insert(tickets)
    .values([
      {
        id: 1,
        projectId: 1,
        userId: 'partner',
        title: 'Bug report',
        description: 'Something is broken.',
        status: 'open',
        timestamp: '2026-10-01T12:00:00.000Z',
      },
    ])
    .run()
})

describe('PATCH /api/tickets/:id/status', () => {
  describe('authentication & authorization', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const res = await request('1', null, { status: 'in_progress' })
      expect(res.status).toBe(401)
    })

    it('returns 403 for partner users', async () => {
      const res = await request('1', 'partner', { status: 'in_progress' })
      expect(res.status).toBe(403)
    })

    it('returns 200 for NPTS users', async () => {
      const res = await request('1', 'npts', { status: 'in_progress' })
      expect(res.status).toBe(200)
    })
  })

  describe('input validation', () => {
    it('returns 400 for an unknown status value', async () => {
      const res = await request('1', 'npts', { status: 'unknown_status' })
      expect(res.status).toBe(400)
    })

    it('returns 400 for a missing status field', async () => {
      const res = await request('1', 'npts', {})
      expect(res.status).toBe(400)
    })

    it('returns 400 for a numeric status', async () => {
      const res = await request('1', 'npts', { status: 42 })
      expect(res.status).toBe(400)
    })

    it.each(ticketStatuses)('accepts the canonical status "%s"', async (status) => {
      const res = await request('1', 'npts', { status })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe(status)
      // Reset for next iteration
      db.update(tickets).set({ status: 'open' }).where(eq(tickets.id, 1)).run()
    })
  })

  describe('not found', () => {
    it('returns 404 for a non-existent ticket ID', async () => {
      const res = await request('999', 'npts', { status: 'closed' })
      expect(res.status).toBe(404)
    })

    it('returns 404 for an invalid ticket ID format', async () => {
      const res = await request('abc', 'npts', { status: 'closed' })
      expect(res.status).toBe(404)
    })
  })

  describe('successful update', () => {
    it('updates status and returns the full ticket detail', async () => {
      const res = await request('1', 'npts', { status: 'in_progress' })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toMatchObject({
        id: 1,
        status: 'in_progress',
        canUpdateStatus: true,
      })
    })

    it('persists the new status so the detail GET reflects it', async () => {
      await request('1', 'npts', { status: 'resolved' })
      const res = await request('1', 'npts')
      expect((await res.json()).status).toBe('resolved')
    })

    it('allows NPTS to cycle through every status', async () => {
      for (const status of ticketStatuses) {
        const res = await request('1', 'npts', { status })
        expect(res.status).toBe(200)
        expect((await res.json()).status).toBe(status)
      }
    })
  })
})

