import type { MemberDto } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'
import { useReportError } from '@/features/session/hooks'
import { useSessionState } from '@/features/session/sessionState'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export function useMembersQuery() {
  return useQuery({ queryKey: queryKeys.members, queryFn: api.listMembers })
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

function upsertMember(members: MemberDto[] | undefined, member: MemberDto): MemberDto[] {
  const rest = (members ?? []).filter((existing) => existing.id !== member.id)
  return [...rest, member]
}

export function useAddMember() {
  const queryClient = useQueryClient()
  const report = useReportError()
  return useMutation({
    mutationFn: api.addMember,
    onSuccess: (member) => {
      queryClient.setQueryData<MemberDto[]>(queryKeys.members, (members) =>
        upsertMember(members, member),
      )
    },
    onError: report,
  })
}

export function useRemoveMember() {
  const queryClient = useQueryClient()
  const report = useReportError()
  return useMutation({
    mutationFn: (member: MemberDto) => api.removeMember(member.id),
    onSuccess: (_result, member) => {
      queryClient.setQueryData<MemberDto[]>(queryKeys.members, (members) =>
        members?.map((existing) =>
          existing.id === member.id ? { ...existing, isActive: false } : existing,
        ),
      )
      toast.success(`${member.name} was removed`)
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
