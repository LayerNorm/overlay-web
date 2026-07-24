'use client'

import type { ReactNode } from 'react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '../shell'

export interface SettingsPageShellProps {
  title?: string
  activeLabel: string
  activeDetail?: ReactNode
  actions?: ReactNode
  /**
   * When true, children fill the body directly without the centered
   * max-width padding wrapper. Used by sections that manage their own
   * full-height layout and scrolling (e.g. Memories).
   */
  fullBleed?: boolean
  children: ReactNode
}

export function SettingsPageShell({
  title = 'Settings',
  activeLabel,
  activeDetail,
  actions,
  fullBleed = false,
  children,
}: SettingsPageShellProps) {
  return (
    <AppScreenShell
      header={
        <AppScreenHeader
          title={title}
          subtitle={activeLabel}
          metadata={activeDetail}
          actions={actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
          className="px-6"
        />
      }
    >
      <AppScreenBody
        padding="none"
        maxWidth="none"
        scroll={fullBleed ? 'hidden' : 'auto'}
        className={fullBleed ? '' : 'px-6 py-6'}
      >
        {fullBleed ? (
          children
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">{children}</div>
        )}
      </AppScreenBody>
    </AppScreenShell>
  )
}

export function SettingsGroup({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] divide-y divide-[var(--border)]">
      {children}
    </div>
  )
}

export function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
      <h2 className="text-sm font-medium text-[var(--foreground)]">{title}</h2>
      <div className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{children}</div>
    </div>
  )
}

export function SettingsTopUpCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
      {children}
    </div>
  )
}
