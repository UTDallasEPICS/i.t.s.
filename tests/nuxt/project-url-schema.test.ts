// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { projectUrlSchema } from '../../server/utils/project-url-schema'

describe('projectUrlSchema', () => {
  it.each(['https://example.com', 'http://localhost:4000', 'https://stage.example.com/app'])(
    'accepts %s',
    (url) => {
      expect(projectUrlSchema.safeParse(url).success).toBe(true)
    }
  )

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.com', 'example.com', ''])(
    'rejects %s',
    (url) => {
      expect(projectUrlSchema.safeParse(url).success).toBe(false)
    }
  )
})
