import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { ConnectedAgentSettings } from './ConnectedAgentSettings'

const state = vi.hoisted(() => ({
  workspace: { activeWorkspaceId: 'workspace-1' as string | null },
  directory: {
    mode: 'native' as string,
    error: null as string | null,
    update: vi.fn(),
  },
  saveResult: {
    modelId: 'byo/codex#gpt-6-sol',
    permissionMode: 'plan',
    effort: 'high',
    revision: 'saved-revision',
  },
  capabilities: {
    adapters: [{
      id: 'codex',
      displayName: 'Codex',
      protocol: 'acp',
      supports: { prompt: true, approval: true, cancel: true, resume: true },
      options: {
        discoveredAt: 1,
        model: { values: [
          { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
          { id: 'gpt-6-sol', label: 'GPT-6 Sol' },
          { id: 'gpt-5.5', label: 'GPT-5.5' },
        ] },
        mode: { values: [
          { id: 'acceptEdits', label: 'Accept edits' },
          { id: 'plan', label: 'Plan' },
          { id: 'auto', label: 'Auto' },
        ] },
        effort: { values: [
          { id: 'low', label: 'Low' },
          { id: 'medium', label: 'Medium' },
          { id: 'high', label: 'High' },
        ] },
      },
    }],
  },
  legacyUpdate: vi.fn(),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => state.workspace,
}))

vi.mock('./AgentDirectoryProvider', () => ({
  useAgentDirectory: () => state.directory,
}))

vi.mock('./use-agent-options', () => ({
  useAgentOptions: () => ({
    environment: { kind: 'local', capabilities: state.capabilities },
    error: null,
    loading: false,
  }),
}))

vi.mock('@/shared/app/overlay-app-client', () => ({
  overlayAppClient: { agents: { update: state.legacyUpdate } },
}))

vi.mock('./AgentRuntimeSettingsFields', async () => {
  const ReactModule = await import('react')
  return {
    AgentRuntimeSettingsFields: (props: Record<string, unknown>) =>
      ReactModule.createElement('agent-runtime-settings-fields', props as never),
  }
})

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): {
    root: {
      findByType(type: string): { props: Record<string, unknown> }
    }
    update(element: React.ReactElement): void
    unmount(): void
  }
}

type Profile = {
  modelId: string
  permissionMode: string
  effort: string
  revision: string
}

type SettingsProps = {
  model: string
  mode: string
  effort: string
  disabled: boolean
  onMode(mode: string): void
}

function element(profile: Profile) {
  return <ConnectedAgentSettings agentId="agent-1" {...profile} />
}

function settings(renderer: ReturnType<typeof create>): SettingsProps {
  return renderer.root.findByType('agent-runtime-settings-fields').props as unknown as SettingsProps
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

const baseProfile: Profile = {
  modelId: 'byo/codex#gpt-6-astra',
  permissionMode: 'acceptEdits',
  effort: 'medium',
  revision: 'base-revision',
}

describe('connected agent settings profile synchronization', () => {
  beforeEach(() => {
    state.workspace.activeWorkspaceId = 'workspace-1'
    state.directory.mode = 'native'
    state.directory.error = null
    state.directory.update.mockReset().mockImplementation(async () => state.saveResult)
    state.saveResult = {
      modelId: 'byo/codex#gpt-6-sol',
      permissionMode: 'plan',
      effort: 'high',
      revision: 'saved-revision',
    }
    state.legacyUpdate.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('applies idle remote profile props and saves against the updated revision', async () => {
    let renderer!: ReturnType<typeof create>
    await act(async () => { renderer = create(element(baseProfile)) })
    try {
      const remoteProfile = {
        modelId: 'byo/codex#gpt-6-sol',
        permissionMode: 'plan',
        effort: 'high',
        revision: 'remote-revision',
      }
      await act(async () => { renderer.update(element(remoteProfile)) })

      expect(settings(renderer)).toMatchObject({
        model: 'gpt-6-sol',
        mode: 'plan',
        effort: 'high',
      })
      await act(async () => { settings(renderer).onMode('acceptEdits') })

      expect(state.directory.update).toHaveBeenCalledWith(
        'agent-1',
        { permissionMode: 'acceptEdits' },
        'remote-revision',
      )
      expect(state.legacyUpdate).not.toHaveBeenCalled()
    } finally {
      await act(async () => renderer.unmount())
    }
  })

  it('applies a different remote profile received during save after the save settles', async () => {
    const save = deferred<typeof state.saveResult>()
    state.directory.update.mockReturnValue(save.promise)
    let renderer!: ReturnType<typeof create>
    await act(async () => { renderer = create(element(baseProfile)) })
    try {
      await act(async () => { settings(renderer).onMode('plan') })
      const remoteProfile = {
        modelId: 'byo/codex#gpt-5.5',
        permissionMode: 'auto',
        effort: 'low',
        revision: 'remote-revision',
      }
      await act(async () => { renderer.update(element(remoteProfile)) })
      expect(settings(renderer).disabled).toBe(true)

      await act(async () => {
        save.resolve({
          modelId: 'byo/codex#gpt-6-sol',
          permissionMode: 'plan',
          effort: 'high',
          revision: 'saved-revision',
        })
        await save.promise
      })

      expect(settings(renderer)).toMatchObject({
        model: 'gpt-5.5',
        mode: 'auto',
        effort: 'low',
      })
    } finally {
      await act(async () => renderer.unmount())
    }
  })

  it('does not let a base-profile remote echo revert a successful save', async () => {
    const save = deferred<typeof state.saveResult>()
    state.directory.update.mockReturnValue(save.promise)
    let renderer!: ReturnType<typeof create>
    await act(async () => { renderer = create(element(baseProfile)) })
    try {
      await act(async () => { settings(renderer).onMode('plan') })
      await act(async () => {
        renderer.update(element({
          ...baseProfile,
          modelId: 'byo/codex#gpt-5.5',
          revision: 'intermediate-revision',
        }))
      })
      await act(async () => { renderer.update(element(baseProfile)) })

      await act(async () => {
        save.resolve({
          modelId: 'byo/codex#gpt-6-sol',
          permissionMode: 'plan',
          effort: 'high',
          revision: 'saved-revision',
        })
        await save.promise
      })

      expect(settings(renderer)).toMatchObject({
        model: 'gpt-6-sol',
        mode: 'plan',
        effort: 'high',
      })
    } finally {
      await act(async () => renderer.unmount())
    }
  })
})
