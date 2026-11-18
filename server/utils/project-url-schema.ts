import { z } from 'zod'

// Stage and prod URLs are shown to users and matched against the widget's page
// origin, so only web URLs are allowed (z.url() alone accepts javascript: and file:).
export const projectUrlSchema = z.url({ protocol: /^https?$/ })
