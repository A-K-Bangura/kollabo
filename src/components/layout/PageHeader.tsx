import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  subtitle?: string
  children?: ReactNode
}

/** Page title, an optional quiet subtitle, and room underneath for the refresh bar. */
export function PageHeader({ title, subtitle, children }: PageHeaderProps) {
  return (
    <header className="mb-5 flex flex-col gap-3">
      <div>
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {children}
    </header>
  )
}
