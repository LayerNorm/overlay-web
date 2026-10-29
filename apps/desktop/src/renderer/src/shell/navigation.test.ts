import { describe, expect, it } from 'vitest'
import { groupSettingsItems } from '@overlay/shell-react/sidebar/settingsSearch'
import {
  activeToolForTarget,
  DESKTOP_MORE_GROUPS,
  DESKTOP_SETTINGS_ITEMS,
  readDesktopShellNav,
  settingsItemGroups,
  workspaceNavStorageKey,
  writeDesktopShellNav,
} from './navigation'

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

describe('desktop shell navigation', () => {
  it('maps legacy targets without restoring removed tools', () => {
    expect(activeToolForTarget('projects')).toBe('files')
    expect(activeToolForTarget('transcriptions')).toBe('voice')
    expect(activeToolForTarget('voice')).toBe('voice')
    expect(activeToolForTarget('unavailable')).toBeNull()
  })

  it('persists scope and collapsed state independently per workspace', () => {
    const storage = createStorage()
    const first = {
      page: 'chat' as const,
      scope: 'workspace' as const,
      itemId: 'thread-1',
      settingsSection: 'general',
      collapsed: true,
    }
    writeDesktopShellNav(storage, 'workspace-a', first)
    writeDesktopShellNav(storage, 'workspace-b', {
      ...first,
      scope: 'personal',
      itemId: null,
      collapsed: false,
    })
    expect(readDesktopShellNav(storage, 'workspace-a')).toEqual(first)
    expect(readDesktopShellNav(storage, 'workspace-b').scope).toBe('personal')
    expect(workspaceNavStorageKey('workspace-a')).not.toBe(
      workspaceNavStorageKey('workspace-b'),
    )
  })

  it('groups settings and More items for desktop', () => {
    const settingsGroups = settingsItemGroups(DESKTOP_SETTINGS_ITEMS)
    expect(settingsGroups.map((group) => group.label)).toEqual([
      'Personal',
      'Workspace',
      'This Mac',
    ])
    expect(DESKTOP_MORE_GROUPS).toEqual([
      { ids: ['files', 'extensions'] },
      { label: 'This Mac', ids: ['voice', 'browser'] },
    ])
    expect(
      groupSettingsItems(DESKTOP_SETTINGS_ITEMS, 'voice', settingsGroups).flatMap((group) =>
        group.items.map((item) => item.id),
      ),
    ).toContain('transcription')
    expect(
      groupSettingsItems(DESKTOP_SETTINGS_ITEMS, 'pill', settingsGroups).flatMap((group) =>
        group.items.map((item) => item.id),
      ),
    ).toContain('assistant')
  })
})
