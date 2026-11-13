import 'dotenv/config'
import Database from 'better-sqlite3'
import { eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL!.replace('file:', '')
const sqlite = new Database(connectionString)
const db = drizzle(sqlite, { schema })

const USER_EMAIL = 'seeded-user@email.com'
const PARTNER_NAME = 'Sample Seeded Project Partner'
const GITHUB_REPO_ITS = process.env.GITHUB_REPO_ITS ?? ''

type SeededUser = typeof schema.user.$inferSelect
// An organization is a project partner. The table keeps the Better Auth model
// name, so the seed calls it by what it means here.
type SeededProjectPartner = typeof schema.organization.$inferSelect

// Every step checks for an existing row first so the seed is safe to re-run.
async function seedUser(): Promise<SeededUser> {
  const existing = await db.query.user.findFirst({ where: (u, { eq }) => eq(u.email, USER_EMAIL) })

  if (existing) {
    console.log({ user: existing })
    return existing
  }

  const [created] = await db
    .insert(schema.user)
    .values({ email: USER_EMAIL, name: 'Sample Seeded User' })
    .returning()

  if (!created) {
    throw new Error(`failed to seed user ${USER_EMAIL}`)
  }

  console.log({ user: created })
  return created
}

async function seedProjectPartner(): Promise<SeededProjectPartner> {
  const existing = await db.query.organization.findFirst({
    where: (o, { eq }) => eq(o.name, PARTNER_NAME),
  })

  if (existing) {
    console.log({ projectPartner: existing })
    return existing
  }

  const [created] = await db.insert(schema.organization).values({ name: PARTNER_NAME }).returning()

  if (!created) {
    throw new Error(`failed to seed project partner ${PARTNER_NAME}`)
  }

  console.log({ projectPartner: created })
  return created
}

// Signup is disabled, so a fresh deploy needs one real account to log in with.
// The migration Lambda passes SEED_* vars from the env file; orgId stays null,
// which gives this user NPTS (global) access.
async function seedAdmin(email: string) {
  const normalizedEmail = email.trim().toLowerCase()

  const existing = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.email, normalizedEmail),
  })

  if (existing) {
    if (existing.orgId !== null) {
      console.warn(`Skipping ${normalizedEmail}: existing account belongs to an organization.`)
      return
    }

    console.log(`Admin already exists: ${normalizedEmail}`)
    return
  }

  await db.insert(schema.user).values({
    email: normalizedEmail,
    name: 'NPTS Admin',
    orgId: null,
  })

  console.log(`Admin created: ${normalizedEmail}`)
}

async function seedProject(partnerId: string) {
  if (!GITHUB_REPO_ITS) {
    console.warn('GITHUB_REPO_ITS is not set; skipping the seeded project.')
    return null
  }

  const existing = await db.query.project.findFirst({
    where: (p, { eq }) => eq(p.id, 1),
  })

  if (existing) {
    console.log({ project: existing })
    return existing
  }

  const [created] = await db
    .insert(schema.project)
    .values({
      id: 1,
      name: 'My Test Project',
      githubRepo: GITHUB_REPO_ITS,
      projectPartnerId: partnerId,
    })
    .returning()

  console.log({ project: created })
  return created
}

async function seedChatThreads() {
  const partner = await seedProjectPartner()
  const project = await seedProject(partner.id)

  if (!project) return

  const admin = await db.query.user.findFirst({
    where: (u) => isNull(u.orgId),
  })
  const user = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.email, USER_EMAIL),
  })

  if (!admin || !user) {
    console.warn('Skipping chat seed: admin or seeded user not found.')
    return
  }

  const threads = [
    {
      id: 1,
      name: 'Community website',
      projectId: project.id,
      members: [admin.id, user.id],
      messages: [
        { userId: user.id, plainTextBody: 'Hi! We are preparing the community website for launch next week.' },
        { userId: admin.id, plainTextBody: 'Great. Which part would you like us to take a look at first?' },
        { userId: user.id, plainTextBody: 'The volunteer signup form. A few people said they could not finish submitting it on their phone.' },
        { userId: admin.id, plainTextBody: 'Could you share the browser and the step where they got stuck? We can try to reproduce it.' },
        { userId: user.id, plainTextBody: 'Safari on an iPhone. It happens after they select their availability and press Continue.' },
        { userId: admin.id, plainTextBody: 'Thanks, that gives us a good starting point. We will check the mobile layout and validation.' },
      ],
    },
    {
      id: 2,
      name: 'Volunteer onboarding',
      projectId: project.id,
      members: [admin.id, user.id],
      messages: [
        { userId: admin.id, plainTextBody: 'Can we review the new volunteer welcome email?' },
      ],
    },
  ]

  for (const thread of threads) {
    const existing = await db.query.chatThreads.findFirst({
      where: (t, { eq }) => eq(t.id, thread.id),
    })

    if (existing) {
      console.log({ chatThread: existing })
      continue
    }

    const [created] = await db
      .insert(schema.chatThreads)
      .values({ id: thread.id, name: thread.name, projectId: thread.projectId })
      .returning()

    if (!created) {
      throw new Error(`failed to seed chat thread ${thread.id}`)
    }

    await db.insert(schema.chatThreadMembers).values(
      thread.members.map(userId => ({ threadId: created.id, userId })),
    )

    await db.insert(schema.chatThreadMessages).values(
      thread.messages.map((message, index) => ({
        ...message,
        threadId: created.id,
        createdAt: new Date(Date.now() - (thread.messages.length - index) * 60_000),
      })),
    )

    console.log({ chatThread: created, members: thread.members.length, messages: thread.messages.length })
  }
}

async function main() {
  console.log('Start seeding...')

  // Seed NPTS team members as administrators. SEED_ADMIN_EMAIL can add one
  // deployment-specific admin without changing this list.
  const adminEmails = new Set([
    'seth2stephens@gmail.com',
    'kevj.antony@gmail.com',
    'hey@jasonaa.me',
    'kimwan8076@gmail.com',
    'sjaryan2007@gmail.com',
    'samhappy8910@gmail.com',
    'tushar.wani@npts.tech',
  ])

  if (process.env.SEED_ADMIN_EMAIL) {
    adminEmails.add(process.env.SEED_ADMIN_EMAIL)
  }

  for (const email of adminEmails) {
    await seedAdmin(email)
  }

  const user = await seedUser()
  const partner = await seedProjectPartner()
  await seedProject(partner.id)

  // Point the seeded user at the partner, which is what makes them an org user
  // rather than a global admin (orgId null).
  if (user.orgId !== partner.id) {
    await db.update(schema.user).set({ orgId: partner.id }).where(eq(schema.user.id, user.id))
    console.log({ user: { ...user, orgId: partner.id } })
  }

  await seedChatThreads()

  console.log('Seeding finished.')
}

main()
  .then(() => {
    sqlite.close()
  })
  .catch((e) => {
    console.error(e)
    sqlite.close()
    process.exit(1)
  })
