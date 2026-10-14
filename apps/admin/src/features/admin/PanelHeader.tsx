import type { ReactNode } from 'react'

import { SidebarHeader } from '@overlay/ui/primitives'

/** Matches the web app's SecondaryPanelHeader: serif lowercase title row. */
export function PanelHeader({
  title,
  action,
}: {
  title: string
  action?: ReactNode
}) {
  return (
    <SidebarHeader>
      <span
        className="min-w-0 flex-1 truncate text-lg font-medium lowercase tracking-tight text-(--foreground)"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        {title}
      </span>
      {action}
    </SidebarHeader>
  )
}
