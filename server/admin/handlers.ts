import { eq } from 'drizzle-orm'
import {
  adminAuditQuerySchema,
  adminProjectsQuerySchema,
  adminRenameProjectSchema,
  createAdminSchema,
  optionalReasonBodySchema,
  requiredReasonBodySchema,
  uuidSchema,
} from '../../shared/schemas.js'
import type { AdminProfileDto } from '../../shared/types.js'
import type { Access } from '../access.js'
import type { Actor } from '../actors.js'
import { projects } from '../db/schema.js'
import { ApiError } from '../errors.js'
import { json, parseQuery, readJson, type RequestContext } from '../http.js'
import {
  createAdminAccount,
  generateTemporaryPassword,
  listAdmins,
  setAdminActive,
} from './accounts-service.js'
import { listAudit, writeAudit, type AuditActor } from './audit.js'
import { adminHandler, isUnsafe } from './guard.js'
import {
  getOverview,
  getProjectSummary,
  listProjects,
  reactivateProject,
  renameProject,
  restoreProject,
  rotateProjectCode,
  softDeleteProject,
  suspendProject,
} from './projects-service.js'
import type { AdminSession } from './session.js'

export function auditActor(admin: AdminSession): AuditActor {
  return { adminId: admin.adminId, name: admin.name, email: admin.email }
}

/** An unknown or malformed project id is simply "not found". */
export function projectIdParam(ctx: RequestContext): string {
  const parsed = uuidSchema.safeParse(ctx.params.projectId)
  if (!parsed.success) throw new ApiError('PROJECT_NOT_FOUND')
  return parsed.data
}

/** What shared project handlers receive when an administrator, not a member, is acting. */
export function adminAccess(ctx: RequestContext, admin: AdminSession, projectId: string): Access {
  const actor: Actor = { type: 'admin', adminId: admin.adminId, name: admin.name, email: admin.email }
  return {
    projectId,
    viewer: 'admin',
    actor: async () => actor,
    audit: (entry) => writeAudit(ctx.db, auditActor(admin), { ...entry, projectId }),
  }
}

/**
 * Runs a shared project handler (tasks, members) as an administrator. Reads work on any
 * project, including a soft-deleted one (to inspect before recovering it); changes need a
 * live project. The surrounding transaction (see adminHandler) includes the audit row.
 */
export function asAdmin(
  route: (ctx: RequestContext, access: Access) => Promise<Response>,
) {
  return adminHandler(async (ctx, admin) => {
    const projectId = projectIdParam(ctx)
    const project = await ctx.db.query.projects.findFirst({
      where: eq(projects.id, projectId),
      columns: { status: true },
    })
    if (!project) throw new ApiError('PROJECT_NOT_FOUND')
    if (isUnsafe(ctx.request) && project.status === 'deleted') {
      throw new ApiError('PROJECT_STATE_INVALID', {
        message: 'This Collabo is deleted. Recover it before changing anything in it.',
      })
    }
    return route(ctx, adminAccess(ctx, admin, projectId))
  })
}

/* -------------------------------------------------------------------------- */

export const meHandler = adminHandler(
  async (_ctx, admin) => {
    const admin_: AdminProfileDto = {
      id: admin.adminId,
      name: admin.name,
      email: admin.email,
      twoFactorEnabled: admin.twoFactorEnabled,
      mustChangePassword: admin.mustChangePassword,
    }
    return json({ admin: admin_ })
  },
  { allowIncompleteSetup: true },
)

export const overviewHandler = adminHandler(async ({ db }) => json({ overview: await getOverview(db) }))

export const listProjectsHandler = adminHandler(async ({ db, request }) =>
  json(await listProjects(db, parseQuery(request, adminProjectsQuerySchema))),
)

export const getProjectHandler = adminHandler(async (ctx) =>
  json({ project: await getProjectSummary(ctx.db, projectIdParam(ctx)) }),
)

export const renameProjectHandler = adminHandler(async (ctx, admin) => {
  const projectId = projectIdParam(ctx)
  const input = await readJson(ctx.request, adminRenameProjectSchema)
  const { before } = await renameProject(ctx.db, projectId, input.name)
  await writeAudit(ctx.db, auditActor(admin), {
    action: 'project.rename',
    targetType: 'project',
    targetId: projectId,
    projectId,
    reason: input.reason,
    summary: { from: before, to: input.name },
  })
  return json({ project: await getProjectSummary(ctx.db, projectId) })
})

type Lifecycle = (ctx: RequestContext, admin: AdminSession, projectId: string, reason: string | undefined) => Promise<Record<string, unknown> | void>

function lifecycle(options: { reasonRequired: boolean; run: Lifecycle }) {
  return adminHandler(async (ctx, admin) => {
    const projectId = projectIdParam(ctx)
    const { reason } = await readJson(
      ctx.request,
      options.reasonRequired ? requiredReasonBodySchema : optionalReasonBodySchema,
    )
    const extra = await options.run(ctx, admin, projectId, reason)
    return json({ project: await getProjectSummary(ctx.db, projectId), ...(extra ?? {}) })
  })
}

function audited(ctx: RequestContext, admin: AdminSession, projectId: string, action: string, reason: string | undefined, summary?: Record<string, unknown>) {
  return writeAudit(ctx.db, auditActor(admin), {
    action,
    targetType: 'project',
    targetId: projectId,
    projectId,
    reason,
    summary: summary ?? null,
  })
}

export const suspendProjectHandler = lifecycle({
  reasonRequired: true,
  run: async (ctx, admin, projectId, reason) => {
    const { before } = await suspendProject(ctx.db, projectId)
    await audited(ctx, admin, projectId, 'project.suspend', reason, { from: before, to: 'suspended' })
  },
})

export const reactivateProjectHandler = lifecycle({
  reasonRequired: false,
  run: async (ctx, admin, projectId, reason) => {
    const { before } = await reactivateProject(ctx.db, projectId)
    await audited(ctx, admin, projectId, 'project.reactivate', reason, { from: before, to: 'active' })
  },
})

export const deleteProjectHandler = lifecycle({
  reasonRequired: true,
  run: async (ctx, admin, projectId, reason) => {
    const { before } = await softDeleteProject(ctx.db, projectId)
    await audited(ctx, admin, projectId, 'project.delete', reason, { from: before, to: 'deleted', soft: true })
  },
})

export const restoreProjectHandler = lifecycle({
  reasonRequired: false,
  run: async (ctx, admin, projectId, reason) => {
    const { after } = await restoreProject(ctx.db, projectId)
    await audited(ctx, admin, projectId, 'project.restore', reason, { from: 'deleted', to: after })
  },
})

/** The new code is in this response and nowhere else: it is not stored, logged or audited in readable form. */
export const rotateCodeHandler = lifecycle({
  reasonRequired: true,
  run: async (ctx, admin, projectId, reason) => {
    const { accessCode } = await rotateProjectCode(ctx.db, projectId)
    await audited(ctx, admin, projectId, 'project.rotate_code', reason, {
      oldCodeInvalidated: true,
      sessionsInvalidated: true,
    })
    return { accessCode }
  },
})

/* -------------------------------------------------------------------------- */

export const auditLogHandler = adminHandler(async ({ db, request }) =>
  json(await listAudit(db, parseQuery(request, adminAuditQuerySchema))),
)

export const projectAuditHandler = adminHandler(async (ctx) => {
  const projectId = projectIdParam(ctx)
  const query = parseQuery(ctx.request, adminAuditQuerySchema)
  return json(await listAudit(ctx.db, { ...query, projectId }))
})

/* -------------------------------------------------------------------------- */

export const listAdminsHandler = adminHandler(async ({ db }) => json({ admins: await listAdmins(db) }))

/** Creates an administrator with a one-time password, shown once and required to be replaced at first sign-in. */
export const createAdminHandler = adminHandler(async (ctx, admin) => {
  const input = await readJson(ctx.request, createAdminSchema)
  const temporaryPassword = generateTemporaryPassword()
  const created = await createAdminAccount(ctx.db, {
    name: input.name,
    email: input.email,
    password: temporaryPassword,
    mustChangePassword: true,
    createdByAdminId: admin.adminId,
  })
  await writeAudit(ctx.db, auditActor(admin), {
    action: 'admin.create',
    targetType: 'admin',
    targetId: created.id,
    summary: { name: created.name, email: created.email },
  })
  return json({ admin: created, temporaryPassword }, { status: 201 })
})

function setActive(active: boolean) {
  return adminHandler(async (ctx, admin) => {
    const targetId = ctx.params.id
    if (!targetId || targetId.length > 64) throw new ApiError('NOT_FOUND')
    const { reason } = await readJson(ctx.request, optionalReasonBodySchema)
    const updated = await setAdminActive(ctx.db, admin.adminId, targetId, active)
    await writeAudit(ctx.db, auditActor(admin), {
      action: active ? 'admin.reactivate' : 'admin.deactivate',
      targetType: 'admin',
      targetId,
      reason,
      summary: { email: updated.email },
    })
    return json({ admin: updated })
  })
}

export const deactivateAdminHandler = setActive(false)
export const reactivateAdminHandler = setActive(true)
