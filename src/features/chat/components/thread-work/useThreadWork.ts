'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { toast } from '@overlay/ui/primitives'
import type { GitHubRepositoryResource } from '@overlay/api-client'
import { api } from '../../../../../convex/_generated/api'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useThisComputer } from '@/components/desktop/useThisComputer'
import {
  applyComputerChoice, applyFolderChoice, type ThreadComputer, type ThreadFolder, type ThreadWork,
} from '@/shared/agents/thread-work'
import { navigateToExternalFlow } from '@/components/chrome/chrome-extension'

/**
 * Where an agent thread runs and the folder it works in (internal/develop/thread-folders.md). A thread runs on the
 * computer the desktop app is open on ("local") or in the cloud, chosen before its first message and fixed after it.
 * A local thread can be read anywhere but continues only on its own computer.
 */

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message.replace(/^.*ConvexError: /, '').split('\n')[0] || fallback : fallback

const CLOUD_COMPUTER: ThreadComputer = { kind: 'cloud' }

export function useThreadWork(args: { workspaceId: string | null; agentId: string | null; conversationId: string; started: boolean; enabled: boolean }) {
  const { workspaceId, agentId, conversationId, started } = args
  const enabled = args.enabled && Boolean(workspaceId && agentId)
  const scope = useMemo(() => (enabled && workspaceId && agentId ? { workspaceId, agentId } : null), [agentId, enabled, workspaceId])
  const work = useQuery(api.agents.threadWork.get, scope ? { ...scope, conversationId: conversationId as never } : 'skip')
  const options = useQuery(api.agents.threadWork.options, scope ?? 'skip')
  const save = useMutation(api.agents.threadWork.set)
  const thisComputer = useThisComputer(enabled ? workspaceId : null)
  const [repositories, setRepositories] = useState<GitHubRepositoryResource[] | null>(null)
  const [connecting, setConnecting] = useState(false)

  const current: ThreadWork | null = work ?? null
  const computer: ThreadComputer = current?.computer ?? CLOUD_COMPUTER
  const folder = current?.folders[0] ?? null
  const local = computer.kind === 'mac'
  const onThisComputer = computer.kind === 'mac' && thisComputer.environmentId === computer.environmentId
  /** A local thread opened in a browser, or on a different computer, is read-only. Null while that isn't known yet. */
  const readOnly: boolean | null = !current ? null
    : !local ? false
    : !thisComputer.available ? true
    : thisComputer.status === null ? null
    : !onThisComputer
  const computerName = computer.kind === 'mac'
    ? options?.macs.find((mac) => mac.environmentId === computer.environmentId)?.name ?? null
    : null

  const update = useCallback((next: ThreadWork) => {
    if (!scope) return
    void save({ ...scope, conversationId: conversationId as never, work: next }).catch((error: unknown) => {
      toast.error(errorText(error, 'Couldn’t change where this thread works.'))
    })
  }, [conversationId, save, scope])

  // In the desktop app a new thread starts on this computer once it has connected; on the web it starts in the cloud.
  const defaulted = useRef<string | null>(null)
  useEffect(() => {
    if (!current || started || current.computer || current.folders.length > 0) return
    if (!options?.localComputer || !thisComputer.environmentId || defaulted.current === conversationId) return
    defaulted.current = conversationId
    update({ computer: { kind: 'mac', environmentId: thisComputer.environmentId }, folders: [] })
  }, [conversationId, current, options?.localComputer, started, thisComputer.environmentId, update])

  const chooseCloud = useCallback(() => {
    if (current) update(applyComputerChoice(current, { kind: 'cloud' }))
  }, [current, update])

  /** Runs the thread on this computer, connecting it first when it never connected. */
  const chooseThisComputer = useCallback(async () => {
    if (!current) return
    setConnecting(true)
    try {
      const environment = await thisComputer.connect()
      update(applyComputerChoice(current, { kind: 'mac', environmentId: environment.id }))
    } catch (error) {
      toast.error(errorText(error, 'Couldn’t connect this computer.'))
    } finally {
      setConnecting(false)
    }
  }, [current, thisComputer, update])

  const chooseFolder = useCallback((next: ThreadFolder | null) => {
    if (current) update(applyFolderChoice(current, next))
  }, [current, update])

  /** Opens the system folder dialog; the chosen folder is approved for this computer and used by the thread. */
  const chooseLocalFolder = useCallback(async () => {
    if (!current) return
    setConnecting(true)
    try {
      const chosen = await thisComputer.chooseFolder()
      if (chosen) update(applyFolderChoice(current, { source: 'mac', environmentId: chosen.environment.id, path: chosen.path }))
    } catch (error) {
      toast.error(errorText(error, 'Couldn’t add that folder.'))
    } finally {
      setConnecting(false)
    }
  }, [current, thisComputer, update])

  const loadRepositories = useCallback(() => {
    if (!workspaceId || !options?.githubConnected || repositories) return
    void overlayAppClient.github.repositories(workspaceId)
      .then((result) => setRepositories(result.repositories))
      .catch(() => setRepositories([]))
  }, [options?.githubConnected, repositories, workspaceId])

  const copyToFiles = useCallback(async () => {
    if (!workspaceId || folder?.source !== 'mac') return
    try {
      const result = await overlayAppClient.agentEnvironments.copyToFiles(workspaceId, folder.environmentId, { path: folder.path })
      toast(`Copied ${result.copied} files to Overlay Files${result.skipped.length ? `. ${result.skipped.length} weren’t copied.` : '.'}`)
    } catch (error) {
      toast.error(errorText(error, 'Couldn’t copy the folder.'))
    }
  }, [folder, workspaceId])

  const connectGitHub = useCallback(() => {
    if (!workspaceId) return
    navigateToExternalFlow(overlayAppClient.github.connectUrl(workspaceId, `${window.location.pathname}${window.location.search}`))
  }, [workspaceId])

  return {
    /** False until the thread's choice and its options have loaded. */
    ready: Boolean(current && options),
    started,
    work: current,
    computer,
    folder,
    local,
    readOnly,
    computerName,
    options: options ?? null,
    repositories,
    thisComputer,
    /** Connecting this computer or adding a folder is in progress. */
    connecting,
    chooseCloud,
    chooseThisComputer,
    chooseFolder,
    chooseLocalFolder,
    loadRepositories,
    copyToFiles,
    connectGitHub,
  }
}

export type ThreadWorkControls = ReturnType<typeof useThreadWork>
