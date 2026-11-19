# GitHub Issue Integration

> Draft for review.

When a ticket is submitted, ITS can open a matching issue in the project's GitHub repository and store the issue number on the ticket. This document explains how that works and how to use or extend it.

## Overview

| Piece | Location |
| --- | --- |
| GitHub API helper | [server/utils/github-issues.ts](../server/utils/github-issues.ts) |
| Ticket creation (caller) | [server/utils/create-ticket.ts](../server/utils/create-ticket.ts) |
| Ticket schema (`githubIssueId`) | [server/db/schema.ts](../server/db/schema.ts) |
| Environment variables | [.env.example](../.env.example) |

## Flow

1. An authenticated user submits a ticket for a project.
2. `createTicket` validates the input and checks that the user can access the project. This happens **before** any GitHub call, so a user cannot create issues in another project's repository.
3. If the project has a `githubRepo` value, `createGitHubIssue(repo, title, description)` creates an issue in that repository.
4. The returned issue number is saved as `githubIssueId` on the ticket, inside a database transaction that re-checks access.
5. If the project has no `githubRepo`, no issue is created and `githubIssueId` is `null`.

## API: `createGitHubIssue`

```ts
import { createGitHubIssue } from '../utils/github-issues'

const issueNumber = await createGitHubIssue('owner/repo-name', 'Title', 'Description body')
// issueNumber: string, e.g. "42"
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `repo` | `string` | Repository in `owner/name` form. |
| `title` | `string` | Issue title. Sent as the GitHub `title` field. |
| `description` | `string` | Issue body. Sent as the GitHub `body` field. |

**Returns:** the issue number as a string (not the GitHub issue `id`, and not the URL).

**Throws:** an H3 error with status `502` and message `Failed to create GitHub issue: <reason>`, where `<reason>` is GitHub's error message when available. Callers should let this propagate or handle it explicitly; a failed GitHub call currently fails the whole ticket submission.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | Yes, for issue creation | Token sent as `Authorization: Bearer ...`. Must be allowed to create issues in the target repository. |
| `GITHUB_REPO_ITS` | Seed only | Used by [server/db/seed.ts](../server/db/seed.ts) to set the repo for the seeded project. If unset, the seeded project is skipped. |

The repository for a normal ticket comes from the project record's `githubRepo` field, not from an environment variable.

Example from `.env.example`:

```env
GITHUB_TOKEN="ghp_your-personal-access-token"
GITHUB_REPO_ITS="owner/repo-name"
```

## Behavior notes

- **Repo routing:** always set per project. To change where issues go, update that project's `githubRepo`.
- **Access checks come first:** the GitHub call happens only after the caller is authorized for the project.
- **No retry or queue:** each submission makes one request to GitHub.
- **Issue body:** contains the ticket description exactly as submitted.
- **Sync:** ITS does not update the GitHub issue when the ticket changes later (see [partner-tickets.md](partner-tickets.md), which lists this as an open decision).

## Testing

Tests live in `tests/nuxt/` (for example `tickets-api.test.ts`). When testing, mock the GitHub call rather than hitting the live API, so tests do not create real issues.

## Extending

- To add another GitHub operation, add a function next to `createGitHubIssue` in `github-issues.ts` and reuse the same headers.
- Keep the access check ahead of any call that writes to GitHub.
- Update this document when the function signature, configuration, or error behavior changes.
