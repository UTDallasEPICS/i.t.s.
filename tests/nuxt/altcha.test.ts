// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { createChallenge, solveChallenge } from 'altcha-lib'
import { deriveHmacKeySecret } from 'altcha-lib/frameworks/h3'
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2'

const TEST_KEY = 'test-altcha-key'
// Read lazily by server/utils/altcha.ts, so setting it here is enough.
process.env.ALTCHA_HMAC_KEY = TEST_KEY

const { resetUsedChallenges, verifyAltcha } = await import('../../server/utils/altcha')

// Builds a solved payload the way the widget would. Cost and counter are tiny
// so tests stay fast; the server only checks the signed result, not the effort.
async function solvedPayload(
  options: { expiresAt?: number; secret?: string } = {},
  tamper?: (payload: { solution: { derivedKey: string } }) => void
) {
  const secret = options.secret ?? TEST_KEY
  const challenge = await createChallenge({
    algorithm: 'PBKDF2/SHA-256',
    cost: 1,
    counter: 10,
    deriveKey,
    hmacSignatureSecret: secret,
    hmacKeySignatureSecret: await deriveHmacKeySecret(secret),
    expiresAt: options.expiresAt ?? Math.floor(Date.now() / 1000) + 60,
  })
  const solution = await solveChallenge({ challenge, deriveKey })
  const payload = { challenge, solution: solution! }
  tamper?.(payload)
  return btoa(JSON.stringify(payload))
}

describe('verifyAltcha', () => {
  beforeEach(() => {
    resetUsedChallenges()
  })

  it('accepts a correctly solved challenge', async () => {
    expect(await verifyAltcha(await solvedPayload())).toBe(true)
  })

  it('rejects a payload that was already used', async () => {
    const payload = await solvedPayload()
    expect(await verifyAltcha(payload)).toBe(true)
    expect(await verifyAltcha(payload)).toBe(false)
  })

  it('rejects an expired challenge', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) - 10
    expect(await verifyAltcha(await solvedPayload({ expiresAt }))).toBe(false)
  })

  it('rejects a challenge signed with a different key', async () => {
    expect(await verifyAltcha(await solvedPayload({ secret: 'attacker-key' }))).toBe(false)
  })

  it('rejects a wrong solution', async () => {
    const payload = await solvedPayload({}, (p) => {
      p.solution.derivedKey = '00'.repeat(32)
    })
    expect(await verifyAltcha(payload)).toBe(false)
  })

  it.each(['', 'not-base64!', btoa('{}'), btoa('not json')])(
    'rejects a malformed payload: %j',
    async (payload) => {
      expect(await verifyAltcha(payload)).toBe(false)
    }
  )
})
