import type { Computer } from '@overlay/workspace-contracts'

export function createComputerRecipe(computer: Computer, sessionMs: number) {
  const size = computer.size
  return {
    name: computer.name ?? `computer-${computer.id}`,
    persistent: true,
    environment: {
      OVERLAY_WORKSPACE_ID: computer.workspaceId,
      OVERLAY_COMPUTER_ID: computer.id,
      OVERLAY_OWNER_TYPE: computer.ownerType,
      OVERLAY_OWNER_ID: computer.ownerId,
    },
    networkPolicy: { mode: 'allow_all' as const },
    idleTimeoutMs: 0,
    hardTimeoutMs: sessionMs,
    resources: {
      vcpus: size === 'small' ? 2 : size === 'large' ? 8 : 4,
      memoryGiB: size === 'small' ? 4 : size === 'large' ? 16 : 8,
      diskGiB: size === 'small' ? 40 : size === 'large' ? 100 : 80,
    },
  }
}

export function hasMatchingStoppedEvidence(
  computer: Computer,
  usage: Record<string, unknown>,
  providerReference?: string,
): boolean {
  const evidence = usage.lastProviderEvidence as {
    stopped?: boolean
    providerReference?: string
    usage?: unknown
  } | undefined
  const reference = providerReference ?? computer.providerRef ?? undefined
  return Boolean(reference && evidence?.stopped && evidence.providerReference === reference
    && usage.meteredProviderReference === reference
    && evidence.usage && typeof evidence.usage === 'object')
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isMissingSandboxError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /404|not found|does not exist|gone/i.test(message)
}
