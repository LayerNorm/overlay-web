import React, { act } from 'react'
import { createRequire } from 'node:module'
import { afterEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [],
  remove: vi.fn(), bulk: vi.fn(), success: vi.fn(), error: vi.fn(), confirm: vi.fn(),
  items: [
    { key: 'agent-thread:t1', kind: 'agent-thread', id: 't1', agentId: 'a1', name: 'First thread', category: 'agents', scope: null },
    { key: 'agent-thread:t2', kind: 'agent-thread', id: 't2', agentId: 'a1', name: 'Second thread', category: 'agents', scope: null },
  ],
}))
vi.mock('@/contexts/WorkspaceContext', () => ({ useOptionalWorkspace: () => ({ activeWorkspaceId: 'ws' }) }))
vi.mock('@/hooks/use-workspace-href', () => ({ useWorkspaceHref: () => (_id: string, path: string) => path }))
vi.mock('@/components/providers/PersonalChatProvider', () => ({
  usePersonalChat: () => ({ archived: { rows: mocks.rows, status: 'ready', hasMore: false } }),
}))
vi.mock('@/components/layout/ScopeTag', () => ({ ScopeTag: () => null }))
vi.mock('../lib/use-live-archived', () => ({ useLiveArchivedItems: () => ({ items: mocks.items, failed: [] }) }))
vi.mock('../lib/archived-actions', () => ({
  deleteArchivedItem: mocks.remove, runBulk: mocks.bulk, restoreArchivedItem: vi.fn(),
}))
vi.mock('@overlay/ui/primitives', () => ({
  Button: 'button', Input: 'input', ListboxSelect: () => null,
  toast: { success: mocks.success, error: mocks.error },
}))

import { ArchivedSettings } from './ArchivedSettings'

const { create } = createRequire(import.meta.url)('react-test-renderer') as typeof import('react-test-renderer')

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

test('archived thread delete runs immediately without confirmation and disables actions while pending', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('confirm', mocks.confirm)
  let finish!: () => void
  mocks.remove.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(<ArchivedSettings />) })
  try {
    await act(async () => { renderer.root.findByProps({ 'aria-label': 'Delete First thread forever' }).props.onClick() })
    expect(mocks.remove).toHaveBeenCalledWith(mocks.items[0], 'ws')
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
    expect(renderer.root.findByProps({ 'aria-label': 'Delete First thread forever' }).props.disabled).toBe(true)
    await act(async () => { finish() })
    expect(mocks.success).toHaveBeenCalledWith('Deleted “First thread”.')
  } finally { await act(async () => { renderer.unmount() }) }
})

test('bulk archived deletion starts on the first click and reports partial failure', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('confirm', mocks.confirm)
  mocks.bulk.mockResolvedValueOnce({ succeeded: ['agent-thread:t1'], failed: [{ key: 'agent-thread:t2', message: 'Denied' }] })
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(<ArchivedSettings />) })
  try {
    await act(async () => { renderer.root.findByProps({ 'aria-label': 'Select all shown' }).props.onChange() })
    await act(async () => { renderer.root.findAllByType('button').find(button => button.props.variant === 'danger')!.props.onClick() })
    expect(mocks.bulk).toHaveBeenCalledWith(mocks.items, 'delete', 'ws')
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalled()
  } finally { await act(async () => { renderer.unmount() }) }
})

test('failed archived deletion reports the error and re-enables the action', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.remove.mockRejectedValueOnce(new Error('Denied'))
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(<ArchivedSettings />) })
  try {
    await act(async () => { renderer.root.findByProps({ 'aria-label': 'Delete First thread forever' }).props.onClick() })
    expect(mocks.error).toHaveBeenCalledWith('Could not delete that. You may not have access to it.')
    expect(renderer.root.findByProps({ 'aria-label': 'Delete First thread forever' }).props.disabled).toBe(false)
  } finally { await act(async () => { renderer.unmount() }) }
})

test('an empty archive has no deletion action', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const items = mocks.items
  mocks.items = []
  let renderer!: ReturnType<typeof create>
  try {
    await act(async () => { renderer = create(<ArchivedSettings />) })
    expect(renderer.root.findAllByType('button').filter(button => button.props.title === 'Delete forever')).toHaveLength(0)
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.bulk).not.toHaveBeenCalled()
  } finally {
    await act(async () => { renderer?.unmount() })
    mocks.items = items
  }
})
