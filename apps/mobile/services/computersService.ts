import type {
  Computer,
  ComputerOwnerType,
  ComputerSize,
} from '@overlay/workspace-contracts'
import { mobileOverlayAppClient } from './overlayClient'

/**
 * Workspace computers (`/api/v1/computers*`). All calls are workspace-scoped —
 * the client sends `x-overlay-workspace-id` itself, so the workspace id is a
 * required argument rather than the ambient request header.
 */

export type { Computer, ComputerOwnerType, ComputerSize }

export const COMPUTER_SIZES: readonly ComputerSize[] = ['small', 'default', 'large']

export type ComputerDesktopTicket = {
  url: string
  mode: 'webrtc' | 'vnc' | 'other'
  expiresAt: number | null
}

export async function listComputers(workspaceId: string): Promise<Computer[]> {
  const response = await mobileOverlayAppClient.computers.list(workspaceId)
  return response.computers ?? []
}

export async function provisionComputer(
  workspaceId: string,
  input: {
    ownerType: ComputerOwnerType
    ownerId: string
    size?: ComputerSize
    name?: string
  },
): Promise<Computer> {
  const response = await mobileOverlayAppClient.computers.provision(workspaceId, input)
  return response.computer
}

export async function startComputer(workspaceId: string, computerId: string): Promise<Computer> {
  const response = await mobileOverlayAppClient.computers.start(workspaceId, computerId)
  return response.computer
}

export async function stopComputer(workspaceId: string, computerId: string): Promise<Computer> {
  const response = await mobileOverlayAppClient.computers.stop(workspaceId, computerId)
  return response.computer
}

/**
 * Mints a short-lived desktop-stream ticket. The returned URL is a bearer
 * secret — open it in the in-app browser, never log or persist it.
 */
export async function openComputerDesktop(
  workspaceId: string,
  computerId: string,
): Promise<ComputerDesktopTicket> {
  return mobileOverlayAppClient.computers.openDesktop(workspaceId, computerId)
}

export async function destroyComputer(workspaceId: string, computerId: string): Promise<void> {
  const response = await mobileOverlayAppClient.computers.destroy(workspaceId, computerId)
  if (!response.ok) {
    throw new Error(`Could not destroy computer (HTTP ${response.status})`)
  }
}
