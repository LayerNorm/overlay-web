'use client'

import Link from 'next/link'
import { LogOut, Sparkles, User } from 'lucide-react'
import { PROFILE_APP_LINKS } from './sidebarNavigation'
import { StorageBar, UsageBar, type SidebarEntitlements } from './SidebarUsageMeters'

export function SidebarAccountMenu({
  billingEnabled,
  entitlements,
  itemPaddingClass = 'py-2',
  demoHref,
  onAccountClick,
  onSignOut,
}: {
  billingEnabled: boolean
  entitlements: SidebarEntitlements | null
  itemPaddingClass?: string
  demoHref?: string
  onAccountClick: () => void
  onSignOut: () => void
}) {
  return (
    <>
      {billingEnabled ? (
        <>
          <div className="px-3 py-2">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted-light)]">Usage</p>
            <UsageBar entitlements={entitlements} />
          </div>
          <div className="border-t border-[var(--border)] px-3 py-2">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted-light)]">Storage</p>
            <StorageBar entitlements={entitlements} />
          </div>
        </>
      ) : null}
      <div className="border-t border-[var(--border)]">
        <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted-light)]">Apps</p>
        {PROFILE_APP_LINKS.map(({ label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            disabled
            title={`${label} · Coming soon`}
            className={`flex w-full cursor-not-allowed items-center justify-between gap-2 px-3 ${itemPaddingClass} text-xs text-[var(--muted-light)]`}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <Icon size={13} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </span>
            <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-[var(--muted-light)]">Soon</span>
          </button>
        ))}
      </div>
      {demoHref ? (
        <div className="border-t border-[var(--border)]">
          <Link
            href={demoHref}
            onClick={onAccountClick}
            className={`flex w-full items-center gap-2 px-3 ${itemPaddingClass} text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]`}
          >
            <Sparkles size={13} />
            Demo
          </Link>
        </div>
      ) : null}
      <div className="border-t border-[var(--border)]">
        <Link
          href="/account"
          onClick={onAccountClick}
          className={`flex w-full items-center gap-2 px-3 ${itemPaddingClass} text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]`}
        >
          <User size={13} />
          Account
        </Link>
      </div>
      <div className="border-t border-[var(--border)]">
        <button
          type="button"
          onClick={onSignOut}
          className={`flex w-full items-center gap-2 px-3 ${itemPaddingClass} text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]`}
        >
          <LogOut size={13} />
          Sign out
        </button>
      </div>
    </>
  )
}
