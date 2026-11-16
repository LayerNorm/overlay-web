import type { DesktopBridge, LocalComputerStatus } from '@overlay/desktop-bridge'
import type { AgentEnvironmentResource, AgentEnvironmentsClient } from '@overlay/api-client'

/**
 * The computer the desktop app is open on, as a place agent threads can run (internal/develop/thread-folders.md).
 * Connecting it and choosing its folders are the same few calls from a thread and from Settings → Desktop, so they
 * live here. Choosing a folder in the system's folder dialog is the person's consent to let agents work in it.
 */

export type ThisComputerApi = Pick<AgentEnvironmentsClient, 'list' | 'createEnrollment' | 'approve' | 'updateRoots'>
export type ThisComputerDeps = {
  call: DesktopBridge['call']
  api: ThisComputerApi
  workspaceId: string
  /** Waits between checks while the host starts; replaced in tests. */
  wait?: (ms: number) => Promise<void>
  now?: () => number
}

export const CONNECT_TIMEOUT_MS = 3 * 60_000
const CONNECT_POLL_MS = 1_000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** An environment its owner approved and has not removed. */
export function isUsableEnvironment(environment: AgentEnvironmentResource | null | undefined): environment is AgentEnvironmentResource {
  return Boolean(environment) && environment!.kind === 'local' && environment!.status !== 'pending' && environment!.status !== 'revoked'
}

export function approvedRoots(environment: Pick<AgentEnvironmentResource, 'filesystemGrant'> | null | undefined): string[] {
  const grant = environment?.filesystemGrant
  return grant?.mode === 'selected_roots' ? grant.roots : []
}

/** The folders the person chose, without the work folder Overlay keeps for threads that have no folder. */
export function chosenFolders(roots: string[], workFolder: string | null | undefined): string[] {
  return roots.filter((root) => root !== workFolder)
}

export function folderName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

async function findEnvironment(deps: ThisComputerDeps, environmentId: string): Promise<AgentEnvironmentResource | null> {
  const { environments } = await deps.api.list(deps.workspaceId)
  return environments.find((environment) => environment.id === environmentId) ?? null
}

/**
 * Connects this computer: starts the bundled host, matches the phrase it printed to its pending enrollment and
 * approves it for the work folder. No code is typed and nothing is approved that this app did not just start.
 */
export async function connectThisComputer(deps: ThisComputerDeps): Promise<AgentEnvironmentResource> {
  const wait = deps.wait ?? sleep
  const now = deps.now ?? Date.now
  const before = await deps.call('localComputer.status', undefined)
  const enrollment = await deps.api.createEnrollment(deps.workspaceId)
  await deps.call('agentHost.start', { enrollmentCode: enrollment.code, localTools: true })
  const deadline = now() + CONNECT_TIMEOUT_MS
  while (now() < deadline) {
    const status = await deps.call('localComputer.status', undefined)
    if (status.hostState === 'error') throw new Error('Overlay couldn’t start on this computer. Open the log in Settings → Desktop to see why.')
    if (status.verificationPhrase) {
      const { environments } = await deps.api.list(deps.workspaceId)
      const pending = environments.find((environment) => environment.status === 'pending'
        && environment.verificationPhrase === status.verificationPhrase)
      if (pending) {
        const { environment } = await deps.api.approve(deps.workspaceId, pending.id, { mode: 'selected_roots', roots: [before.workFolder] })
        await deps.call('localComputer.setKeepAvailable', { enabled: true })
        return environment
      }
    }
    await wait(CONNECT_POLL_MS)
  }
  throw new Error('This computer did not finish connecting. Open the log in Settings → Desktop to see why, then try again.')
}

/** This computer's environment, connecting it first when it never connected or was removed. */
export async function ensureThisComputer(deps: ThisComputerDeps, status?: LocalComputerStatus): Promise<AgentEnvironmentResource> {
  const current = status ?? await deps.call('localComputer.status', undefined)
  if (current.environmentId) {
    const existing = await findEnvironment(deps, current.environmentId)
    if (isUsableEnvironment(existing)) {
      // The app was quit or the switch was turned off: start serving again.
      if (current.hostState !== 'running' && current.hostState !== 'starting') {
        await deps.call('localComputer.setKeepAvailable', { enabled: true })
      }
      return existing
    }
  }
  return connectThisComputer(deps)
}

/** Opens the system folder dialog and approves the chosen folder for this computer. Null when cancelled. */
export async function chooseThisComputerFolder(deps: ThisComputerDeps): Promise<{ environment: AgentEnvironmentResource; path: string } | null> {
  const picked = await deps.call('localComputer.chooseFolder', undefined)
  if (!picked) return null
  const path = picked.path.replace(/\/+$/, '') || '/'
  const status = await deps.call('localComputer.status', undefined)
  const environment = await ensureThisComputer(deps, status)
  const roots = approvedRoots(environment)
  if (environment.filesystemGrant?.mode === 'all_user_files' || roots.includes(path)) return { environment, path }
  // The work folder stays first: the host runs there when a thread has no folder.
  const next = [status.workFolder, ...roots.filter((root) => root !== status.workFolder), path]
  const updated = await deps.api.updateRoots(deps.workspaceId, environment.id, { mode: 'selected_roots', roots: next })
  return { environment: updated.environment, path }
}

export async function removeThisComputerFolder(deps: ThisComputerDeps, environment: AgentEnvironmentResource, path: string): Promise<AgentEnvironmentResource> {
  const roots = approvedRoots(environment).filter((root) => root !== path)
  return (await deps.api.updateRoots(deps.workspaceId, environment.id, { mode: 'selected_roots', roots })).environment
}
