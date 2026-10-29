'use client'

import type { ReactNode } from 'react'
import { unstyledButton } from '@overlay/ui/control-reset'
import { LogOut, Settings, UserRound } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { useShellAdapter } from '../adapter'

export function SidebarAccountMenu({
  usageMeters,
  itemPaddingClass = 'py-2',
  onAccountClick,
  onSettingsClick = onAccountClick,
  onSignOut,
}: {
  usageMeters?: ReactNode
  itemPaddingClass?: string
  onAccountClick: () => void
  onSettingsClick?: () => void
  onSignOut: () => void
}) {
  const { Link } = useShellAdapter()
  return (
    <>
      {usageMeters}
      <div className="border-t border-(--border)">
        <Link
          href="/account"
          onClick={onAccountClick}
          className={`flex w-full items-center gap-2 px-3 ${itemPaddingClass} text-xs text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)`}
        >
          <UserRound size={13} />
          Account
        </Link>
      </div>
      <div className="border-t border-(--border)">
        <Link
          href="/app/settings"
          onClick={onSettingsClick}
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
