import { createBrowserRouter, Navigate } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { CalendarPage } from '@/features/calendar/CalendarPage'
import { LandingPage } from '@/features/landing/LandingPage'
import { CreateCollaboPage } from '@/features/projects/CreateCollaboPage'
import { MemberGate, ProjectGate } from '@/features/session/gates'
import { WhoAreYouPage } from '@/features/session/WhoAreYouPage'
import { TasksPage } from '@/features/tasks/TasksPage'
import { TeamPage } from '@/features/team/TeamPage'
import { TodayPage } from '@/features/today/TodayPage'

export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/new', element: <CreateCollaboPage /> },
  {
    // Everything below needs a valid project session...
    element: <ProjectGate />,
    children: [
      { path: '/who', element: <WhoAreYouPage /> },
      {
        // ...and the app itself also needs to know who is acting.
        element: <MemberGate />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: '/today', element: <TodayPage /> },
              { path: '/tasks', element: <TasksPage /> },
              { path: '/calendar', element: <CalendarPage /> },
              { path: '/team', element: <TeamPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
