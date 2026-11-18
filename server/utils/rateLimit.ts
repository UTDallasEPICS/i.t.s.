// In-memory sliding-window rate limiter with a cooldown (see ADR 006).
// Counts are per server instance and reset on restart.
type Entry = {
  hits: number[] // request times inside the window
  windowMs: number
  blockedUntil: number // 0 when not blocked
}

const entries = new Map<string, Entry>()

// Bound memory: callers are anonymous, so keys can be made up. When the map grows
// past this, drop expired entries, then the oldest ones.
// ponytail: oldest-first eviction can forget an active block under a flood of
// distinct keys; move to Redis or an LRU if that ever matters.
const MAX_KEYS = 10_000

export type RateLimitOptions = {
  max: number // requests allowed inside the window
  windowMs: number // window length in milliseconds
  cooldownMs: number // how long to block after going over the limit
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfter: number }

function isExpired(entry: Entry, now: number) {
  const lastHit = entry.hits.at(-1) ?? 0
  return now >= entry.blockedUntil && now - lastHit >= entry.windowMs
}

function prune(now: number) {
  for (const [key, entry] of entries) {
    if (isExpired(entry, now)) entries.delete(key)
  }
  // Still too big: Map keeps insertion order, so this drops the oldest keys.
  for (const key of entries.keys()) {
    if (entries.size < MAX_KEYS) break
    entries.delete(key)
  }
}

export function checkRateLimit(
  key: string,
  opts: RateLimitOptions,
  now = Date.now()
): RateLimitResult {
  let entry = entries.get(key)
  if (!entry) {
    if (entries.size >= MAX_KEYS) prune(now)
    entry = { hits: [], windowMs: opts.windowMs, blockedUntil: 0 }
    entries.set(key, entry)
  }

  // Still blocked from an earlier burst?
  if (now < entry.blockedUntil) {
    return { ok: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) }
  }

  // Keep only requests inside the window (sliding window), then add this one.
  entry.hits = entry.hits.filter((t) => now - t < opts.windowMs)
  entry.hits.push(now)
  entry.windowMs = opts.windowMs

  if (entry.hits.length > opts.max) {
    // With no cooldown, wait until the oldest request leaves the window.
    const waitMs = opts.cooldownMs > 0 ? opts.cooldownMs : opts.windowMs - (now - entry.hits[0]!)
    entry.blockedUntil = now + waitMs
    return { ok: false, retryAfter: Math.ceil(waitMs / 1000) }
  }

  return { ok: true }
}

// Test helpers.
export function resetRateLimits() {
  entries.clear()
}

export function rateLimitSize() {
  return entries.size
}
