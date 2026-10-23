'use client'
import { unstyledButton } from '@overlay/ui/control-reset'
import Link from 'next/link'
import { LogOut, Settings, Sparkles } from 'lucide-react'
import { CollapsibleSection, Button } from '@overlay/ui/primitives'
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
          <CollapsibleSection label="Usage">
            <div className="px-3 pb-1">
              <UsageBar entitlements={entitlements} />
            </div>
          </CollapsibleSection>
          <CollapsibleSection label="Storage" className="border-t border-(--border)">
            <div className="px-3 pb-1">
              <StorageBar entitlements={entitlements} />
            </div>
          </CollapsibleSection>
        </>
      ) : null}
      {demoHref ? (
        <div className="border-t border-(--border)">
          <Link
            href={demoHref}
            onClick={onAccountClick}
            className={`flex w-full items-center gap-2 px-3 ${itemPaddingClass} text-xs text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)`}
          >
            <Sparkles size={13} />
            Demo
          </Link>
        </div>
      ) : null}
      <div className="border-t border-(--border)">
        <Link
          href="/app/settings"
          onClick={onAccountClick}
          className={`flex w-full items-center gap-2 px-3 ${itemPaddingClass} text-xs text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)`}
        >
          <Settings size={13} />
          Settings
        </Link>
      </div>
      <div className="border-t border-(--border)">
        <Button variant="ghost"
          type="button"
          onClick={onSignOut}
          className={unstyledButton(`flex w-full items-center gap-2 px-3 ${itemPaddingClass} text-xs text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)`)}
        >
          <LogOut size={13} />
          Sign out
        </Button>
      </div>
    </>
  )
}
