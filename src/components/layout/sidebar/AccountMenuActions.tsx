'use client'

import { BookOpen, Bug, Moon, Settings, Sun } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'

/**
 * The app-wide actions in the account menu, above Sign out: theme, Settings, help docs and bug reports. They used to
 * be buttons at the bottom of the primary rail, which now holds only the Workspace | Personal switch and the account.
 */
export function AccountMenuActions({
  theme, onToggleTheme, onOpenSettings, docsUrl, onReportBug, onClose, itemPaddingClass = 'py-2',
}: {
  /** Omitted when settings are not loaded; the theme row is then hidden. */
  theme?: 'light' | 'dark'
  onToggleTheme: () => void
  onOpenSettings: () => void
  docsUrl: string
  onReportBug: () => void
  /** Closes the account menu after an action that leaves it. */
  onClose: () => void
  itemPaddingClass?: string
}) {
  const row = unstyledButton(`flex w-full items-center gap-2 px-3 ${itemPaddingClass} text-xs text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)`)
  return (
    <div className="border-t border-(--border) py-1">
      {theme ? (
        <Button variant="ghost" type="button" className={row} onClick={onToggleTheme}>
          {theme === 'dark' ? <Sun size={13} aria-hidden /> : <Moon size={13} aria-hidden />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </Button>
      ) : null}
      <Button variant="ghost" type="button" className={row} onClick={() => { onClose(); onOpenSettings() }}>
        <Settings size={13} aria-hidden />Settings
      </Button>
      <Button variant="ghost" asChild className={row}>
        <a href={docsUrl} target="_blank" rel="noopener noreferrer" onClick={onClose}><BookOpen size={13} aria-hidden />Help and docs</a>
      </Button>
      <Button variant="ghost" type="button" className={row} onClick={() => { onClose(); onReportBug() }}>
        <Bug size={13} aria-hidden />Submit a bug
      </Button>
    </div>
  )
}
