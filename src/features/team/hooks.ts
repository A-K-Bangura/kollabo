import type { MemberDto } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'
import { useProjectKeys, useProjectScope } from '@/features/scope/scope'
import { useReportError } from '@/features/session/hooks'
import { useSessionState } from '@/features/session/sessionState'
import { api, type DeactivateInput } from '@/lib/api'

export function useMembersQuery() {
  const scope = useProjectScope()
  const keys = useProjectKeys()
  return useQuery({ queryKey: keys.members, queryFn: scope.api.listMembers })
}

/** Name lookups that still work for removed members, so old tasks keep their names. */
export function useMemberLookup() {
  const { data } = useMembersQuery()
  return useMemo(() => {
    const members = data ?? []
    const byId = new Map(members.map((member) => [member.id, member]))
    return {
      members,
      activeMembers: members.filter((member) => member.isActive),
      find: (id: string | null): MemberDto | undefined => (id ? byId.get(id) : undefined),
    }
  }, [data])
}

/** Keeps the cached list in the order the API returns it: oldest first, by creation time. */
function mergeMembers(existing: MemberDto[] | undefined, incoming: MemberDto[]): MemberDto[] {
  const ids = new Set(incoming.map((member) => member.id))
  return [...(existing ?? []).filter((member) => !ids.has(member.id)), ...incoming]
}

function replaceMember(members: MemberDto[] | undefined, member: MemberDto): MemberDto[] | undefined {
  return members?.map((existing) => (existing.id === member.id ? member : existing))
}

/** Adds one person by hand. A name that is already taken is an error the form shows. */
export function useAddMember() {
  const queryClient = useQueryClient()
  const scope = useProjectScope()
  const keys = useProjectKeys()
  const report = useReportError()
  return useMutation({
    mutationFn: async (name: string) => {
      const result = await scope.api.addMembers([name])
      if (!result.member) throw new Error('The person was not added.')
      return result.member
    },
    onSuccess: (member) => {
      queryClient.setQueryData<MemberDto[]>(keys.members, (members) => mergeMembers(members, [member]))
    },
    onError: report,
  })
}

/** Adds many people from a pasted list. Names already in the Collabo are skipped and reported back. */
export function useAddMembers() {
  const queryClient = useQueryClient()
  const scope = useProjectScope()
  const keys = useProjectKeys()
  const report = useReportError()
  return useMutation({
    mutationFn: (names: string[]) => scope.api.addMembers(names),
    onSuccess: (result) => {
      queryClient.setQueryData<MemberDto[]>(keys.members, (members) =>
        mergeMembers(members, result.members),
      )
    },
    onError: report,
  })
}

export function useRenameMember() {
  const queryClient = useQueryClient()
  const scope = useProjectScope()
  const keys = useProjectKeys()
  return useMutation({
    mutationFn: ({ member, name }: { member: MemberDto; name: string }) =>
      scope.api.renameMember(member.id, name),
    onSuccess: (renamed) => {
      queryClient.setQueryData<MemberDto[]>(keys.members, (members) => replaceMember(members, renamed))
      // Names are shown on tasks and history too.
      void queryClient.invalidateQueries({ queryKey: keys.tasks })
      void queryClient.invalidateQueries({ queryKey: keys.taskPrefix })
    },
  })
}

/**
 * Removes someone from the team. If they still have unfinished work the server refuses
 * (MEMBER_HAS_OPEN_TASKS) until a decision is made; the dialog that calls this handles that.
 */
export function useDeactivateMember() {
  const queryClient = useQueryClient()
  const scope = useProjectScope()
  const keys = useProjectKeys()
  return useMutation({
    mutationFn: ({ member, ...input }: { member: MemberDto } & DeactivateInput) =>
      scope.api.deactivateMember(member.id, input),
    onSuccess: (_result, { member }) => {
      queryClient.setQueryData<MemberDto[]>(keys.members, (members) =>
        members?.map((existing) => (existing.id === member.id ? { ...existing, isActive: false } : existing)),
      )
      // Their open tasks may have been handed over or shed an assignee.
      void queryClient.invalidateQueries({ queryKey: keys.tasks })
      void queryClient.invalidateQueries({ queryKey: keys.taskPrefix })
      toast.success(`${member.name} was removed`)
    },
  })
}

export function useReactivateMember() {
  const queryClient = useQueryClient()
  const scope = useProjectScope()
  const keys = useProjectKeys()
  const report = useReportError()
  return useMutation({
    mutationFn: (member: MemberDto) => scope.api.reactivateMember(member.id),
    onSuccess: (member) => {
      queryClient.setQueryData<MemberDto[]>(keys.members, (members) => replaceMember(members, member))
      toast.success(`${member.name} is back on the team`)
    },
    onError: report,
  })
}

/**
 * New code, old code dead, every other session signed out. This browser keeps
 * its own (re-issued) session, and gets to see and copy the new code once.
 */
export function useRegenerateCode() {
  const { setRevealedCode } = useSessionState()
  const report = useReportError()
  return useMutation({
    mutationFn: api.regenerateCode,
    onSuccess: (code) => {
      setRevealedCode(code)
      toast.success('New code generated. The old one no longer works.')
    },
    onError: report,
  })
}
