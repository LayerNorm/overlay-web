'use client'

import type { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { IconButton } from '@overlay/ui/primitives'

/** One page of the console: the title row, then the scrolling content column. */
export function AdminScreen({
  title,
  subtitle,
  actions,
  onRefresh,
  children,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  onRefresh?: () => void
  children: ReactNode
}) {
  return (
    <>
      <header className="admin-main-head">
        <h1>{title}</h1>
        <span className="admin-main-sub">{subtitle}</span>
        {actions}
        {onRefresh ? (
          <IconButton className="admin-icon-btn" aria-label="Refresh" title="Refresh" onClick={onRefresh}>
            <RefreshCw size={16} strokeWidth={1.6} />
          </IconButton>
        ) : null}
      </header>
      <div className="admin-scroll">
        <div className="admin-page">{children}</div>
      </div>
    </>
  )
}

export function AdminError({ message }: { message: string | null }) {
  return message ? <p className="admin-error" role="alert">{message}</p> : null
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
