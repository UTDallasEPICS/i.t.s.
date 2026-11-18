import 'dotenv/config'
import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const email = process.argv[2]?.trim().toLowerCase()
const database = process.env.DEV_OTP_DATABASE
const authUrl = process.env.BETTER_AUTH_URL

if (process.env.NODE_ENV !== 'development') {
  throw new Error('OTP lookup requires NODE_ENV=development.')
}
if (!email || !email.includes('@')) throw new Error('Usage: pnpm dev:otp <email>')
if (!database) throw new Error('Set DEV_OTP_DATABASE to the local development SQLite file.')
if (!authUrl || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(authUrl).hostname)) {
  throw new Error('OTP lookup requires a localhost BETTER_AUTH_URL.')
}

const path = resolve(database.replace(/^file:/, ''))
if (!existsSync(path)) throw new Error('Development database does not exist.')
const db = new Database(path, { readonly: true, fileMustExist: true })
try {
  const row = db.prepare(`
    SELECT value, createdAt, expiresAt FROM verification
    WHERE identifier = ? ORDER BY createdAt DESC, rowid DESC LIMIT 1
  `).get(`sign-in-otp-${email}`) as { value: string, createdAt: number, expiresAt: number } | undefined
  if (!row) throw new Error('No sign-in code found for this email.')
  const code = row.value.split(':')[0]
  if (!code || !/^\d{6}$/.test(code)) throw new Error('Stored OTP is not a plaintext six-digit code.')
  console.log(`Code: ${code}`)
  console.log(`Created: ${new Date(row.createdAt * 1000).toISOString()}`)
  console.log(`Expires: ${new Date(row.expiresAt * 1000).toISOString()}${row.expiresAt * 1000 <= Date.now() ? ' (expired)' : ''}`)
} finally {
  db.close()
}
