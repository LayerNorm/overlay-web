import 'server-only'

import {
  isDesktopSandboxInstance,
  type DesktopStreamTicket,
  type SandboxInstance,
} from '@overlay/sandbox-runtime'
import type { AgentEnvironment, AgentSandboxLease } from '@overlay/workspace-contracts'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import { managedSandboxRuntimeFromEnv } from './ManagedAgentSandboxService'

/**
 * An Overlay Cloud environment's sandbox IS the agent's machine — this module
 * resolves "the box behind an environment" so computer tools and the desktop
 * viewer treat managed environments and computer rows as one primitive instead
 * of provisioning a second VM.
 */

const DESKTOP_TICKET_POLL_MS = 2_000
const DESKTOP_TICKET_DEADLINE_MS = 60_000

export type EnvironmentMachine = {
  environment: AgentEnvironment
  lease: AgentSandboxLease
  instance: SandboxInstance
}

function repo() {
  return getOverlayServerContext().appData.repositories.connectedAgents
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function machineForLease(
  environment: AgentEnvironment,
  lease: AgentSandboxLease | null,
): Promise<EnvironmentMachine | null> {
  if (!lease?.providerReference) return null
  if (environment.kind !== 'overlay_cloud' || environment.status === 'revoked') return null
  try {
    const runtime = managedSandboxRuntimeFromEnv(lease.provider)
    const instance = await runtime.reconnect(lease.providerReference, { resume: true })
    return { environment, lease, instance }
  } catch (error) {
    logger.warn('[environment-machine] reconnect failed', {
      environmentId: environment.id,
      provider: lease.provider,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * The sandbox backing an agent's bound Overlay Cloud environment, if any.
 * Returns null when the agent has no enabled binding to a managed environment —
 * callers fall back to the computer row or report "no machine bound".
 */
export async function machineForAgent(args: {
  workspaceId: string
  agentId: string
}): Promise<EnvironmentMachine | null> {
  const repository = repo()
  const bindings = await repository.listBindings({
    workspaceId: args.workspaceId,
    agentId: args.agentId,
  })
  for (const binding of bindings.filter((candidate) => candidate.enabled)) {
    const environment = await repository.getEnvironment({
      workspaceId: args.workspaceId,
      environmentId: binding.environmentId,
    })
    if (!environment || environment.kind !== 'overlay_cloud') continue
    const lease = await repository.getActiveSandboxLease({
      workspaceId: args.workspaceId,
      environmentId: environment.id,
    })
    const machine = await machineForLease(environment, lease)
    if (machine) return machine
  }
  return null
}

export async function machineForEnvironment(args: {
  workspaceId: string
  environmentId: string
}): Promise<EnvironmentMachine | null> {
  const repository = repo()
  const environment = await repository.getEnvironment({
    workspaceId: args.workspaceId,
    environmentId: args.environmentId,
  })
  if (!environment) return null
  const lease = await repository.getActiveSandboxLease({
    workspaceId: args.workspaceId,
    environmentId: environment.id,
  })
  return machineForLease(environment, lease)
}

/** Stamp activity so the lease meter's idle-stop window resets on use. */
export async function touchEnvironmentMachine(machine: EnvironmentMachine): Promise<void> {
  const now = Date.now()
  await repo().patchSandboxLeaseUsage({
    workspaceId: machine.lease.workspaceId,
    leaseId: machine.lease.id,
    patch: { lastActiveAt: now },
    now,
  }).catch((error) => {
    logger.warn('[environment-machine] lease activity stamp failed', {
      leaseId: machine.lease.id,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

/**
 * Desktop stream ticket for an environment's box. Membership in the workspace
 * (enforced by the BFF context upstream) is the access bar — the ticket URL is
 * a bearer secret and is never logged.
 */
export async function openEnvironmentDesktop(args: {
  workspaceId: string
  environmentId: string
  mode?: 'webrtc' | 'vnc'
}): Promise<DesktopStreamTicket> {
  const machine = await machineForEnvironment(args)
  if (!machine) {
    throw new EnvironmentMachineError('This environment has no running machine', 'not_found')
  }
  if (!isDesktopSandboxInstance(machine.instance)) {
    throw new EnvironmentMachineError('This environment has no desktop', 'no_desktop')
  }
  if (await machine.instance.status() === 'stopped') {
    await machine.instance.resume()
  }
  const deadline = Date.now() + DESKTOP_TICKET_DEADLINE_MS
  for (;;) {
    const ticket = await machine.instance.desktop({ mode: args.mode })
    if (ticket.ready) {
      await touchEnvironmentMachine(machine)
      return ticket
    }
    if (Date.now() > deadline) {
      throw new EnvironmentMachineError('The desktop stream is still preparing', 'desktop_preparing')
    }
    await sleep(DESKTOP_TICKET_POLL_MS)
  }
}

export class EnvironmentMachineError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'no_desktop' | 'desktop_preparing',
  ) {
    super(message)
    this.name = 'EnvironmentMachineError'
  }
}
