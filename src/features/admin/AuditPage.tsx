import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback'
import { SelectField, TextField } from '@/components/ui/fields'
import { adminApi } from '@/lib/adminApi'
import { auditText } from './auditLabels'
import { AuditEntries } from './AuditEntries'
import { adminKeys } from './hooks'
import { AdminRefresh } from './ui'

const PAGE_SIZE = 25
const ACTIONS = [
  'project.suspend',
  'project.reactivate',
  'project.delete',
  'project.restore',
  'project.rotate_code',
  'project.rename',
  'task.progress_override',
  'task.reopen',
  'task.create',
  'task.update',
  'task.delete',
  'member.add',
  'member.rename',
  'member.deactivate',
  'admin.sign_in',
  'admin.password_changed',
  'admin.create',
  'admin.deactivate',
]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Everything administrators have done, newest first. Append-only: nobody can edit or remove an entry. */
export function AuditPage() {
  const [params, setParams] = useSearchParams()
  const projectId = params.get('project') ?? ''
  const adminId = params.get('admin') ?? ''
  const action = params.get('action') ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [draft, setDraft] = useState(projectId)
  const [refreshing, setRefreshing] = useState(false)

  const validProject = projectId === '' || UUID.test(projectId)
  const query = {
    ...(validProject && projectId ? { projectId } : {}),
    ...(adminId ? { adminId } : {}),
    ...(action ? { action } : {}),
    page,
    limit: PAGE_SIZE,
  }

  const admins = useQuery({ queryKey: adminKeys.admins, queryFn: adminApi.listAdmins })
  const audit = useQuery({
    queryKey: [...adminKeys.audit, 'all', query],
    queryFn: () => adminApi.auditLog(query),
    placeholderData: keepPreviousData,
  })

  const update = (changes: Record<string, string>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        for (const [key, value] of Object.entries(changes)) {
          if (value === '') next.delete(key)
          else next.set(key, value)
        }
        if (!('page' in changes)) next.delete('page')
        return next
      },
      { replace: true },
    )

  const refresh = async () => {
    setRefreshing(true)
    try {
      await audit.refetch()
    } finally {
      setRefreshing(false)
    }
  }

  const data = audit.data
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every privileged action, with who did it and why. Entries can’t be changed or removed.">
        <AdminRefresh updatedAt={audit.dataUpdatedAt} onRefresh={refresh} refreshing={refreshing || audit.isFetching} />
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <SelectField label="Action" value={action} onChange={(event) => update({ action: event.target.value })}>
          <option value="">Any action</option>
          {ACTIONS.map((value) => (
            <option key={value} value={value}>
              {auditText(value)}
            </option>
          ))}
        </SelectField>
        <SelectField label="Administrator" value={adminId} onChange={(event) => update({ admin: event.target.value })}>
          <option value="">Anyone</option>
          {admins.data?.map((admin) => (
            <option key={admin.id} value={admin.id}>
              {admin.name}
            </option>
          ))}
        </SelectField>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            update({ project: draft.trim() })
          }}
          className="flex items-end gap-2"
        >
          <TextField
            label="Project id"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            error={draft.trim() !== '' && !UUID.test(draft.trim()) ? 'That doesn’t look like a project id' : undefined}
            className="flex-1"
          />
          <Button type="submit" variant="secondary" className="mb-0.5">
            Apply
          </Button>
        </form>
      </div>

      {audit.isPending && <Skeleton className="h-48" />}
      {audit.isError && <ErrorState message={audit.error.message} onRetry={() => void audit.refetch()} />}
      {data && data.items.length === 0 && <EmptyState title="Nothing to show." description="No entries match these filters." />}
      {data && data.items.length > 0 && (
        <>
          <AuditEntries entries={data.items} showProject />
          <div className="mt-4 flex items-center justify-between gap-3">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
              Newer
            </Button>
            <p className="text-sm text-muted">
              Page {page}
              {data.total !== undefined && ` · ${data.total} ${data.total === 1 ? 'entry' : 'entries'}`}
            </p>
            <Button variant="secondary" size="sm" disabled={!data.hasMore} onClick={() => update({ page: String(page + 1) })}>
              Older
            </Button>
          </div>
        </>
      )}
    </>
  )
}
