import { z } from 'zod'

export const githubRepoSchema = z
  .string()
  .trim()
  .transform((value) => {
    if (value.startsWith('https://github.com/')) {
      return value.replace('https://github.com/', '').replace(/\/$/, '')
    }

    return value
  })
  .pipe(
    z
      .string()
      .regex(
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
        'GitHub repository must use owner/name format or a GitHub URL'
      )
  )
