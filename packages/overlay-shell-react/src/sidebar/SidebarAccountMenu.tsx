'use client'

import type { ReactNode } from 'react'
import { unstyledButton } from '@overlay/ui/control-reset'
import { LogOut } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'

export function SidebarAccountMenu({
  usageMeters,
  itemPaddingClass = 'py-2',
  onSignOut,
}: {
  usageMeters?: ReactNode
  itemPaddingClass?: string
  onSignOut: () => void
}) {
  return (
    <>
      {usageMeters}
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
