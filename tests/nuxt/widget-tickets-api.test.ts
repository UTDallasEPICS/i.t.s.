// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, toWebHandler } from 'h3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { organization, project, tickets } from '../../server/db/schema'
import { db } from '../../server/utils/db'
import { resetRateLimits } from '../../server/utils/rateLimit'
import widgetTicketsHandler from '../../server/api/widget/tickets.post'
import { createGitHubIssue } from '../../server/utils/github-issues'

// Use an in-memory database, same as the partner ticket API tests.
vi.mock('../../server/utils/db', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const schema = await import('../../server/db/schema')
  return { db: drizzle(new Database(':memory:'), { schema }) }
})

vi.mock('../../server/utils/github-issues', () => ({ createGitHubIssue: vi.fn() }))

migrate(db, { migrationsFolder: './drizzle' })
db.$client.pragma('foreign_keys = ON')

const validTicket = {
  title: '  Registration form is broken  ',
  description: '  Nothing happens when I click Submit.  ',
}

// The browser sends the embedding page's origin; the endpoint finds the project from it.
const siteA = { origin: 'https://site-a.example.com' }

// No session middleware here: the widget endpoint must work for anonymous users.
function requestRaw(body: string, headers: Record<string, string> = siteA) {
  const app = createApp()
  app.use('/api/widget/tickets', widgetTicketsHandler)
  return toWebHandler(app)(
    new Request('http://localhost/api/widget/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    })
  )
}

function request(body: unknown = validTicket, headers: Record<string, string> = siteA) {
  return requestRaw(JSON.stringify(body), headers)
}

function expectNoTickets() {
  expect(db.select().from(tickets).all()).toEqual([])
}

describe('POST /api/widget/tickets', () => {
  beforeEach(() => {
    resetRateLimits()
    // tickets.githubIssueId is unique, so every issue needs its own number.
    let issueNumber = 41
    vi.mocked(createGitHubIssue)
      .mockReset()
      .mockImplementation(async () => String(++issueNumber))
    db.delete(tickets).run()
    db.delete(project).run()
    db.delete(organization).run()
    db.insert(organization).values({ id: 'org-a', name: 'Partner A' }).run()
    db.insert(project)
      .values([
        {
          id: 1,
          name: 'Website A',
          githubRepo: 'example/a',
          projectPartnerId: 'org-a',
          // The site can live at a path; only the origin is compared.
          stageUrl: 'https://stage.site-a.example.com/app',
          prodUrl: 'https://site-a.example.com/',
        },
        {
          id: 2,
          name: 'Website B',
          githubRepo: 'example/b',
          projectPartnerId: 'org-a',
          prodUrl: 'https://site-b.example.com',
        },
        // A project with no URLs: no page can match it.
        { id: 3, name: 'Website C', githubRepo: 'example/c', projectPartnerId: 'org-a' },
      ])
      .run()
  })

  afterAll(() => {
    db.$client.close()
  })

  it('saves an anonymous ticket under the project that owns the page origin and returns only the id', async () => {
    const response = await request()
    expect(response.status).toBe(201)

    const body = await response.json()
    // Only the id goes back to the public widget.
    expect(body).toEqual({ id: expect.any(Number) })

    expect(db.select().from(tickets).all()).toEqual([
      {
        id: body.id,
        projectId: 1,
        title: 'Registration form is broken',
        description: 'Nothing happens when I click Submit.',
        userId: null,
        status: 'open',
        timestamp: expect.any(String),
        githubIssueId: '42',
      },
    ])
    // The issue goes to the project repository, same as partner tickets.
    expect(createGitHubIssue).toHaveBeenCalledWith(
      'example/a',
      'Registration form is broken',
      'Nothing happens when I click Submit.'
    )
  })

  it('matches the stage URL origin too', async () => {
    const response = await request(validTicket, { origin: 'https://stage.site-a.example.com' })
    expect(response.status).toBe(201)
    expect(db.select().from(tickets).get()?.projectId).toBe(1)
  })

  it('does not save a ticket when the GitHub issue cannot be created', async () => {
    vi.mocked(createGitHubIssue).mockRejectedValue(
      Object.assign(new Error('boom'), { statusCode: 502 })
    )
    const response = await request()
    expect(response.status).toBe(502)
    expectNoTickets()
  })

  it.each([
    ['unknown origin', { origin: 'https://unknown.example.com' }],
    ['different port', { origin: 'https://site-a.example.com:8443' }],
    ['different scheme', { origin: 'http://site-a.example.com' }],
    ['look-alike host', { origin: 'https://site-a.example.com.evil.test' }],
    ['opaque origin', { origin: 'null' }],
    ['garbage origin', { origin: 'not a url' }],
    ['no origin header', {}],
  ])('rejects %s with a generic 404', async (_name, headers) => {
    const response = await request(validTicket, headers)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ statusMessage: 'Not found' })
    expectNoTickets()
    expect(createGitHubIssue).not.toHaveBeenCalled()
  })

  it.each([
    ['empty object', {}],
    ['null body', null],
    ['array body', [validTicket]],
    ['missing title', { description: 'Details' }],
    ['blank title', { ...validTicket, title: ' \n ' }],
    ['too long title', { ...validTicket, title: 'a'.repeat(201) }],
    ['missing description', { title: 'Issue' }],
    ['too long description', { ...validTicket, description: 'a'.repeat(5001) }],
  ])('rejects invalid input: %s', async (_name, body) => {
    const response = await request(body)
    expect(response.status).toBe(400)
    expectNoTickets()
  })

  it.each(['siteTag', 'projectId', 'userId', 'status', 'timestamp', 'githubIssueId'])(
    'rejects a caller-supplied %s field',
    async (field) => {
      const response = await request({ ...validTicket, [field]: 'forged' })
      expect(response.status).toBe(400)
      expectNoTickets()
    }
  )

  it('rejects malformed JSON without writing a ticket', async () => {
    const response = await requestRaw('{"title":')
    expect(response.status).toBe(400)
    expectNoTickets()
  })

  it('blocks a client after 3 submissions in a short time with 429 and Retry-After', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await request()).status).toBe(201)
    }

    const blocked = await request()
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBe('300')
    expect(db.select().from(tickets).all()).toHaveLength(3)
  })

  it('limits each project to 50 tickets an hour across many clients', async () => {
    for (let i = 0; i < 50; i++) {
      expect(
        (await request(validTicket, { ...siteA, 'x-forwarded-for': `7.7.${i}.1` })).status
      ).toBe(201)
    }
    const blocked = await request(validTicket, { ...siteA, 'x-forwarded-for': '7.7.200.1' })
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    // Another project is not affected.
    expect((await request(validTicket, { origin: 'https://site-b.example.com' })).status).toBe(201)
  })

  it('counts different clients separately', async () => {
    const clientA = { ...siteA, 'x-forwarded-for': '1.1.1.1' }
    const clientB = { ...siteA, 'x-forwarded-for': '2.2.2.2' }

    for (let i = 0; i < 3; i++) await request(validTicket, clientA)
    expect((await request(validTicket, clientA)).status).toBe(429)
    expect((await request(validTicket, clientB)).status).toBe(201)
  })

  it('uses the last X-Forwarded-For entry, so fake earlier entries do not bypass the limit', async () => {
    for (let i = 0; i < 3; i++) {
      await request(validTicket, { ...siteA, 'x-forwarded-for': `10.0.0.${i}, 9.9.9.9` })
    }
    const blocked = await request(validTicket, {
      ...siteA,
      'x-forwarded-for': '10.0.0.99, 9.9.9.9',
    })
    expect(blocked.status).toBe(429)
  })
})
