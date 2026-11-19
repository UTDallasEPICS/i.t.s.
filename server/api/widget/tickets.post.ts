import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getRequestIP,
  readBody,
  setResponseHeader,
  setResponseStatus,
} from 'h3'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { updateTicketSchema } from '#shared/tickets'
import { project, tickets } from '../../db/schema'
import { db } from '../../utils/db'
import { createGitHubIssue } from '../../utils/github-issues'
import { checkRateLimit } from '../../utils/rateLimit'
import { verifyAltcha } from '../../utils/altcha'
import { parseNptsOrigin } from '../../utils/npts-host'

// Same fields as a partner ticket (title, description), plus the ALTCHA payload.
// Strict, so callers can't set project, status, author or timestamps.
const widgetTicketSchema = z.strictObject({
  ...updateTicketSchema.shape,
  // ALTCHA payload from the widget (Base64 JSON). Checked below, not trusted.
  altcha: z.string().min(1).max(10_000),
})

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

const projectColumns = { id: project.id, githubRepo: project.githubRepo }

// Sites on npts.tech are found by name: the stage host carries the project's
// subdomain, the prod host its GitHub repository name. Any other site (custom
// domains, localhost) is found by its stored stage or prod URL.
function findProjectByOrigin(header: string | null | undefined) {
  const site = parseNptsOrigin(header)
  if (site?.env === 'stage') {
    return db
      .select(projectColumns)
      .from(project)
      .where(eq(project.subdomain, site.subdomain))
      .get()
  }
  if (site?.env === 'prod') {
    // githubRepo is `owner/name`; compare the name part, ignoring case like GitHub.
    // If two owners share a repo name, the oldest project wins.
    return db
      .select(projectColumns)
      .from(project)
      .where(
        sql`lower(substr(${project.githubRepo}, instr(${project.githubRepo}, '/') + 1)) = ${site.repoName}`
      )
      .orderBy(project.id)
      .get()
  }

  const origin = originOf(header)
  if (!origin) return undefined
  // ponytail: scans every project, since URLs may carry paths and SQL can't compare
  // origins. Fine for tens of projects; add an indexed origin column past that.
  return db
    .select({ ...projectColumns, stageUrl: project.stageUrl, prodUrl: project.prodUrl })
    .from(project)
    .orderBy(project.id)
    .all()
    .find((p) => originOf(p.stageUrl) === origin || originOf(p.prodUrl) === origin)
}

// Public endpoint: lets the embeddable widget submit a ticket without a session.
// The project comes from the origin of the page that embeds the widget (the
// browser sends it as the Origin header); see findProjectByOrigin.
export default defineEventHandler(async (event) => {
  const result = widgetTicketSchema.safeParse(await readBody(event))

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

  // Proof that a browser solved our challenge (ADR 005). Checked after the rate
  // limit, so bots can't make us run many verifications.
  if (!(await verifyAltcha(result.data.altcha))) {
    throw createError({ statusCode: 400, statusMessage: 'Verification failed' })
  }

  // Find the project this widget is embedded in.
  const targetProject = findProjectByOrigin(getRequestHeader(event, 'origin'))

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
