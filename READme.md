# Collabo

**Simple tasks. Together.**

Collabo (short for *Collaboration*) gives a team one shared place to see what needs doing, who is on it, and what is finished. Open it, see the work, update the work, leave.

It is deliberately small: a task list, a Today view, a month calendar and a team page. No boards, no chat, no notifications.

- **No accounts for teams.** A team shares a project access code (like `K7QM-2XPA-9WTH`). Whoever has the code is trusted with that one Collabo.
- **Who are you?** After entering the code you pick your name. That only labels what you change; it is *not* a login, and nobody's name is verified.
- **Manual refresh, on purpose.** There is no live sync or polling. Press **Refresh tasks** to see teammates' changes. Stale edits are detected and rejected (HTTP 409) instead of overwriting anyone.

## What V2 adds

| Area | V2 |
| --- | --- |
| Shared tasks | A task can have **several assignees**. Choose **Everyone** (each person finishes their own part; the task is done when all have) or **Anyone** (one person finishing completes it for the group). Each person has their own progress. |
| Progress note | One shared, editable **progress note** per task. Every change is an immutable, attributed version you can read in the history; clearing is its own deliberate action. Status changes can carry an optional note (blank leaves the note alone). |
| Bigger teams | No ten-member limit. Searchable people pickers, **Select everyone**, paste a list to add many people at once, **rename**, and **remove with a decision** about their unfinished work (hand it to a teammate, or take them off where others remain). Removed people can be brought back. |
| Platform admin | A separate, locked-down area at **`/admin`** for the people who run the platform: dashboard, searchable project directory, per-project tasks and team management, suspend / recover / delete / rotate-code, administrators, and an append-only **audit log**. |
| Safety | Suspended projects are refused on the server (even with old cookies); deleted projects disappear for members but are recoverable; rotating a code kills the old code and every old session. |

V1 behaviour, URLs and data are preserved. See [Upgrading from V1](#upgrading-an-existing-v1-deployment).

## How it fits together

```
Browser (React + Vite + TS + Tailwind v4)
   │  fetch /api/*   (HttpOnly cookies: collabo_session | collabo_admin.*)
   ▼
ONE Vercel Function  (api/[...path].ts → server/router.ts → handlers)
   │  Drizzle ORM
   ▼
Neon serverless Postgres
```

One Vercel project serves the static app and the API. **All of `/api` is a single function** with an internal router: Vercel's Hobby plan allows 12 functions and V2 has far more routes than that, and a single function also means fewer cold starts. The admin and sign-in routes are loaded lazily, so ordinary project traffic never loads the authentication library.

| Concern | Choice |
| --- | --- |
| UI | React 19, React Router, TanStack Query, React Hook Form, Zod, Tailwind CSS v4, Lucide, Sonner, date-fns |
| API | Vercel Functions (Web-standard `export const GET/POST/…` handlers) |
| Admin sign-in | [Better Auth](https://www.better-auth.com) (self-hosted, in your own database): email + password, mandatory TOTP two-factor, sign-up disabled |
| Database | Neon Postgres via `@neondatabase/serverless` (WebSocket pool, per request) |
| ORM / migrations | Drizzle ORM + Drizzle Kit (SQL migrations are committed) |
| Tests | Vitest, with the real route handlers running on in-process Postgres (PGlite) |

## Prerequisites

- Node.js **22 or newer** (`node -v`)
- npm
- A free [Neon](https://neon.tech) account (for the database)
- A [Vercel](https://vercel.com) account (only to deploy)

## Quick start

```bash
git clone <this repository>
cd kollabo
npm install
cp .env.example .env      # then fill in the values (see below)
npm run db:migrate        # create / upgrade the tables in your Neon database
npm run admin:create -- --email you@example.com --name "Your Name"   # optional: first platform admin
npm run dev               # http://localhost:5173  (admin at /admin)
```

`npm run dev` serves both the app **and** the `/api` function from Vite, so you do not need the Vercel CLI to develop. (`vercel dev` also works.)

### Environment variables

Copy `.env.example` to `.env` (git-ignored). Real values are never committed.

| Variable | Required | What it is |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon Postgres connection string. Server-side only. |
| `SESSION_SECRET` | yes | 32+ random characters. Signs the project session cookie. |
| `ACCESS_CODE_PEPPER` | yes | 32+ random characters, different from `SESSION_SECRET`. Keys the hash of access codes. **Treat it as permanent:** changing it invalidates every existing access code. |
| `ADMIN_AUTH_SECRET` | **new, optional** | 32+ random characters, different from the other two. Signs administrator sessions and encrypts their authenticator secrets. Without it `/admin` answers `503 ADMIN_NOT_CONFIGURED` and everything else works as before. |

```bash
openssl rand -base64 48     # run once per secret
```

None use the `VITE_` prefix (which would bundle them into the browser). The server validates them at first use; if any is missing, weak or duplicated it answers `500` with a generic message and logs only the *names* of the offending variables.

## Database and migrations

Schema lives in [`server/db/schema.ts`](server/db/schema.ts); generated SQL lives in [`server/db/migrations`](server/db/migrations) and **is committed**. Production schema changes only happen by running migrations; nothing mutates the schema automatically (no `push`, nothing in the build).

| Command | What it does |
| --- | --- |
| `npm run db:generate` | Turn schema changes into a new SQL migration (works offline) |
| `npm run db:migrate` | Apply pending migrations to the database in `DATABASE_URL` |
| `npm run db:v2:verify` | **Read-only** health report after migrating (see below) |
| `npm run db:studio` | Browse the database in Drizzle Studio |

### The V2 migrations

All three are additive and non-destructive: no table is dropped, no column is dropped, no data is rewritten destructively.

| File | What it does |
| --- | --- |
| `0001_v2_schema.sql` | Generated. Adds `task_assignees`, `task_note_revisions`, `admin_audit_logs`, `rate_limits`, the Better Auth tables (`admin_users`, `admin_sessions`, `admin_auth_accounts`, `admin_verifications`, `admin_two_factors`) and `admin_accounts`; new nullable/defaulted columns on `projects`, `members`, `tasks`, `task_activity`; relaxes `created_by`/`updated_by` to "member **or** admin" with CHECK constraints. |
| `0002_v2_backfill.sql` | One-off data step, safe to read in full: creates one `task_assignees` row for every V1 task that had an assignee (same status and completion), and copies each activity entry's actor name onto the row (so history survives renames). It does not invent assignees for tasks that had none. |
| `0003_v2_append_only.sql` | Database triggers that refuse `UPDATE` on task activity and note revisions, and `UPDATE`/`DELETE`/`TRUNCATE` on the admin audit log (error `23001`). History cannot be edited even by a bug or by the application's own database user. |

Drizzle applies every pending migration in **one transaction**, so a failure rolls the whole upgrade back and leaves the database exactly as it was.

`tasks.assigned_to_member_id` (V1's single assignee) is **kept** and mirrored to the first active assignee, purely so that rolling the application back to V1 still shows sensible data. Drop it in a later release.

## Upgrading an existing V1 deployment

The order matters: **database first, then application**. V1 code keeps working against the V2 schema, so there is no window where the live site is broken.

1. **Make a restore point.** In the Neon console create a **branch** from production (instant, copy-on-write). It is your rollback and your rehearsal ground. (Rehearse first: point a copy of `.env` at the branch, run steps 2–3 there, and check the app against it.)
2. **Migrate** (from your machine, with the *production* `DATABASE_URL`; migrations are deliberately not part of the Vercel build):
   ```bash
   DATABASE_URL="<production connection string>" npm run db:migrate
   ```
3. **Verify the backfill** (read-only; also needs `SESSION_SECRET` and `ACCESS_CODE_PEPPER` in the environment):
   ```bash
   npm run db:v2:verify
   ```
   It prints row counts to compare with what you noted before, and flags: V1 tasks missing their assignee row (**FAIL**, the backfill did not run), status/assignee disagreements (**FAIL**), broken note history (**FAIL**), missing append-only triggers (**FAIL**), and warnings such as *tasks with nobody assigned* (these were unassigned in V1 too; an administrator can assign them from the project page). It exits non-zero on any FAIL.
4. **Add the new environment variable** `ADMIN_AUTH_SECRET` in Vercel (Production, and Preview if used) if you want the admin area.
5. **Deploy** this version.
6. **Create the first administrator** (see below), sign in at `/admin/login`, and set up two-factor.

### Rolling back

- *Application only:* redeploy the previous Vercel deployment. The V2 schema is additive and V1 code keeps working against it (a test applies V1-shaped writes to the migrated schema). Caveats: V1 shows only the first assignee of a shared task and cannot see per-person progress, and V1's status edits do not update assignee rows, so run `npm run db:v2:verify` before upgrading again.
- *Everything:* restore from the Neon branch you made in step 1 (this discards changes made after it).

## Platform administration

Administrators are **not** project members and are never derived from project or member names. They are real accounts with their own sign-in at **`/admin/login`**; the page is `noindex` and separate from the project-code front door.

### Creating administrators

There is **no public sign-up** (the library's sign-up endpoint is disabled and not even routed). Administrators exist only because:

1. **The operator ran the bootstrap command** (needs the production `DATABASE_URL`, e.g. after `vercel env pull .env.local`):
   ```bash
   npm run admin:create -- --email you@example.com --name "Your Name"
   ```
   It asks for a password (hidden, 12+ characters) or, if you leave it empty, generates a one-time password and prints it once. Non-interactive use: set `ADMIN_BOOTSTRAP_PASSWORD`.
2. **An existing administrator added them** under *Admins → Add administrator*. They get a one-time password that must be replaced at first sign-in.

### Signing in

Email + password, then a 6-digit code from an authenticator app (or a one-time backup code). A new administrator is walked through choosing their own password (if they were given a temporary one) and scanning a QR code to enrol two-factor; until both are done, **every admin API call is refused on the server** (`403 PASSWORD_CHANGE_REQUIRED` / `MFA_REQUIRED`), whatever the browser shows.

- **Lost authenticator?** Use a backup code. If those are gone too, an operator runs `npm run admin:create -- --reset-mfa --email them@example.com`, which removes the authenticator and signs them out everywhere; they enrol a new one at next sign-in.
- Sessions last at most 8 hours, can be revoked immediately (deactivating an administrator ends their sessions on the spot and blocks new ones), and are all replaced when the password changes.
- You cannot deactivate yourself, and the last active administrator can never be deactivated.

### What administrators can do

Overview metrics · searchable, filterable, paginated project directory (by project name, **any member's name**, or id prefix) · any project's tasks and team through the **same screens members use** (change assignments, override someone's progress, edit notes, add/rename/remove people, delete tasks) · **suspend / reactivate** · **delete (soft) / recover** · **rotate the access code** (the new code is shown once, never stored or logged in readable form) · rename · manage administrators · browse the **audit log**.

Privileged actions need a **reason** where it matters (suspend, delete, rotate, overriding someone's progress, reopening or deleting a task). Project members only ever see "**Collabo admin**" as the actor, never the administrator's name or reason.

### Audit log

Every privileged action writes a row to `admin_audit_logs` **in the same database transaction** as the change, so a change and its record succeed or fail together. A row holds who (id, name and email as they were), what, which project, the reason and a small before/after summary. Rows can't be changed or deleted (database triggers). Secrets are never recorded: a scrubber drops any summary key that looks like a code, password, token or hash, and tests assert that rotated codes, passwords and backup codes appear nowhere in the log. Sign-ins, two-factor enrolment, password changes and sign-outs are logged; *failed* sign-ins are throttled but not individually recorded.

## How shared tasks behave

| | **Everyone (ALL)** | **Anyone (ANY)** |
| --- | --- | --- |
| Meaning | each assignee completes their own part | one assignee can complete the task for the group |
| Task status | derived from the parts: all To Do → To Do; any started or done → In Progress; all done → Done | In Progress while open; **Done as soon as one assignee marks done** (their name and time are recorded). Others' own statuses stay as they were. |
| Adding an assignee to a Done task | reopens it (their part isn't done) | stays Done |
| Reopening | a person reopens their own part | **explicit only**: nothing implicit reopens a group-completed task; an assignee (or admin) uses **Reopen**. Whoever had completed returns to In Progress. |
| Removing an assignee | status recomputed from who remains | stays Done if already completed |
| Last assignee | cannot be removed (a task always has someone), `422 LAST_ASSIGNEE` | same |

**Switching modes** on a task that already has progress needs confirmation (`409 MODE_CHANGE_NEEDS_CONFIRMATION` until `confirmModeChange: true`), is atomic, and is logged. The rules are deterministic:

- *Done, ALL → ANY:* stays Done; the completer is the person who finished most recently.
- *In progress, ALL → ANY:* becomes Done if anyone has finished their part (that completes it for the group), otherwise stays as it is.
- *Done, ANY → ALL:* recomputed from the parts: only people who explicitly marked themselves done count, so a task finished by one person among several becomes In Progress.
- *In progress, ANY → ALL:* recomputed from the parts.

The confirmation dialog states what will change before you agree. All the rules live in one pure module, [`shared/task-progress.ts`](shared/task-progress.ts), used by the server and the UI, with its own tests.

Only the assigned person changes their own progress; an administrator may change anyone's (with a reason). Concurrency uses **three separate version checks** so unrelated edits don't collide: the task's `version` (edits, reopen), each assignee's own `version` (their progress; teammates progressing at the same time never conflict), and the note's version. Any stale write is `409` (`TASK_CONFLICT`, `ASSIGNEE_CONFLICT`, `NOTE_CONFLICT`); in the UI a stale note edit keeps what you typed and offers **Refresh**.

## Notification readiness (nothing is sent)

V2 deliberately has **no** WhatsApp/Ziph integration, no credentials, no sends, no queue, no cron and no background workers. What it does preserve, so a later phase can build on it:

- `task_activity` records, with exact timestamps and IDs, every event a future notifier would care about: `created`, `updated` (with `details.changed` listing which fields changed, never their text, and `details.dueDate` `{from, to}` when a deadline moved), `assignee_added`, `assignee_removed`, `assignee_status_changed` (a person started or finished their part), `status_changed` (aggregate completed/reopened, with a `details.trigger` of `group_completion`, `all_completed`, `reopened`…), `mode_changed`, `note_edited`, `note_cleared`.
- Each row names the **actor**, the **subject member** (who was assigned/removed/progressed), the task and the project, in stable IDs, and a name snapshot for readability.
- Note edits are activity rows too, but nothing is meant to notify on every revision.
- Contact details and consent are **not** collected: no phone fields exist. A future send needs its own phase: phone collection and verification, consent and opt-out, delivery and error handling.

## Security model

Collabo uses a shared secret instead of accounts for teams, so that secret is handled carefully, and the admin side is kept entirely separate.

**Project access**
- **Codes** come from the OS CSPRNG: 12 characters from a 31-symbol alphabet with no look-alikes (≈59 bits).
- **Only a keyed hash is stored** (HMAC-SHA-256 under `ACCESS_CODE_PEPPER`), compared in constant time. The raw code is shown once (creation, regeneration, or admin rotation) and never persisted or logged.
- **Sessions** are HttpOnly, `SameSite=Strict` (`Secure` in production) cookies carrying a signed token for exactly one project plus its `session_version`. Regenerating or rotating the code bumps the version and kills every old session.
- **Project state is enforced on every request:** `suspended` → `423 PROJECT_SUSPENDED` even with a valid cookie; `deleted` → the session is invalid and the code looks wrong.
- **Isolation:** the project always comes from the verified session or the admin route, never the request body; every query filters on it, and composite foreign keys make the database refuse cross-project links. Tests cover every task, member, activity, note and admin route.
- **Rate limiting** in Postgres (works across serverless instances): wrong access codes (10 per 15 min per client), new Collabos, wrong admin passwords (per client **and** per account, so guessing spread over many IPs is still limited), and wrong authenticator codes (per client, plus the library's per-account lockout).

**Administrator access**
- A maintained library does the hard parts (password hashing, sessions, TOTP); Collabo adds no hand-written crypto. It runs in your own database, with telemetry off and IP-address storage off.
- Cookies: `collabo_admin.*`, HttpOnly, `SameSite=Strict`, `Secure` in production, 8-hour sessions, completely separate from the project cookie (neither opens the other's API).
- **Every admin endpoint** passes one guard, checked in a test that walks the whole route table: valid session → active account → personal password chosen → two-factor enrolled → then the handler. Identity comes from the session, never from anything the client sends.
- **CSRF:** on top of `SameSite=Strict`, every state-changing admin request must carry an `Origin` naming this host (a missing one is refused), a reported `Sec-Fetch-Site` must be same-origin, and bodies must be JSON.
- Only an allow-list of sign-in endpoints is reachable; everything else the library offers (sign-up, email/password reset, social login, two-factor *disable*, session listing, user updates) is not routed.
- Failed sign-ins look identical whether the email exists, is deactivated, or the password is wrong.

**Everything else:** validated input on every mutation (Zod), parameterised SQL via Drizzle, JSON-only bodies with a 128 KB cap, `Cache-Control: no-store` on every API response, a strict Content-Security-Policy and other headers in `vercel.json`, and logs that never include codes, hashes, names, query text or connection strings.

**Impersonation:** the "who are you" choice is trust between teammates, not security. Anyone with the code can act as anyone, and the app says so. If a code leaks: **Team → Collabo access → Regenerate Code** (or ask an administrator to rotate it).

## API

All responses are JSON. Errors always look like `{ "error": { "code": "TASK_CONFLICT", "message": "…" } }` (validation errors add per-field `details`). Project routes need the session cookie; routes that attribute a change also need the acting member in an `x-member-id` header.

**Project (members)**

| Route | Purpose |
| --- | --- |
| `POST /api/projects` · `POST /api/session` · `DELETE /api/session` · `GET /api/project` · `POST /api/project/regenerate-code` | Create / enter / leave / read / new code (as V1) |
| `GET` / `POST /api/members` | List (including removed) / add one (`name`) or many (`names`) |
| `PATCH /api/members/:id` | Rename |
| `POST /api/members/:id/deactivate` | Remove, with `reassignToMemberId` (a member, or `null` = just take them off). `409 MEMBER_HAS_OPEN_TASKS` lists what is at stake. |
| `POST /api/members/:id/reactivate` · `DELETE /api/members/:id` | Bring back / V1-style removal (refused while they hold open tasks) |
| `GET` / `POST /api/tasks` | List / create (`assigneeIds`, `assignmentMode`) |
| `GET` / `PATCH` / `DELETE /api/tasks/:id` | Read / edit (needs `expectedVersion`) / delete |
| `PUT /api/tasks/:id/assignees/:memberId/status` | One person's progress (needs `expectedAssigneeVersion`, optional `note`) |
| `POST /api/tasks/:id/reopen` | Explicitly reopen a group-completed task |
| `PUT` / `DELETE /api/tasks/:id/note`, `GET …/note/revisions` | Edit / clear / read the shared note and its history |
| `GET /api/tasks/:id/activity` | History |

**Admin** (all behind the guard above): `GET /api/admin/me`, `/overview`, `/projects`, `/projects/:id`, `/audit`, `/admins`; `PATCH /api/admin/projects/:id`; `POST …/suspend|reactivate|delete|restore|rotate-code`; `POST /api/admin/admins`, `…/:id/deactivate|reactivate`; and **every project route above again** under `/api/admin/projects/:projectId/…`. Sign-in lives at `POST /api/auth/sign-in/email`, `…/two-factor/verify-totp`, `…/two-factor/verify-backup-code`, `…/two-factor/enable`, `…/two-factor/generate-backup-codes`, `…/change-password` and `…/sign-out`.

**Breaking changes from V1 (the web app is updated to match):** `PATCH /api/tasks/:id` no longer accepts `status` (status follows the assignees; use the progress route); a task needs at least one assignee (V1's `assignedToMemberId` is still accepted as a one-person list); removing a member who holds open tasks needs a decision instead of silently orphaning them.

## Development commands

| Command | What it does |
| --- | --- |
| `npm run dev` | App + API with hot reload |
| `npm run build` | Type-check everything, then build (the admin area is a separate lazy chunk) |
| `npm run typecheck` | `tsc -b` across the browser, server and tooling projects |
| `npm run lint` | Oxlint |
| `npm test` | Run the test suite once |
| `npm run admin:create` | Create an administrator / reset their authenticator |
| `npm run db:v2:verify` | Read-only post-migration health report |

```
api/[...path].ts   the one Vercel Function (just hands requests to the router)
server/            everything it uses
  router.ts          route table, per-request database connection, error contract
  project-routes.ts  members + tasks, shared by members and admins
  admin/             sign-in (Better Auth), guard, admin API, audit log, accounts
  tasks/ members/ projects/   service.ts (database logic) + handlers.ts (HTTP)
  db/                schema, client, migrations, post-migration verify
  security/          access codes, sessions, rate limiting
shared/            Zod schemas, DTOs, error codes, and the pure task-progress rules
scripts/           operator commands (admin:create, db:v2:verify)
src/               the React app (features/admin is lazy-loaded)
```

## Tests

```bash
npm test
```

The server tests call the real exported handlers with real `Request`s and a cookie jar on an in-process Postgres (PGlite) built from the actual SQL migrations, so constraints, triggers and transactions behave as in production. They cover, among much else: every V1 rule; **ALL/ANY semantics and every mode-switch case**; per-assignee, task and note concurrency (409s, and simultaneous saves with one winner); note immutability and ordering; member rename/removal/bring-back with resolution; project isolation across all new endpoints and tables; **the V1 → V2 migration run on seeded V1 data** (every task, member and activity row survives; statuses and completion preserved; no invented assignees; V1-shaped writes still accepted); the post-migration health check catching deliberate corruption; admin sign-in, mandatory two-factor, forced password change, deactivation mid-session, throttling per client and per account, CSRF, forged cookies; **a route-table walk proving every admin endpoint refuses strangers, project members, half-set-up admins and accepts a complete admin**; suspension/deletion/recovery/rotation enforced against old cookies; audit completeness, atomicity (a failed request leaves no change and no audit row), append-only enforcement, and no secrets in the log.

The browser flows (multi-assignee creation, notes and a note conflict, ANY completion and reopen, mode-change confirmation, removal with hand-over, admin sign-in with real TOTP enrolment, override with reason, suspend/reactivate seen from a member's browser, code rotation, delete/recover, adding an administrator, phone and desktop layouts) were driven in Chromium against the running app and database during development; those scripts are not part of the repository.

## Deploy to Vercel

1. Push to GitHub and **import in Vercel**. `vercel.json` sets the build, output folder, the single-page-app rewrite (everything except `/api/*` serves `index.html`) and security headers.
2. **Settings → Environment Variables:** `DATABASE_URL`, `SESSION_SECRET`, `ACCESS_CODE_PEPPER` and (for the admin area) `ADMIN_AUTH_SECRET`, for Production (and Preview, ideally pointing at a Neon branch). Use freshly generated secrets.
3. **Run the migrations** against the production database ([steps above](#upgrading-an-existing-v1-deployment)). They are not part of the build.
4. **Create the first administrator** with `npm run admin:create`.
5. In **Settings → Functions**, set the region closest to your Neon region. Use Node.js 22+.

### Troubleshooting

- **`500 SERVER_ERROR` on every API call:** open the function logs. A configuration problem logs `Invalid server environment: …` naming the variables. A database problem logs only the error name and Postgres code.
- **`/admin` says administration isn't set up:** `ADMIN_AUTH_SECRET` is missing on that deployment.
- **Can't enter a code that should work:** check you ran `npm run db:migrate` on *that* database and that `ACCESS_CODE_PEPPER` matches the value the project was created with. `423` means an administrator suspended it.
- **Locked out after typos:** wait for the `Retry-After` period (≤ 15 minutes).
- **Admin 2FA stopped working after changing `ADMIN_AUTH_SECRET`:** reset with `npm run admin:create -- --reset-mfa --email …`.

## Known limitations

- **Not tested against real Neon or Vercel by the author of this change.** The sandbox it was built in could not reach either service. Everything was verified against real Postgres (PGlite), a real browser, and Vite's dev server, but the migration commands, the Neon WebSocket driver in the operator scripts, and Vercel's runtime have not been exercised here. Rehearse the upgrade on a Neon branch first.
- Tasks that were unassigned in V1 stay unassigned; nobody can progress them until someone assigns people (the verify script lists the count).
- Failed admin sign-ins are rate-limited but not individually audit-logged; sign-ins that succeed are.
- The authenticator and backup-code flow relies on the library's TOTP; there is no SMS/email fallback by design (no email provider is configured).
- Notifications, WhatsApp and phone numbers are intentionally absent (see above).
- Project-wide "plan" and "billing status" columns exist and are shown to administrators, but nothing enforces or bills against them.

## What is intentionally not here

Public sign-up, passwords for team members, OAuth, email, realtime sync or polling, comments, attachments, subtasks, recurring tasks, notifications, labels, per-project roles, custom statuses or priorities, integrations, analytics. Collabo is a task list; everything else supports the task list.
