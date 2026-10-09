import { and, asc, eq, sql } from 'drizzle-orm'
import type { MemberDto } from '../../shared/types.js'
import type { Database } from '../db/client.js'
import { members } from '../db/schema.js'
import { ApiError, pgErrorCode, UNIQUE_VIOLATION } from '../errors.js'

export function toMemberDto(member: typeof members.$inferSelect): MemberDto {
  return {
    id: member.id,
    name: member.name,
    isActive: member.isActive,
    createdAt: member.createdAt.toISOString(),
  }
}

/** Every member, including removed ones, so old tasks and activity still resolve a name. */
export async function listMembers(db: Database, projectId: string): Promise<MemberDto[]> {
  const rows = await db.query.members.findMany({
    where: eq(members.projectId, projectId),
    orderBy: [asc(members.createdAt), asc(members.id)],
  })
  return rows.map(toMemberDto)
}

/** Adds a member, or brings back a previously removed one with the same name. */
export async function addMember(db: Database, projectId: string, name: string): Promise<MemberDto> {
  const existing = await db.query.members.findFirst({
    where: and(eq(members.projectId, projectId), sql`lower(${members.name}) = lower(${name})`),
  })
  if (existing?.isActive) throw new ApiError('MEMBER_EXISTS')

  if (existing) {
    const [revived] = await db
      .update(members)
      .set({ isActive: true })
      .where(and(eq(members.id, existing.id), eq(members.projectId, projectId)))
      .returning()
    if (!revived) throw new ApiError('MEMBER_NOT_FOUND')
    return toMemberDto(revived)
  }

  try {
    const [created] = await db.insert(members).values({ projectId, name }).returning()
    if (!created) throw new Error('Member insert returned no row')
    return toMemberDto(created)
  } catch (error) {
    // Two people adding the same name at once: the unique index decides.
    if (pgErrorCode(error) === UNIQUE_VIOLATION) throw new ApiError('MEMBER_EXISTS')
    throw error
  }
}

/**
 * Soft removal: the row stays so attribution never breaks. The last active
 * member cannot be removed, otherwise nobody could be "acting" in the Collabo.
 */
export async function removeMember(
  db: Database,
  projectId: string,
  memberId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Locking the active set makes two simultaneous removals take turns.
    const active = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.projectId, projectId), eq(members.isActive, true)))
      .for('update')

    const target = await tx.query.members.findFirst({
      where: and(eq(members.id, memberId), eq(members.projectId, projectId)),
    })
    if (!target) throw new ApiError('MEMBER_NOT_FOUND')
    if (!target.isActive) return
    if (active.length <= 1) throw new ApiError('LAST_MEMBER')

    await tx
      .update(members)
      .set({ isActive: false })
      .where(and(eq(members.id, memberId), eq(members.projectId, projectId)))
  })
}

/** Throws unless the member is an active member of this project. */
export async function assertActiveMember(
  db: Database,
  projectId: string,
  memberId: string,
): Promise<void> {
  const member = await db.query.members.findFirst({
    where: and(
      eq(members.id, memberId),
      eq(members.projectId, projectId),
      eq(members.isActive, true),
    ),
    columns: { id: true },
  })
  if (!member) throw new ApiError('MEMBER_NOT_FOUND')
}
