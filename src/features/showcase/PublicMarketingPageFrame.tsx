'use client'

import type { ReactNode } from 'react'
import { AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'

export function PublicMarketingPageFrame({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <AppScreenShell header={<AppScreenHeader title={title} />}>
      <div className="h-full overflow-y-auto">{children}</div>
    </AppScreenShell>
  )
}
