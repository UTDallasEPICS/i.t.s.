import 'dotenv/config'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
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

  const [created] = await db
    .insert(schema.organization)
    .values({ name: PARTNER_NAME })
    .returning()

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
  await db
    .insert(schema.user)
    .values({ email, name: 'NPTS Admin' })
    .onConflictDoNothing({ target: schema.user.email })
  console.log({ admin: email })
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

// Partner project repos. Keep these in sync with the EPICS project list; repos
// are matched by githubRepo so re-running the seed never duplicates a project.
const SEED_PROJECTS: { name: string; githubRepo: string }[] = [
  { name: 'Reading Huddle App', githubRepo: 'UTDallasEPICS/Reading-MLK' },
  { name: 'EPICS Alumni Tracker', githubRepo: 'UTDallasEPICS/epics-alumni' },
  { name: 'Class Scheduling App', githubRepo: 'UTDallasEPICS/the-samaritan-inn' },
  { name: 'Call Volume Trend Analysis Tool', githubRepo: 'UTDallasEPICS/vets4war' },
  { name: 'AI-Driven Mentorship Platform', githubRepo: 'UTDallasEPICS/lwf-aidmp' },
  { name: 'PawGo', githubRepo: 'UTDallasEPICS/bvrit' },
  { name: 'Digital Twister Game', githubRepo: 'UTDallasEPICS/sw-dtg' },
  { name: 'BeyondNeuro / Free Cognitive Wellness Platform', githubRepo: 'UTDallasEPICS/beyond-neuro' },
  { name: 'DFW Mental Health Resource Hub', githubRepo: 'UTDallasEPICS/a-mindful-resource' },
  { name: 'EPICS Super App (ESA)', githubRepo: 'UTDallasEPICS/e.s.a.' },
  { name: 'Website Calendar/Event Application', githubRepo: 'UTDallasEPICS/Rainbow-Roundup-Calendar-Event-App' },
  { name: 'Digital Neighborhood/Building Block', githubRepo: 'UTDallasEPICS/brain-healthy' },
  { name: 'Indoor Navigator', githubRepo: 'UTDallasEPICS/IndoorNav' },
  { name: 'Hope Restored Inventory Tracking', githubRepo: 'UTDallasEPICS/Hope-Restored-Inventory-Tracking' },
  { name: 'Donor and Grant Tracker', githubRepo: 'UTDallasEPICS/mckinney-library-foundation' },
  { name: 'Electronic Health Record System', githubRepo: 'UTDallasEPICS/hch' },
  { name: 'Issue Tracking System (ITS)', githubRepo: 'UTDallasEPICS/i.t.s.' },
  { name: 'Digital Learning Platform', githubRepo: 'UTDallasEPICS/sw-dlp' },
  { name: 'Inventory and Production Tracking', githubRepo: 'UTDallasEPICS/xuchil' },
  { name: 'Caregiver Compassion Bot — Software Team', githubRepo: 'UTDallasEPICS/BrainCharge' },
]

async function seedPartnerProjects(partnerId: string) {
  for (const seedProject of SEED_PROJECTS) {
    const existing = await db.query.project.findFirst({
      where: (p, { eq }) => eq(p.githubRepo, seedProject.githubRepo),
    })
    if (existing) continue

    await db.insert(schema.project).values({ ...seedProject, projectPartnerId: partnerId })
  }
  console.log(`Seeded ${SEED_PROJECTS.length} partner projects (existing repos skipped).`)
}

async function main() {
  console.log('Start seeding...')

  if (process.env.SEED_ADMIN_EMAIL) {
    await seedAdmin(process.env.SEED_ADMIN_EMAIL)
  }

  const user = await seedUser()
  const partner = await seedProjectPartner()
  await seedProject(partner.id)
  await seedPartnerProjects(partner.id)

  // Point the seeded user at the partner, which is what makes them an org user
  // rather than a global admin (orgId null).
  if (user.orgId !== partner.id) {
    await db.update(schema.user).set({ orgId: partner.id }).where(eq(schema.user.id, user.id))
    console.log({ user: { ...user, orgId: partner.id } })
  }

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
