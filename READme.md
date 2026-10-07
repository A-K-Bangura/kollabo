# Collabo

**Simple tasks. Together.**

Collabo (short for *Collaboration*) gives a small team one shared place to see what needs doing, who is on it, and what is finished. Open it, see the work, update the work, leave.

It is deliberately small: a task list, a Today view, a month calendar and a team page. No accounts, no boards, no chat, no notifications.

- **No accounts.** A team shares a project access code (like `K7QM-2XPA-9WTH`). Whoever has the code is trusted with that one Collabo.
- **Who are you?** After entering the code you pick your name. That only labels what you change; it is *not* a login.
- **Manual refresh, on purpose.** There is no live sync or polling. Press **Refresh tasks** to see teammates' changes. Stale edits are detected and rejected (HTTP 409) instead of overwriting anyone.

## How it fits together

```
Browser (React + Vite + TS + Tailwind v4)
   │  fetch /api/*   (HttpOnly session cookie)
   ▼
Vercel Functions  (api/*.ts → server/*)
   │  Drizzle ORM
   ▼
Neon serverless Postgres
```

One Vercel project serves the static app and the API. There is no separate backend, and the database URL never reaches the browser.

| Concern | Choice |
| --- | --- |
| UI | React 19, React Router, TanStack Query, React Hook Form, Zod, Tailwind CSS v4, Lucide, Sonner, date-fns |
| API | Vercel Functions (Web-standard `export const GET/POST/…` handlers) |
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
cp .env.example .env      # then fill in the three values (see below)
npm run db:migrate        # create the tables in your Neon database
npm run dev               # http://localhost:5173
```

`npm run dev` serves both the app **and** the `/api` functions from Vite, mirroring Vercel's file-system routing, so you do not need the Vercel CLI to develop. (`vercel dev` also works if you prefer it.)

### Set up Neon

1. Create a Neon project. For day-to-day development create a separate **branch** (for example `dev`) so you never experiment on production data.
2. In the Neon console choose **Connect** and copy the connection string. Pooled (`-pooler`) or direct both work.
3. Put it in `.env` as `DATABASE_URL`.

### Environment variables

Copy `.env.example` to `.env` (git-ignored). Real values are never committed.

| Variable | Required | What it is |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon Postgres connection string. Server-side only. |
| `SESSION_SECRET` | yes | 32+ random characters. Signs the session cookie. |
| `ACCESS_CODE_PEPPER` | yes | 32+ random characters, different from `SESSION_SECRET`. Keys the hash of access codes. **Treat it as permanent:** changing it invalidates every existing access code. |

Generate the two secrets with:

```bash
openssl rand -base64 48
```

None of them use the `VITE_` prefix, which would bundle them into the browser. The server validates all three at first use and, if any is missing or weak, answers `500` with a generic message and logs only the *names* of the offending variables.

## Database and migrations

Schema lives in [`server/db/schema.ts`](server/db/schema.ts); generated SQL lives in [`server/db/migrations`](server/db/migrations) and **is committed**. Production schema changes only ever happen by running migrations; nothing mutates the schema automatically (no `push`, nothing in the build).

| Command | What it does |
| --- | --- |
| `npm run db:generate` | Turn schema changes into a new SQL migration (works offline) |
| `npm run db:migrate` | Apply pending migrations to the database in `DATABASE_URL` |
| `npm run db:studio` | Browse the database in Drizzle Studio |

To change the schema: edit `schema.ts`, run `npm run db:generate`, review the SQL, commit it, then run `npm run db:migrate` against each environment.

Notable design points:

- Every project-owned row carries `project_id`, and **composite foreign keys** `(member_id, project_id)` / `(task_id, project_id)` make the database itself refuse a task, assignee or activity row that points at another project's data, even if application code had a bug.
- `members` are never hard-deleted: removing someone sets `is_active = false`, so tasks and activity keep their attribution.
- `tasks.due_date` is a Postgres `date` (a calendar day, no timezone), so "October 10" can never become "October 9". Created/updated/completed times are `timestamptz`.
- `tasks.version` increments on every change and drives conflict detection.

## Development commands

| Command | What it does |
| --- | --- |
| `npm run dev` | App + API with hot reload |
| `npm run build` | Type-check everything, then build for production |
| `npm run preview` | Serve the production build (static only; no API) |
| `npm run typecheck` | `tsc -b` across the browser, server and tooling projects |
| `npm run lint` | Oxlint |
| `npm test` | Run the test suite once (`npm run test:watch` to watch) |

### Project layout

```
api/        Vercel Functions: one tiny file per route (just wires handlers up)
server/     Everything the functions use
  db/         schema, client, generated migrations
  security/   access codes, session cookies, rate limiting
  projects/ members/ tasks/   service.ts (database logic) + handlers.ts (HTTP)
  http.ts     route wrapper, JSON helpers, error contract, CSRF origin check
  auth.ts     session → project scope; acting-member check
shared/     Zod schemas, DTO types, error codes: imported by browser *and* server
src/        The React app
  features/   session, landing, projects, tasks, today, calendar, team
  components/ ui kit and layout
  lib/        api client, query client, dates
```

## Security model

Collabo uses a shared secret instead of accounts, so that one secret is handled carefully:

- **Codes** are generated with the OS CSPRNG, 12 characters from a 31-symbol alphabet with no look-alikes (≈59 bits). Casual guessing is not realistic.
- **Only a keyed hash is stored** (HMAC-SHA-256 under `ACCESS_CODE_PEPPER`). A database leak reveals nothing usable. The comparison is constant-time.
- **The raw code is shown once**, right after creation or regeneration, and held in browser memory only (never in storage). Afterwards the Team screen shows a masked code, and the way to "get a code back" is **Regenerate**. The code is never stored in plain text just to make a Copy button work.
- **Sessions:** entering a code returns an HttpOnly, `SameSite=Strict` cookie (`Secure` in production) holding a signed token for exactly **one project** plus that project's `session_version`. The code is never sent again, and never appears in a URL.
- **Regenerating the code** replaces the hash and bumps `session_version`, which kills every existing session (including copies of old cookies). Everyone else is sent back to enter the new code; the person who regenerated stays in so they can copy it.
- **Isolation:** the project scope always comes from the verified session, never from the client. Every query filters on it (`task.id = ? AND task.project_id = session.projectId`), and the composite foreign keys back that up.
- **Rate limiting:** wrong-code guesses are counted per client (a keyed hash of the IP, in Postgres, so it works across serverless instances): 10 per 15 minutes, then `429`. New-Collabo creation is limited too. On Vercel the client IP comes from the platform-set `x-real-ip` / `x-forwarded-for`; in local development every request shares one bucket.
- **Other protections:** validated input on every mutation (Zod), parameterised SQL via Drizzle, JSON-only bodies with a size cap, an `Origin` check on writes (CSRF defence in depth), `Cache-Control: no-store` on every API response, a strict Content-Security-Policy and other headers in `vercel.json`, and logs that never include codes, hashes, names, query text or connection strings.
- **Impersonation:** the "who are you" choice is trust between teammates, not security. Anyone with the code can act as anyone. That is the intended trade-off.

If a code leaks: **Team → Collabo access → Regenerate Code**.

## Manual refresh and conflicts

TanStack Query is configured so nothing refetches by itself (no polling, no refetch on focus or reconnect). Your own changes update your screen immediately; **Refresh tasks** fetches everyone else's. The bar shows *Last refreshed …*, and updating a single row does not pretend a refresh happened.

Every task has a `version`. An edit sends the version it loaded, and the server only writes if it still matches:

- a stale save returns `409 TASK_CONFLICT` and writes nothing,
- the editor shows *"This task has changed since you last refreshed. Refresh it before editing."* with a Refresh button that reloads the task so the edit can be redone on current data.

## API

All responses are JSON. Errors always look like `{ "error": { "code": "TASK_CONFLICT", "message": "…" } }` (validation errors add per-field `details`). Project routes need the session cookie. Routes that attribute a change (`POST /api/tasks`, `PATCH /api/tasks/:id`) also need the acting member in an `x-member-id` header.

| Route | Purpose |
| --- | --- |
| `POST /api/projects` | Create a Collabo; returns the code once and signs the creator in |
| `POST /api/session` | Exchange an access code for a project session |
| `DELETE /api/session` | Leave the Collabo (clears the cookie) |
| `GET /api/project` | The current Collabo |
| `POST /api/project/regenerate-code` | New code; old code and old sessions die |
| `GET` / `POST /api/members` | List (including removed) / add a member |
| `DELETE /api/members/:id` | Soft-remove a member (never the last active one) |
| `GET` / `POST /api/tasks` | List / create tasks |
| `GET` / `PATCH` / `DELETE /api/tasks/:id` | Read / edit (needs `expectedVersion`) / delete |
| `GET /api/tasks/:id/activity` | History: created, updated, status changes |

Error codes: `INVALID_CODE`, `RATE_LIMITED`, `UNAUTHENTICATED`, `SESSION_INVALID`, `FORBIDDEN_ORIGIN`, `PROJECT_NOT_FOUND`, `MEMBER_REQUIRED`, `MEMBER_NOT_FOUND`, `MEMBER_EXISTS`, `LAST_MEMBER`, `TASK_NOT_FOUND`, `TASK_CONFLICT`, `VALIDATION_ERROR`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `SERVER_ERROR`.

## Tests

```bash
npm test
```

The server tests call the real exported route handlers (`api/*.ts`) with real `Request`s and a cookie jar, on an in-process Postgres (PGlite) built from the actual SQL migrations, so constraints, composite keys and transactions behave as in production. They cover:

- access codes: format, entropy, hashing, normalisation, wrong/malformed codes, rate limiting
- sessions: signing, tampering, expiry, cookie flags, scoping to one project
- **project isolation:** reading, editing, deleting, assigning and impersonating across projects, plus the database-level foreign-key guarantees
- tasks: creation, validation, attribution, status transitions and completion fields, activity log
- **concurrency:** stale edits get 409 and never overwrite; simultaneous saves have exactly one winner
- **code regeneration** invalidating old codes and sessions
- members: duplicate handling, soft removal keeping history, last-member guard
- request safety: CSRF origin check, content-type and size limits, uniform error body, no leakage in logs
- the browser-side logic for Today grouping, filters, sorting, status steps and date handling (including daylight-saving boundaries)

## Deploy to Vercel

1. Push the repository to GitHub and **import it in Vercel**. The framework preset is detected as Vite; `vercel.json` already sets the build, output folder, the single-page-app rewrite (everything except `/api/*` serves `index.html`) and security headers.
2. In **Settings → Environment Variables** add `DATABASE_URL`, `SESSION_SECRET` and `ACCESS_CODE_PEPPER` for Production (and Preview if you use it, ideally pointing at a Neon branch). Use freshly generated secrets, not your development ones.
3. **Run the migrations against the production database** before (or right after) the first deploy. They are deliberately not part of the build:
   ```bash
   DATABASE_URL="<production connection string>" npm run db:migrate
   ```
4. Deploy. In **Settings → Functions**, set the function region to the one closest to your Neon region to keep queries fast.

The cookie is `Secure` in production automatically. Use Node.js 22+ in the project settings.

### Troubleshooting

- **`500 SERVER_ERROR` on every API call:** open the function logs. A configuration problem logs `Invalid server environment: …` naming the variables to fix. A database problem logs only the error name and Postgres code.
- **Can't enter a code that should work:** check you ran `npm run db:migrate` on *that* database, and that `ACCESS_CODE_PEPPER` is the same value the project was created with.
- **Locked out after typos:** wait for the `Retry-After` period (≤ 15 minutes).

## What is intentionally not here

Accounts, passwords, OAuth, email, realtime sync or polling, comments, attachments, subtasks, recurring tasks, notifications, labels, roles and permissions, custom statuses or priorities, integrations, analytics. Collabo is a task list; everything else supports the task list.
