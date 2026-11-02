import { and, asc, desc, eq, gte, ilike, ne, or, sql, type SQL } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'
import type { z } from 'zod'
import type { ProjectStatus } from '../../shared/constants.js'
import type { adminProjectsQuerySchema } from '../../shared/schemas.js'
import { uuidSchema } from '../../shared/schemas.js'
import type { AdminOverviewDto, AdminProjectSummaryDto, Paged } from '../../shared/types.js'
import type { Database } from '../db/client.js'
import { members, projects, taskActivity, tasks } from '../db/schema.js'
import { ApiError } from '../errors.js'
import { regenerateAccessCode } from '../projects/service.js'

/** Treats `%`, `_` and `\` in a search term as plain characters. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

// Correlated counts. Each is an index-backed lookup on (project_id, ...), evaluated only for
// the (at most one hundred) rows of the page being returned. The outer table is named in full:
// Drizzle leaves a single-table column unqualified, and an unqualified `id` inside a subquery
// would silently bind to the subquery's own table.
const outerId = sql.raw('"projects"."id"')
const outerUpdatedAt = sql.raw('"projects"."updated_at"')
const activeMembers = sql<number>`(select count(*)::int from members m where m.project_id = ${outerId} and m.is_active)`
const taskCount = sql<number>`(select count(*)::int from tasks t where t.project_id = ${outerId})`
const openTaskCount = sql<number>`(select count(*)::int from tasks t where t.project_id = ${outerId} and t.status <> 'completed')`
const lastActivity = sql<Date>`greatest(${outerUpdatedAt}, coalesce((select max(a.created_at) from task_activity a where a.project_id = ${outerId}), ${outerUpdatedAt}), coalesce((select max(t.updated_at) from tasks t where t.project_id = ${outerId}), ${outerUpdatedAt}))`

const summaryColumns = {
  id: projects.id,
  name: projects.name,
  status: projects.status,
  planKey: projects.planKey,
  billingStatus: projects.billingStatus,
  createdAt: projects.createdAt,
  suspendedAt: projects.suspendedAt,
  deletedAt: projects.deletedAt,
  lastActivityAt: lastActivity,
  activeMembers,
  tasks: taskCount,
  openTasks: openTaskCount,
}

function toSummary(row: {
  id: string
  name: string
  status: ProjectStatus
  planKey: string
  billingStatus: string | null
  createdAt: Date
  suspendedAt: Date | null
  deletedAt: Date | null
  lastActivityAt: Date | string
  activeMembers: number
  tasks: number
  openTasks: number
}): AdminProjectSummaryDto {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    planKey: row.planKey,
    billingStatus: row.billingStatus,
    createdAt: row.createdAt.toISOString(),
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    lastActivityAt: new Date(row.lastActivityAt).toISOString(),
    activeMembers: row.activeMembers,
    tasks: row.tasks,
    openTasks: row.openTasks,
  }
}

/** Searchable, filterable, paginated directory of every project, newest activity first by default. */
export async function listProjects(
  db: Database,
  query: z.output<typeof adminProjectsQuerySchema>,
): Promise<Paged<AdminProjectSummaryDto>> {
  const conditions: (SQL | undefined)[] = []
  if (query.status !== 'all') conditions.push(eq(projects.status, query.status))

  const term = query.search?.trim()
  if (term) {
    const pattern = likePattern(term)
    const matches: (SQL | undefined)[] = [
      ilike(projects.name, pattern),
      sql`exists (select 1 from members m where m.project_id = ${outerId} and m.name ilike ${pattern})`,
    ]
    // Paste a project id (or its first characters) to jump straight to it.
    if (/^[0-9a-f-]{6,36}$/i.test(term)) matches.push(sql`${projects.id}::text ilike ${`${term}%`}`)
    conditions.push(or(...matches))
  }
  const where = and(...conditions)

  const order =
    query.sort === 'name'
      ? [asc(sql`lower(${projects.name})`), asc(projects.id)]
      : query.sort === 'created'
        ? [desc(projects.createdAt), desc(projects.id)]
        : query.sort === 'size'
          ? [desc(activeMembers), desc(projects.createdAt)]
          : [desc(lastActivity), desc(projects.id)]

  const rows = await db
    .select(summaryColumns)
    .from(projects)
    .where(where)
    .orderBy(...order)
    .limit(query.limit + 1)
    .offset((query.page - 1) * query.limit)
  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(projects)
    .where(where)

  return {
    items: rows.slice(0, query.limit).map(toSummary),
    page: query.page,
    pageSize: query.limit,
    total: totalRow?.total ?? 0,
    hasMore: rows.length > query.limit,
  }
}

export async function getProjectSummary(db: Database, projectId: string): Promise<AdminProjectSummaryDto> {
  if (!uuidSchema.safeParse(projectId).success) throw new ApiError('PROJECT_NOT_FOUND')
  const [row] = await db.select(summaryColumns).from(projects).where(eq(projects.id, projectId))
  if (!row) throw new ApiError('PROJECT_NOT_FOUND')
  return toSummary(row)
}

/** Platform-wide counts for the dashboard. Deleted projects are counted as such and otherwise ignored. */
export async function getOverview(db: Database): Promise<AdminOverviewDto> {
  const [projectCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`(count(*) filter (where ${projects.status} = 'active'))::int`,
      suspended: sql<number>`(count(*) filter (where ${projects.status} = 'suspended'))::int`,
      deleted: sql<number>`(count(*) filter (where ${projects.status} = 'deleted'))::int`,
    })
    .from(projects)

  const [memberCounts] = await db
    .select({ active: sql<number>`count(*)::int` })
    .from(members)
    .innerJoin(projects, eq(projects.id, members.projectId))
    .where(and(eq(members.isActive, true), ne(projects.status, 'deleted')))

  const sevenDaysAgo = sql`now() - interval '7 days'`
  const [taskCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      todo: sql<number>`(count(*) filter (where ${tasks.status} = 'todo'))::int`,
      inProgress: sql<number>`(count(*) filter (where ${tasks.status} = 'in_progress'))::int`,
      completed: sql<number>`(count(*) filter (where ${tasks.status} = 'completed'))::int`,
      created: sql<number>`(count(*) filter (where ${tasks.createdAt} >= ${sevenDaysAgo}))::int`,
      completedRecently: sql<number>`(count(*) filter (where ${tasks.completedAt} >= ${sevenDaysAgo}))::int`,
      needingAssignee: sql<number>`(count(*) filter (where ${tasks.status} <> 'completed' and not exists (select 1 from task_assignees a where a.task_id = ${tasks.id} and a.removed_at is null)))::int`,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(ne(projects.status, 'deleted'))

  const [eventCounts] = await db
    .select({
      events: sql<number>`count(*)::int`,
      projectsActive: sql<number>`count(distinct ${taskActivity.projectId})::int`,
    })
    .from(taskActivity)
    .innerJoin(projects, eq(projects.id, taskActivity.projectId))
    .where(and(gte(taskActivity.createdAt, sql`${sevenDaysAgo}`), ne(projects.status, 'deleted')))

  return {
    projects: {
      total: projectCounts?.total ?? 0,
      active: projectCounts?.active ?? 0,
      suspended: projectCounts?.suspended ?? 0,
      deleted: projectCounts?.deleted ?? 0,
    },
    members: { active: memberCounts?.active ?? 0 },
    tasks: {
      total: taskCounts?.total ?? 0,
      todo: taskCounts?.todo ?? 0,
      inProgress: taskCounts?.inProgress ?? 0,
      completed: taskCounts?.completed ?? 0,
    },
    activity: {
      tasksCreated: taskCounts?.created ?? 0,
      tasksCompleted: taskCounts?.completedRecently ?? 0,
      projectsActive: eventCounts?.projectsActive ?? 0,
      events: eventCounts?.events ?? 0,
    },
    tasksNeedingAssignee: taskCounts?.needingAssignee ?? 0,
  }
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Moves a project between states in one conditional UPDATE, so two admins acting at the
 * same moment cannot both "win": the second finds the project no longer in the state it
 * expected and gets a clear 409 instead of overwriting.
 */
async function transition(
  db: Database,
  projectId: string,
  from: readonly ProjectStatus[],
  set: PgUpdateSetSource<typeof projects>,
): Promise<{ before: ProjectStatus }> {
  const current = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { status: true },
  })
  if (!current) throw new ApiError('PROJECT_NOT_FOUND')
  if (!from.includes(current.status)) throw new ApiError('PROJECT_STATE_INVALID', { details: { status: current.status } })

  const updated = await db
    .update(projects)
    .set({ ...set, updatedAt: sql`now()` })
    .where(and(eq(projects.id, projectId), eq(projects.status, current.status)))
    .returning({ id: projects.id })
  if (updated.length === 0) throw new ApiError('PROJECT_STATE_INVALID')
  return { before: current.status }
}

export async function suspendProject(db: Database, projectId: string) {
  return transition(db, projectId, ['active'], { status: 'suspended', suspendedAt: sql`now()` })
}

export async function reactivateProject(db: Database, projectId: string) {
  return transition(db, projectId, ['suspended'], { status: 'active', suspendedAt: null })
}

/** Soft delete: nothing is removed, the project simply stops existing for ordinary access. */
export async function softDeleteProject(db: Database, projectId: string) {
  return transition(db, projectId, ['active', 'suspended'], { status: 'deleted', deletedAt: sql`now()` })
}

/** Recovery returns the project to the state it was in before deletion (suspended stays suspended). */
export async function restoreProject(db: Database, projectId: string) {
  const current = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { suspendedAt: true },
  })
  if (!current) throw new ApiError('PROJECT_NOT_FOUND')
  const status: ProjectStatus = current.suspendedAt ? 'suspended' : 'active'
  const result = await transition(db, projectId, ['deleted'], { status, deletedAt: null })
  return { ...result, after: status }
}

export async function renameProject(db: Database, projectId: string, name: string) {
  const current = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { name: true, status: true },
  })
  if (!current) throw new ApiError('PROJECT_NOT_FOUND')
  if (current.status === 'deleted') throw new ApiError('PROJECT_STATE_INVALID')
  await db.update(projects).set({ name, updatedAt: sql`now()` }).where(eq(projects.id, projectId))
  return { before: current.name }
}

/**
 * Issues a new access code. The old code stops working immediately and every session
 * issued before this moment is invalid (the project's session version moves on).
 * The code is returned to the caller once and is never stored or logged in readable form.
 */
export async function rotateProjectCode(db: Database, projectId: string) {
  const current = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { status: true },
  })
  if (!current) throw new ApiError('PROJECT_NOT_FOUND')
  if (current.status === 'deleted') throw new ApiError('PROJECT_STATE_INVALID')
  return regenerateAccessCode(db, projectId)
}
