import { Navigate, Route, Routes } from 'react-router'
import { AdminLoginPage } from './AdminLoginPage'
import { AdminProjectPage } from './AdminProjectPage'
import { AdminGate, AdminShell, SetupGuard } from './AdminShell'
import { AdminSetupPage } from './AdminSetupPage'
import { AdminsPage } from './AdminsPage'
import { AuditPage } from './AuditPage'
import { DashboardPage } from './DashboardPage'
import { ProjectDirectoryPage } from './ProjectDirectoryPage'

/**
 * The whole admin area, loaded as one separate chunk: members of a Collabo never download
 * it. Sign-in is the only public page; everything else sits behind the admin gate, and the
 * server checks the administrator again on every request regardless of what this renders.
 */
export function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<AdminLoginPage />} />
      <Route element={<AdminGate />}>
        <Route path="setup" element={<AdminSetupPage />} />
        <Route element={<SetupGuard />}>
          <Route element={<AdminShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="projects" element={<ProjectDirectoryPage />} />
            <Route path="projects/:projectId" element={<AdminProjectPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="admins" element={<AdminsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  )
}
