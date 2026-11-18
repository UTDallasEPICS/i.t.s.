# Partner ticket flows

From the dashboard, choose **View tickets** (`/tickets`) or **New ticket** (`/tickets/new`).
After submission, **View ticket** opens the saved ticket. The list shows title, project,
current status and creation time, with project/status filters and a **Refresh** action.
Detail shows the description and submitter, and links the GitHub issue when its number is
available. **Refresh** or returning to the page loads the latest stored status.

Authors can edit the title and description of their own **open** tickets. This rule is
checked again by the server on save; failed saves retain the draft. Content editing does
not change status, project, author, creation time or GitHub identifiers.

## Access and API

All endpoints require the existing authenticated session. An existing database user with
`orgId: null` is NPTS and can access all projects. A partner can access projects belonging
to their organization. Access uses the current database assignment, not session role claims
or request fields. Missing users receive 403 and signed-out callers receive 401.

OTP self-registration is disabled; provision accounts before sign-in. Omitting `orgId` from
a user insert defaults to NPTS, so always assign partners an organization.

| Endpoint                 | Contract                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/projects`      | Accessible `{ id, name }[]`, sorted by name                                                                               |
| `POST /api/tickets`      | Strict `{ projectId, title, description }`; trims text, assigns author, `open` status and creation timestamp; returns 201 |
| `GET /api/tickets`       | Accessible summaries, newest first; optional `projectId` and `status` filters                                             |
| `GET /api/tickets/:id`   | Accessible detail, including server-computed `canEdit`                                                                    |
| `PATCH /api/tickets/:id` | Strict `{ title, description }`, both nonblank; author-owned open tickets only                                            |

Missing/inaccessible IDs both return 404. An inaccessible project filter returns 404.
Invalid input, repeated/unknown query parameters or extra body fields return 400.
Disallowed content edits return 403. No status mutation endpoint is added by this work.
Response shapes and ownership are recorded in [ADR 002](adr/002_shared_ticket_routes.md).
There is no last-updated timestamp in the current schema; `timestamp` is creation time.

## Shared ticket form (#36)

`app/components/shared/TicketForm.vue` is the one ticket form. The partner **New ticket**
screen renders it as `<SharedTicketForm>` and the widget imports the same file in
`widget/src/WidgetRoot.ce.vue`; there is no separate widget form. Following
[ADR 004](adr/004_widget_isolation.md) it is plain Vue and plain CSS: no Nuxt composables,
Nuxt UI, Tailwind, auth calls or network requests. It validates with the Zod schema in
`shared/tickets.ts`, the same one the API uses, so the messages and the 200/5000 character
limits match on both sides. A build outside Nuxt needs the `#shared` alias
(see `widget/vite.config.ts`).

| Prop/event                                  | Purpose                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `projects?: { id: number; name: string }[]` | Selectable partner projects (defaults to `[]`)                                          |
| `projectId?: number`                        | Fixed project; hides the project selector and takes precedence over `projects`          |
| `omitProject?: boolean`                     | The parent resolves the project itself (widget site tag); the payload has no project    |
| `submitting?: boolean`                      | Disables fields/submission and shows progress                                           |
| `disabled?: boolean`                        | Disables the form without showing progress                                              |
| `error` (optional string or null)           | Parent-provided error displayed as an alert                                             |
| `submit(payload)`                           | Emits trimmed `{ projectId?, title, description }`; the parent performs the API request |

```vue
<!-- ITS: the partner chooses one of their projects -->
<SharedTicketForm
  :projects="projects"
  :submitting="pending"
  :error="error"
  @submit="submitTicket"
/>
<!-- Widget: the site tag decides the project -->
<TicketForm omit-project :submitting="pending" :error="error" @submit="submitTicket" />
```

Colours come from `--its-form-*` CSS variables (`text`, `bg`, `border`, `radius`, `accent`,
`accent-text`, `error`, `muted`, `label`) with light defaults. ITS maps them to Nuxt UI
tokens in `app/assets/css/main.css`; a partner site can set them on `its-widget`.

The form retains input after an error. The parent unmounts/resets it after a successful save.
The API independently validates access; a fixed project prop is not authorization.
Authenticated creation goes through `server/utils/create-ticket.ts`. The public widget
endpoint (#32) must resolve site-tag access and integrate with the shared persistence contract.
Do not expose this authenticated helper as a public route or forge a session for widget users.

## October 18 milestone (#16): demonstration

Use a disposable environment with two organizations, projects for each, a partner assigned
to the first organization, and an NPTS account. Existing seed data alone does not provide
this full fixture. The automated tests build it in memory without modifying local data.

1. Sign in as the partner and submit a ticket for an accessible project.
2. Choose **View ticket**, confirm its content/status, and save a title/description edit.
3. Open **View tickets**: only the partner organization's project tickets appear, including
   those authored by other members. Confirm the project/status filters and detail links.
4. Request a ticket/project owned by the other organization: the API must return 404.
5. Sign in as NPTS and confirm the shared list/detail can read both organizations.
6. Once #48 lands, change a status through its NPTS control, then refresh as the partner.
   Confirm the new status and that editing disappears when the ticket leaves `open`.
   Automated tests already verify changed database status appears on subsequent reads.

Local validation on 2026-11-09: `pnpm lint` and `pnpm typecheck` passed; `pnpm test` passed
all 280 tests across 23 files. Tests cover API access with disposable in-memory SQLite, UI
states with mocked data, and a real Better Auth session-cookie journey with mocked email.
They do not deliver email or create GitHub issues. The shared form was also exercised in a
browser, both in an ITS page and in the built widget on `sample-site/`.

## Remaining work before closing the whole workstream (#5)

- #36/#7: the widget bundle now renders the shared form (it adds Zod, taking the bundle from
  about 29 kB to 47 kB gzipped). The widget owner still confirms the handoff, and the public
  widget endpoint (#32) must use the agreed creation contract.
- #3: finalize shared creation integration across all submission paths and any future
  updated timestamp/status contract. The current helper covers authenticated ITS submission.
- #8 / PR #66: integrate GitHub issue creation, reconcile the extracted create helper, and
  decide whether partner content edits synchronize to GitHub. Currently they update ITS only.
- #48 (Seth): implement NPTS status changes and wire the detail-header integration point.

REQ-F-18 is temporary widget chat, a separate requirement from the **October 18** ticket
visibility milestone; it is not implemented by these partner ticket changes.
