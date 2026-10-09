import { eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { CreateProjectResponse, ProjectDto } from '../../shared/types.js'
import type { createProjectSchema } from '../../shared/schemas.js'
import type { Database } from '../db/client.js'
import { members, projects } from '../db/schema.js'
import { ApiError, pgErrorCode, UNIQUE_VIOLATION } from '../errors.js'
import { toMemberDto } from '../members/service.js'
import { digestsMatch, generateAccessCode, hashAccessCode } from '../security/codes.js'

export function toProjectDto(project: { id: string; name: string; createdAt: Date }): ProjectDto {
  return { id: project.id, name: project.name, createdAt: project.createdAt.toISOString() }
}

/** Names that differ only by case or spacing are the same person. First spelling wins. */
function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>()
  return names.filter((name) => {
    const key = name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const CODE_ATTEMPTS = 3

export interface CreatedProject extends CreateProjectResponse {
  sessionVersion: number
}

export async function createProject(
  db: Database,
  input: z.output<typeof createProjectSchema>,
): Promise<CreatedProject> {
  const names = uniqueNames([input.creatorName, ...input.memberNames])

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const accessCode = generateAccessCode()
    try {
      return await db.transaction(async (tx) => {
        const [project] = await tx
          .insert(projects)
          .values({ name: input.name, accessCodeHash: hashAccessCode(accessCode) })
          .returning()
        if (!project) throw new Error('Project insert returned no row')

        // now() is identical for every row of one transaction, so stamp each
        // member 1ms apart to keep the order the names were entered in.
        const firstStamp = Date.now()
        const rows = await tx
          .insert(members)
          .values(
            names.map((name, index) => ({
              projectId: project.id,
              name,
              createdAt: new Date(firstStamp + index),
            })),
          )
          .returning()
        const ordered = names.flatMap((name) => rows.filter((row) => row.name === name))
        const creator = ordered[0]
        if (!creator) throw new Error('Creator insert returned no row')

        return {
          project: toProjectDto(project),
          members: ordered.map(toMemberDto),
          creatorMemberId: creator.id,
          accessCode,
          sessionVersion: project.sessionVersion,
        }
      })
    } catch (error) {
      // A hash collision on a random 59-bit code is vanishingly unlikely; just draw again.
      if (pgErrorCode(error) === UNIQUE_VIOLATION && attempt < CODE_ATTEMPTS - 1) continue
      throw error
    }
  }
  throw new Error('Unreachable: access code allocation loop exited')
}

/** Resolves a canonical access code to its project, or null when nothing matches. */
export async function findProjectByCode(db: Database, code: string) {
  const hash = hashAccessCode(code)
  const project = await db.query.projects.findFirst({ where: eq(projects.accessCodeHash, hash) })
  return project && digestsMatch(project.accessCodeHash, hash) ? project : null
}

/**
 * Replaces the access code and bumps the session version, which invalidates
 * every session cookie issued before this moment (including the old code's).
 */
export async function regenerateAccessCode(
  db: Database,
  projectId: string,
): Promise<{ accessCode: string; sessionVersion: number }> {
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const accessCode = generateAccessCode()
    try {
      const [row] = await db
        .update(projects)
        .set({
          accessCodeHash: hashAccessCode(accessCode),
          sessionVersion: sql`${projects.sessionVersion} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(projects.id, projectId))
        .returning({ sessionVersion: projects.sessionVersion })
      if (!row) throw new ApiError('PROJECT_NOT_FOUND')
      return { accessCode, sessionVersion: row.sessionVersion }
    } catch (error) {
      if (pgErrorCode(error) === UNIQUE_VIOLATION && attempt < CODE_ATTEMPTS - 1) continue
      throw error
    }
  }
  throw new Error('Unreachable: access code allocation loop exited')
}
