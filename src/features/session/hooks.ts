import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { api, ApiClientError, isSessionError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { useSessionState } from './sessionState'

export function useProjectQuery() {
  return useQuery({
    queryKey: queryKeys.project,
    queryFn: api.getProject,
    // A 401 here just means "not signed in": do not retry or treat it as a failure.
    retry: false,
  })
}

/** Turns any failure into feedback. Lost sessions are handled globally, not here. */
export function useReportError() {
  const { forgetMember } = useSessionState()
  const navigate = useNavigate()

  return useCallback(
    (error: unknown) => {
      if (isSessionError(error)) return
      if (error instanceof ApiClientError && error.code === 'MEMBER_REQUIRED') {
        forgetMember()
        toast.error(error.message)
        void navigate('/who', { replace: true })
        return
      }
      toast.error(error instanceof Error ? error.message : 'Something went wrong. Please try again.')
    },
    [forgetMember, navigate],
  )
}

/** Exchange an access code for a session, replacing whatever Collabo was open. */
export function useEnterCode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.enterCode,
    onSuccess: (project) => {
      // Never let one Collabo's cached data bleed into the next.
      queryClient.clear()
      queryClient.setQueryData(queryKeys.project, project)
    },
  })
}

export function useLeaveCollabo() {
  const queryClient = useQueryClient()
  const { reset } = useSessionState()
  const navigate = useNavigate()
  const report = useReportError()

  return useMutation({
    mutationFn: api.leaveCollabo,
    onSuccess: () => {
      queryClient.clear()
      reset()
      void navigate('/', { replace: true })
    },
    onError: report,
  })
}

/** Create a Collabo. The creator is signed in and is the acting member straight away. */
export function useCreateProject() {
  const queryClient = useQueryClient()
  const { selectMember, setRevealedCode } = useSessionState()

  return useMutation({
    mutationFn: api.createProject,
    onSuccess: ({ project, members, creatorMemberId, accessCode }) => {
      queryClient.clear()
      queryClient.setQueryData(queryKeys.project, project)
      queryClient.setQueryData(queryKeys.members, members)
      selectMember(project.id, creatorMemberId)
      // The one moment the plain code exists. It is held in memory only.
      setRevealedCode(accessCode)
    },
  })
}
