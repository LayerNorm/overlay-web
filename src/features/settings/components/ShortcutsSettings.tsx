'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import { SettingsGroup } from '@overlay/modules-react/settings'
import {
  formatShortcutKey,
  isApplePlatform,
  SHORTCUTS,
  SHORTCUT_GROUPS,
  type ShortcutDefinition,
} from '@/shared/shortcuts/shortcut-registry'

/** Platform never changes at runtime, so the store never notifies. */
const subscribeToNothing = () => () => {}
const notApple = () => false

function KeyCap({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-1.5 py-0.5 font-sans text-[11px] font-medium leading-5 text-[var(--foreground)]">
      {children}
    </kbd>
  )
}

function ShortcutKeys({ shortcut, apple }: { shortcut: ShortcutDefinition; apple: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {shortcut.keys.map((chord, chordIndex) => (
        <span key={chordIndex} className="flex items-center gap-1">
          {chordIndex > 0 ? (
            <span className="mr-1 text-[11px] text-[var(--muted-light)]">or</span>
          ) : null}
          {chord.map((key, keyIndex) => (
            <KeyCap key={keyIndex}>{formatShortcutKey(key, apple)}</KeyCap>
          ))}
        </span>
      ))}
    </span>
  )
}

export function ShortcutsSettings() {
  // Resolved on the client only so server and client markup match.
  const apple = useSyncExternalStore(subscribeToNothing, isApplePlatform, notApple)
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return SHORTCUT_GROUPS.map((group) => ({
      ...group,
      shortcuts: SHORTCUTS.filter(
        (shortcut) =>
          shortcut.group === group.id &&
          (needle === '' ||
            shortcut.label.toLowerCase().includes(needle) ||
            shortcut.description.toLowerCase().includes(needle) ||
            shortcut.keys.some((chord) =>
              chord.some((key) => formatShortcutKey(key, apple).toLowerCase().includes(needle)),
            )),
      ),
    })).filter((group) => group.shortcuts.length > 0)
  }, [apple, query])

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search shortcuts..."
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-light)] focus:border-[var(--muted-light)]"
      />

      {groups.length === 0 ? (
        <p className="px-1 py-8 text-center text-xs text-[var(--muted-light)]">
          No shortcuts match &ldquo;{query}&rdquo;
        </p>
      ) : null}

      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-2">
          <div className="px-1">
            <h2 className="text-sm font-medium text-[var(--foreground)]">{group.label}</h2>
            <p className="text-xs text-[var(--muted-light)]">{group.description}</p>
          </div>
          <SettingsGroup>
            {group.shortcuts.map((shortcut) => (
              <div key={shortcut.id} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-[var(--foreground)]">{shortcut.label}</div>
                  <div className="text-xs leading-relaxed text-[var(--muted-light)]">
                    {shortcut.description}
                  </div>
                </div>
                <ShortcutKeys shortcut={shortcut} apple={apple} />
              </div>
            ))}
          </SettingsGroup>
        </div>
      ))}
    </div>
  )
}
