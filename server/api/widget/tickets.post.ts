import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getRequestIP,
  readBody,
  setResponseHeader,
  setResponseStatus,
} from 'h3'
import { updateTicketSchema } from '#shared/tickets'
import { project, tickets } from '../../db/schema'
import { db } from '../../utils/db'
import { createGitHubIssue } from '../../utils/github-issues'
import { checkRateLimit } from '../../utils/rateLimit'

// Limits from ADR 006. Starting values; tune with real traffic.
const PER_CLIENT = { max: 3, windowMs: 10_000, cooldownMs: 5 * 60_000 }
const PER_SITE = { max: 50, windowMs: 60 * 60_000, cooldownMs: 0 }

function originOf(value: string | null | undefined) {
  try {
    const { origin } = new URL(value ?? '')
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

// Public endpoint: lets the embeddable widget submit a ticket without a session.
// The project is the one whose stage or prod URL has the same origin as the page
// that embeds the widget (the browser sends it as the Origin header).
export default defineEventHandler(async (event) => {
  // Accept only title and description (the schema is strict). Project, status,
  // author and timestamps are decided by the server, not the caller.
  const result = updateTicketSchema.safeParse(await readBody(event))

  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid ticket data' })
  }

  // Real client IP. Behind a load balancer, the last X-Forwarded-For entry is
  // the one our proxy added; earlier entries can be faked by the client.
  const forwarded = getRequestHeader(event, 'x-forwarded-for')
  const ip = forwarded?.split(',').at(-1)?.trim() || getRequestIP(event) || 'unknown'

  // Keyed by IP only: the Origin header is caller-chosen, so it must not create keys.
  const perClient = checkRateLimit(`client:${ip}`, PER_CLIENT)
  if (!perClient.ok) {
    setResponseHeader(event, 'Retry-After', perClient.retryAfter)
    throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
  }

  // Find the project this widget is embedded in.
  const origin = originOf(getRequestHeader(event, 'origin'))
  // ponytail: scans every project, since URLs may carry paths and SQL can't compare
  // origins. Fine for tens of projects; add an indexed origin column past that.
  const targetProject = origin
    ? db
        .select({
          id: project.id,
          githubRepo: project.githubRepo,
          stageUrl: project.stageUrl,
          prodUrl: project.prodUrl,
        })
        .from(project)
        .orderBy(project.id)
        .all()
        .find((p) => originOf(p.stageUrl) === origin || originOf(p.prodUrl) === origin)
    : undefined

  // Generic response: don't reveal which sites exist.
  if (!targetProject) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  // Per project, so a bot using many IPs still can't flood one project.
  const perSite = checkRateLimit(`site:${targetProject.id}`, PER_SITE)
  if (!perSite.ok) {
    setResponseHeader(event, 'Retry-After', perSite.retryAfter)
    throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
  }

  // Same as partner tickets: the project repository gets an issue for every ticket.
  const githubIssueId = targetProject.githubRepo
    ? await createGitHubIssue(targetProject.githubRepo, result.data.title, result.data.description)
    : null

  const created = db
    .insert(tickets)
    .values({
      projectId: targetProject.id,
      title: result.data.title,
      description: result.data.description,
      // Widget users have no ITS account, so there is no author.
      userId: null,
      status: 'open',
      timestamp: new Date().toISOString(),
      githubIssueId,
    })
    .returning({ id: tickets.id })
    .get()

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Unable to create ticket' })
  }

  // Return only what the widget needs, never other project data.
  setResponseStatus(event, 201)
  return { id: created.id }
})
