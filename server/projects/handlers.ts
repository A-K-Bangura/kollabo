import { createProjectSchema, createSessionSchema } from '../../shared/schemas.js'
import type { CreateProjectResponse } from '../../shared/types.js'
import { withProject } from '../auth.js'
import { ApiError } from '../errors.js'
import { json, noContent, readJson, type Handler } from '../http.js'
import {
  ACCESS_CODE_POLICY,
  assertWithinLimit,
  CREATE_PROJECT_POLICY,
  consumeAttempt,
  recordAttempt,
} from '../security/rate-limit.js'
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  createSessionToken,
} from '../security/session.js'
import { createProject, findProjectByCode, regenerateAccessCode, toProjectDto } from './service.js'

/** POST /api/projects: create a Collabo and sign its creator in. */
export const createProjectHandler: Handler = async ({ request, db }) => {
  const input = await readJson(request, createProjectSchema)
  await consumeAttempt(db, CREATE_PROJECT_POLICY, request)

  const { sessionVersion, ...created } = await createProject(db, input)
  const token = createSessionToken({ projectId: created.project.id, version: sessionVersion })
  const body: CreateProjectResponse = created
  return json(body, { status: 201, cookies: [buildSessionCookie(token, request)] })
}

/** POST /api/session: exchange an access code for a session scoped to one project. */
export const createSessionHandler: Handler = async ({ request, db }) => {
  const { code } = await readJson(request, createSessionSchema)
  await assertWithinLimit(db, ACCESS_CODE_POLICY, request)

  const project = await findProjectByCode(db, code)
  if (!project) {
    await recordAttempt(db, ACCESS_CODE_POLICY, request)
    throw new ApiError('INVALID_CODE')
  }

  const token = createSessionToken({ projectId: project.id, version: project.sessionVersion })
  return json({ project: toProjectDto(project) }, { cookies: [buildSessionCookie(token, request)] })
}

/** DELETE /api/session: leave the Collabo (always succeeds, even without a session). */
export const deleteSessionHandler: Handler = async ({ request }) =>
  noContent({ cookies: [buildClearedSessionCookie(request)] })

/** GET /api/project: the Collabo this session belongs to. */
export const getProjectHandler = withProject(async (_ctx, session) =>
  json({
    project: toProjectDto({
      id: session.projectId,
      name: session.projectName,
      createdAt: session.projectCreatedAt,
    }),
  }),
)

/**
 * POST /api/project/regenerate-code: new code, old code dead, every older session
 * invalid. The caller's own cookie is re-issued so they can copy the new code
 * without being signed out of the screen they are looking at.
 */
export const regenerateCodeHandler = withProject(async ({ request, db }, session) => {
  const { accessCode, sessionVersion } = await regenerateAccessCode(db, session.projectId)
  const token = createSessionToken({ projectId: session.projectId, version: sessionVersion })
  return json({ accessCode }, { cookies: [buildSessionCookie(token, request)] })
})
