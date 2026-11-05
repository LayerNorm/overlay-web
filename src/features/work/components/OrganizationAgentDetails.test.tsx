import React from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { OrganizationAgentDetails } from './OrganizationAgentDetails'

const state = vi.hoisted(() => ({
  directory: {
    mode: 'native',
    update: vi.fn(),
  },
  legacyUpdate: vi.fn(),
}))

vi.mock('@/features/agents/components/AgentDirectoryProvider', () => ({
  useAgentDirectory: () => state.directory,
}))

vi.mock('@overlay/modules-react/shell', async () => {
  const ReactModule = await import('react')
  return {
    RightSidebar: ({ hero, tabs }: {
      hero: { avatar: React.ReactNode }
      tabs: Array<{ content: React.ReactNode }>
    }) => ReactModule.createElement(
      ReactModule.Fragment,
      null,
      hero.avatar,
      ...tabs.map((tab) => tab.content),
    ),
  }
})

vi.mock('@overlay/ui/primitives', async () => {
  const ReactModule = await import('react')
  return {
    Button: ({ children, type = 'button', onClick, ...props }: {
      children?: React.ReactNode
      type?: string
      onClick?: (event: unknown) => void
      [key: string]: unknown
    }) => ReactModule.createElement('button', {
      type, onClick: onClick as never, disabled: Boolean(props.disabled),
    }, children),
    Input: (props: Record<string, unknown>) => ReactModule.createElement('input', props as never),
    Textarea: (props: Record<string, unknown>) => ReactModule.createElement('textarea', props as never),
  }
})

vi.mock('next/link', async () => {
  const ReactModule = await import('react')
  return {
    default: ({ href, children }: { href: string; children: React.ReactNode }) =>
      ReactModule.createElement('a', { href }, children),
  }
})

vi.mock('@/components/orb/Creature', () => ({
  AgentCreature: () => <div />,
}))

vi.mock('@/features/agents/components/AgentAvatarPicker', () => ({
  AgentAvatarPicker: () => <div />,
}))

vi.mock('@/shared/app/overlay-app-client', () => ({
  overlayAppClient: { agents: { update: state.legacyUpdate } },
}))

vi.mock('@/shared/workspace/sidebar-events', () => ({
  dispatchAgentDirectoryChanged: vi.fn(),
}))

vi.mock('@/hooks/use-workspace-href', () => ({
  useWorkspaceHref: () => (_workspaceId: string, path: string) => path,
}))

vi.mock('@/hooks/use-panel-scope', () => ({
  usePanelScope: () => 'workspace',
}))

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): {
    root: {
      findAllByType(type: string): Array<{ props: Record<string, unknown> }>
      findByType(type: string): { props: Record<string, unknown> }
    }
    unmount(): void
  }
}

function makeAgent(): WorkspaceAgentDirectoryItem & { revision: string } {
  return {
    id: 'personal-chief',
    workspaceId: 'workspace-1',
    principalId: 'principal-agent',
    name: 'My chief',
    description: 'Original description',
    instructions: 'Private instructions.',
    harness: 'overlay',
    modelId: 'test-model',
    allowedToolIds: [],
    invocationPolicy: 'mention',
    visibility: 'workspace',
    createdByPrincipalId: 'principal-owner',
    createdAt: 1,
    updatedAt: 1,
    agentRole: 'personal_chief',
    chiefOwnerUserId: 'owner',
    chiefScope: 'workspace',
    canEdit: true,
    teamIds: [],
    roomCount: 0,
    revision: 'base-revision',
  } as WorkspaceAgentDirectoryItem & { revision: string }
}

describe('organization agent appearance editor', () => {
  beforeEach(() => {
    state.directory.mode = 'native'
    state.directory.update.mockReset()
    state.directory.update.mockImplementation(async (_id: string, patch: object) => ({
      ...makeAgent(),
      ...patch,
      revision: 'saved-revision',
    }))
    state.legacyUpdate.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('saves appearance through native update using the displayed base revision', async () => {
    const agent = makeAgent()
    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<OrganizationAgentDetails agent={agent} owner="Owner" onClose={() => {}} />)
    })
    try {
      const name = renderer.root.findByType('input')
      const description = renderer.root.findByType('textarea')
      await act(async () => {
        ;(name.props.onChange as (event: unknown) => void)({ target: { value: 'Renamed chief' } })
        ;(description.props.onChange as (event: unknown) => void)({ target: { value: 'Updated public description' } })
      })
      const form = renderer.root.findByType('form')
      await act(async () => {
        await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} })
      })
      expect(state.directory.update).toHaveBeenCalledWith('personal-chief', {
        name: 'Renamed chief',
        description: 'Updated public description',
        avatarColor: '#9a97c4',
        avatarShape: 'squircle',
      }, 'base-revision')
      expect(state.legacyUpdate).not.toHaveBeenCalled()
    } finally {
      await act(async () => renderer.unmount())
    }
  })
})
