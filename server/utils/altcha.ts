import { CappedMap, create, deriveHmacKeySecret, randomInt } from 'altcha-lib/frameworks/h3'
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2'

// Challenges expire after 5 minutes (ADR 005).
const CHALLENGE_TTL_SECONDS = 5 * 60

// Remembers used challenges to block replays. In memory, like the rate limiter:
// per instance and lost on restart.
const usedChallenges = new CappedMap<string, boolean>({ maxSize: 10_000 })

let altcha: ReturnType<typeof create> | undefined
let secrets: { signature: string; keySignature: string } | undefined

async function getSecrets() {
  if (secrets) return secrets
  const secret = process.env.ALTCHA_HMAC_KEY
  if (!secret) throw new Error('ALTCHA_HMAC_KEY is not set')
  secrets = { signature: secret, keySignature: await deriveHmacKeySecret(secret) }
  return secrets
}

// Created on first use, so a missing key fails the request instead of server start.
export async function getAltcha() {
  if (altcha) return altcha
  const { signature, keySignature } = await getSecrets()

  altcha = create({
    deriveKey,
    hmacSignatureSecret: signature,
    hmacKeySignatureSecret: keySignature,
    store: usedChallenges,
    createChallengeParameters: () => ({
      algorithm: 'PBKDF2/SHA-256',
      // Starting values; tune so solving takes about a second on a phone.
      cost: 2_000,
      counter: randomInt(10_000, 5_000),
      expiresAt: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS,
    }),
  })
  return altcha
}

// Checks the widget's payload: our signature, a correct solution, not expired,
// and not used before. Returns true only if all of these pass.
export async function verifyAltcha(payload: string) {
  const { signature, keySignature } = await getSecrets()
  const result = await (
    await getAltcha()
  ).verify(payload, deriveKey, signature, keySignature, usedChallenges)
  return result.error === null
}

// For tests: forget used challenges between test cases.
export function resetUsedChallenges() {
  usedChallenges.clear()
}
