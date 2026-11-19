import { z } from 'zod'

// Sites deployed by ITS live under this domain (see the NPTS infra `projects` list):
//   stage: https://<subdomain>-stage.npts.tech  (<subdomain> = subdomain_name)
//   prod:  https://<subdomain>.npts.tech
export const NPTS_DOMAIN = 'npts.tech'

// One DNS label: lowercase letters, digits and inner hyphens, at most 63 characters.
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

// The `subdomain_name` from the infra config, e.g. `support` for ITS.
export const subdomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(DNS_LABEL, 'Subdomain must be lowercase letters, digits and hyphens')

export type NptsSite = { env: 'stage' | 'prod'; subdomain: string }

// Reads which NPTS deployment a page origin belongs to, or null if it is not one.
// Only plain https origins on the default port count, same as the URL match.
export function parseNptsOrigin(origin: string | null | undefined): NptsSite | null {
  let url: URL
  try {
    url = new URL(origin ?? '')
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.port !== '') return null

  // URL lowercases the host. Strip the domain; what is left must be a single label.
  const suffix = `.${NPTS_DOMAIN}`
  if (!url.hostname.endsWith(suffix)) return null
  const label = url.hostname.slice(0, -suffix.length)
  if (!DNS_LABEL.test(label)) return null

  if (label.endsWith('-stage')) {
    const subdomain = label.slice(0, -'-stage'.length)
    return DNS_LABEL.test(subdomain) ? { env: 'stage', subdomain } : null
  }
  // Any other single label is a prod host.
  return { env: 'prod', subdomain: label }
}
