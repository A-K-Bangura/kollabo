import type {
  AdminAccountDto,
  AdminAuditEntryDto,
  AdminOverviewDto,
  AdminProfileDto,
  AdminProjectSummaryDto,
  Paged,
} from '@shared/types'
import { request } from './api'

export interface ProjectQuery {
  search?: string
  status?: string
  sort?: string
  page?: number
  limit?: number
}

export interface AuditQuery {
  projectId?: string
  adminId?: string
  action?: string
  page?: number
  limit?: number
}

const projectPath = (id: string) => `/api/admin/projects/${id}`

/** Everything specific to platform administration. Project contents go through the shared project API instead. */
export const adminApi = {
  me: () => request<{ admin: AdminProfileDto }>('GET', '/api/admin/me').then((r) => r.admin),

  /* Sign-in. These are the only calls that work before you are signed in. */
  signIn: (email: string, password: string) =>
    request<{ twoFactorRequired: boolean }>('POST', '/api/auth/sign-in/email', {
      body: { email, password },
    }),
  verifyCode: (code: string) =>
    request<{ enrolled: boolean }>('POST', '/api/auth/two-factor/verify-totp', { body: { code } }),
  verifyBackupCode: (code: string) =>
    request<{ enrolled: boolean }>('POST', '/api/auth/two-factor/verify-backup-code', { body: { code } }),
  signOut: () => request<void>('POST', '/api/auth/sign-out', { body: {} }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('POST', '/api/auth/change-password', { body: { currentPassword, newPassword } }),
  startTwoFactor: (password: string) =>
    request<{ totpURI: string; backupCodes: string[] }>('POST', '/api/auth/two-factor/enable', {
      body: { password },
    }),
  regenerateBackupCodes: (password: string) =>
    request<{ backupCodes: string[] }>('POST', '/api/auth/two-factor/generate-backup-codes', {
      body: { password },
    }),

  /* Overview and directory */
  overview: () =>
    request<{ overview: AdminOverviewDto }>('GET', '/api/admin/overview').then((r) => r.overview),
  listProjects: (query: ProjectQuery) =>
    request<Paged<AdminProjectSummaryDto>>('GET', '/api/admin/projects', {
      query: { ...query },
    }),
  getProject: (id: string) =>
    request<{ project: AdminProjectSummaryDto }>('GET', projectPath(id)).then((r) => r.project),

  /* Project lifecycle. Each returns the updated project. */
  renameProject: (id: string, name: string, reason?: string) =>
    request<{ project: AdminProjectSummaryDto }>('PATCH', projectPath(id), {
      body: { name, ...(reason ? { reason } : {}) },
    }).then((r) => r.project),
  suspendProject: (id: string, reason: string) =>
    request<{ project: AdminProjectSummaryDto }>('POST', `${projectPath(id)}/suspend`, {
      body: { reason },
    }).then((r) => r.project),
  reactivateProject: (id: string, reason?: string) =>
    request<{ project: AdminProjectSummaryDto }>('POST', `${projectPath(id)}/reactivate`, {
      body: reason ? { reason } : {},
    }).then((r) => r.project),
  deleteProject: (id: string, reason: string) =>
    request<{ project: AdminProjectSummaryDto }>('POST', `${projectPath(id)}/delete`, {
      body: { reason },
    }).then((r) => r.project),
  restoreProject: (id: string, reason?: string) =>
    request<{ project: AdminProjectSummaryDto }>('POST', `${projectPath(id)}/restore`, {
      body: reason ? { reason } : {},
    }).then((r) => r.project),
  /** The new access code is in this response only. */
  rotateCode: (id: string, reason: string) =>
    request<{ project: AdminProjectSummaryDto; accessCode: string }>('POST', `${projectPath(id)}/rotate-code`, {
      body: { reason },
    }),

  /* Audit log */
  auditLog: (query: AuditQuery) =>
    request<Paged<AdminAuditEntryDto>>('GET', '/api/admin/audit', { query: { ...query } }),

  /* Administrators */
  listAdmins: () =>
    request<{ admins: AdminAccountDto[] }>('GET', '/api/admin/admins').then((r) => r.admins),
  createAdmin: (name: string, email: string) =>
    request<{ admin: AdminAccountDto; temporaryPassword: string }>('POST', '/api/admin/admins', {
      body: { name, email },
    }),
  deactivateAdmin: (id: string, reason?: string) =>
    request<{ admin: AdminAccountDto }>('POST', `/api/admin/admins/${id}/deactivate`, {
      body: reason ? { reason } : {},
    }).then((r) => r.admin),
  reactivateAdmin: (id: string, reason?: string) =>
    request<{ admin: AdminAccountDto }>('POST', `/api/admin/admins/${id}/reactivate`, {
      body: reason ? { reason } : {},
    }).then((r) => r.admin),
}
