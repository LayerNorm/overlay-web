'use client'

import type { ReactNode } from 'react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { PageSubviewTabs } from '@/components/layout/PageSubviewTabs'

/** The screen frame every Extensions page shares: breadcrumb header (with the open section) and a scrolling body. */
export function ExtensionsScreen({ title, sectionTitle, overviewHref, children }: {
  title: string
  /** The open Browse section, shown as the last breadcrumb with the page title linking back. */
  sectionTitle?: string
  overviewHref: string
  children: ReactNode
}) {
  return (
    <AppScreenShell
      header={(
        <AppScreenHeader
          title={sectionTitle ?? title}
          breadcrumbs={sectionTitle ? [{ label: title, href: overviewHref }] : undefined}
          tabs={<PageSubviewTabs />}
        />
      )}
    >
      <AppScreenBody padding="none" maxWidth="none" className="h-full">{children}</AppScreenBody>
    </AppScreenShell>
  )
}
