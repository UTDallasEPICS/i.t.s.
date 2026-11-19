// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseNptsOrigin, subdomainSchema } from '../../server/utils/npts-host'

describe('parseNptsOrigin', () => {
  it.each([
    ['https://support-stage.npts.tech', { env: 'stage', subdomain: 'support' }],
    ['https://sos-noble-awards-stage.npts.tech', { env: 'stage', subdomain: 'sos-noble-awards' }],
    ['https://support.npts.tech', { env: 'prod', subdomain: 'support' }],
    ['https://SUPPORT.npts.tech', { env: 'prod', subdomain: 'support' }],
    ['https://sos-noble-awards.npts.tech', { env: 'prod', subdomain: 'sos-noble-awards' }],
  ])('reads %s', (origin, expected) => {
    expect(parseNptsOrigin(origin)).toEqual(expected)
  })

  it.each([
    'https://npts.tech',
    'https://-stage.npts.tech',
    'https://support-.npts.tech',
    'https://a.support-stage.npts.tech',
    'https://support-stage.npts.tech.evil.test',
    'https://support-stagenpts.tech',
    'http://support-stage.npts.tech',
    'https://support-stage.npts.tech:8443',
    'https://example.com',
    'null',
    'not a url',
    '',
    undefined,
  ])('ignores %s', (origin) => {
    expect(parseNptsOrigin(origin)).toBeNull()
  })
})

describe('subdomainSchema', () => {
  it('trims and lowercases', () => {
    expect(subdomainSchema.parse('  Support ')).toBe('support')
  })

  it.each(['', 'has space', 'dot.ted', '-lead', 'trail-', 'a'.repeat(64)])(
    'rejects %j',
    (value) => {
      expect(subdomainSchema.safeParse(value).success).toBe(false)
    }
  )
})
