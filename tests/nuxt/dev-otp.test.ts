// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

let directory: string
let path: string

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'its-dev-otp-test-'))
  path = join(directory, 'test.db')
  const db = new Database(path)
  db.exec('CREATE TABLE verification (identifier TEXT, value TEXT, createdAt INTEGER, expiresAt INTEGER)')
  const insert = db.prepare('INSERT INTO verification VALUES (?, ?, ?, ?)')
  insert.run('sign-in-otp-person@example.com', '123456:0', 1700000000, 1700000300)
  insert.run('sign-in-otp-person@example.com', '654321:1', 1700000600, 1700000900)
  insert.run('email-verification-otp-person@example.com', '777777:0', 1700000800, 1700000900)
  db.close()
})

afterAll(() => rmSync(directory, { recursive: true, force: true }))

function run(email: string, env: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/dev-otp.ts', email], {
    encoding: 'utf8', env: { ...process.env, DEV_OTP_DATABASE: path, BETTER_AUTH_URL: 'http://localhost:3000', ...env },
  })
}

describe('development OTP lookup', () => {
  it('shows the latest sign-in code and creation time for a normalized email', () => {
    const result = run('PERSON@example.com', { NODE_ENV: 'development' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Code: 654321')
    expect(result.stdout).toContain(new Date(1700000600 * 1000).toISOString())
    expect(result.stdout).not.toContain('777777')
  })

  it('refuses production and non-local auth URLs', () => {
    const prod = run('person@example.com', { NODE_ENV: 'production' })
    const remote = run('person@example.com', { NODE_ENV: 'development', BETTER_AUTH_URL: 'https://example.com' })
    expect(prod.status).not.toBe(0)
    expect(remote.status).not.toBe(0)
    expect(prod.stdout).not.toContain('654321')
    expect(remote.stdout).not.toContain('654321')
  })

  it('does not create a missing database or return another user’s code', () => {
    const missingFile = run('person@example.com', { NODE_ENV: 'development', DEV_OTP_DATABASE: join(directory, 'missing.db') })
    const missingEmail = run('other@example.com', { NODE_ENV: 'development' })
    expect(missingFile.status).not.toBe(0)
    expect(missingEmail.status).not.toBe(0)
    expect(missingEmail.stdout).not.toContain('654321')
  })
})
