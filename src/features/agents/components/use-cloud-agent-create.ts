'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComputerSize, WorkspaceAgentDirectoryItem, WorkspaceAgentVisibility } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchAgentDirectoryChanged } from '@/shared/workspace/sidebar-events'
import { rememberAgentOpened } from '@/shared/agents/last-agent-by-workspace'
import { isCloudAgentStarting, type CloudAgentPhase } from '@/shared/agents/cloud-agent'
import { buildWorkspaceAgentInput } from '../lib/agent-editor-input'
import { OTHER_AGENT_LABEL, type OtherAgentDraft } from './cloud-agent-draft'

const POLL_MS = 1_500

export type CloudCreateView = {
  agent: WorkspaceAgentDirectoryItem
  phase: CloudAgentPhase
  error: string | null
}

type Identity = {
  name: string
  description: string
  avatarShape: Parameters<typeof buildWorkspaceAgentInput>[0]['avatarShape']
  avatarColor: string
  visibility: WorkspaceAgentVisibility
}

/**
 * Creating an agent that runs on Overlay Cloud: create the agent, start its
 * machine, and follow the machine's startup until the agent can take a message.
 * The agent exists from the first step; closing the dialog while it starts
 * leaves it starting (the agent page shows the same progress).
 */
export function useCloudAgentCreate(args: { workspaceId: string | null; onReady(agent: WorkspaceAgentDirectoryItem): void }) {
  const { workspaceId, onReady } = args
  const [view, setView] = useState<CloudCreateView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const readyRef = useRef(onReady)
  readyRef.current = onReady
  const agentId = view?.agent.id
  const starting = view !== null && isCloudAgentStarting(view.phase)

  // Follow the machine's startup.
  useEffect(() => {
    if (!workspaceId || !agentId || !starting) return
    let cancelled = false
    const tick = async () => {
      try {
        const status = await overlayAppClient.cloudAgents.status(workspaceId, agentId)
        if (cancelled) return
        const phase = status.provision?.phase
        if (status.state === 'ready') {
          setView((current) => (current ? { ...current, phase: 'ready' } : current))
          readyRef.current(view!.agent)
        } else if (phase) {
          setView((current) => (current ? { ...current, phase, error: phase === 'failed' ? (status.provision?.error ?? 'Could not start the machine.') : null } : current))
        }
      } catch (_error) {
        // A missed poll is not a failure; the next one decides.
      }
    }
    const timer = window.setInterval(() => void tick(), POLL_MS)
    return () => { cancelled = true; window.clearInterval(timer) }
    // `view.agent` is stable for the lifetime of a creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, agentId, starting])

  const start = useCallback(async (agent: WorkspaceAgentDirectoryItem, other: OtherAgentDraft, size: ComputerSize) => {
    await overlayAppClient.cloudAgents.provision(workspaceId!, {
      agentId: agent.id, adapterId: other.adapterId, providerAccountId: other.providerAccountId, size,
    })
    setView({ agent, phase: 'queued', error: null })
  }, [workspaceId])

  const create = useCallback(async (identity: Identity, other: OtherAgentDraft, size: ComputerSize) => {
    if (!workspaceId || busy) return
    setBusy(true)
    setError(null)
    let created: WorkspaceAgentDirectoryItem | null = null
    try {
      const result = await overlayAppClient.agents.create(workspaceId, {
        ...buildWorkspaceAgentInput({
          name: identity.name,
          description: identity.description,
          instructions: '',
          agentType: 'byo',
          harnessLabel: OTHER_AGENT_LABEL[other.adapterId],
          adapterId: other.adapterId,
          modelId: '',
          avatarColor: identity.avatarColor,
          avatarShape: identity.avatarShape,
          enabledToolGroups: new Set(),
          visibility: identity.visibility,
        }),
        teamIds: [],
      })
      created = result.agent
      await start(created, other, size)
      dispatchAgentDirectoryChanged(workspaceId)
      rememberAgentOpened(workspaceId, created.id)
    } catch (createError) {
      // Do not leave an agent behind that has no machine (for example on a free plan).
      if (created) await overlayAppClient.agents.archive(workspaceId, created.id).catch((_error) => undefined)
      setError(createError instanceof Error ? createError.message : 'Could not create the agent.')
    } finally {
      setBusy(false)
    }
  }, [busy, start, workspaceId])

  const retry = useCallback(async (other: OtherAgentDraft, size: ComputerSize) => {
    if (!view || !workspaceId) return
    setError(null)
    try {
      await start(view.agent, other, size)
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : 'Could not start the machine.')
    }
  }, [start, view, workspaceId])

  const reset = useCallback(() => { setView(null); setError(null) }, [])

  return { view, busy, error, create, retry, reset }
}
