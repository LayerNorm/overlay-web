import AsyncStorage from '@react-native-async-storage/async-storage'
import type { WorkspaceSummary } from '@overlay/workspace-contracts'
import { mobileOverlayAppClient } from './overlayClient'
import { setRequestWorkspaceId } from './appApi'
import { api, queryConvex, subscribeConvex } from './convexClient'

const ACTIVE_WORKSPACE_STORAGE_KEY = 'overlay_mobile_active_workspace_id'

/** Returns true when the summary refers to the user's personal workspace. */
export function isPersonalWorkspace(workspace: WorkspaceSummary): boolean {
  return workspace.kind === 'personal'
}

/**
 * Loads the locally persisted selection. The server also stores an active
 * workspace per user; the persisted value lets requests carry the right
 * `x-overlay-workspace-id` header before `/workspaces` responds.
 */
export async function loadPersistedWorkspaceId(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)
    return value && value.trim().length > 0 ? value.trim() : null
  } catch {
    return null
  }
}

export async function persistWorkspaceId(workspaceId: string | null): Promise<void> {
  try {
    if (workspaceId) {
      await AsyncStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId)
    } else {
      await AsyncStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY)
    }
  } catch {
    // Preference persistence is best-effort; a lost write just means the
    // selection resets next launch.
  }
}

/** Fetches the workspace list + server-side active workspace id. */
export async function fetchWorkspaces(): Promise<{
  workspaces: WorkspaceSummary[]
  activeWorkspaceId: string
}> {
  const response = await queryConvex(api.collaboration.directory.workspaces, {})
  return {
    workspaces: response?.workspaces ?? [],
    activeWorkspaceId: response?.activeWorkspaceId ?? '',
  }
}

export function subscribeWorkspaces(onValue: (value: { workspaces: WorkspaceSummary[]; activeWorkspaceId: string }) => void) {
  return subscribeConvex(api.collaboration.directory.workspaces, {}, value => onValue({ workspaces: value?.workspaces ?? [], activeWorkspaceId: value?.activeWorkspaceId ?? '' }))
}

/**
 * Persists the active workspace on the server (source of truth shared with
 * web) and locally so subsequent requests carry the workspace header.
 * `workspaceId` must be a real workspace id — personal included.
 */
export async function activateWorkspace(workspaceId: string): Promise<void> {
  await mobileOverlayAppClient.workspaces.activate(workspaceId)
  setRequestWorkspaceId(workspaceId)
  await persistWorkspaceId(workspaceId)
}

/** Applies a workspace selection locally without a server round-trip. */
export function applyWorkspaceLocally(workspaceId: string | null): void {
  setRequestWorkspaceId(workspaceId)
  void persistWorkspaceId(workspaceId)
}
