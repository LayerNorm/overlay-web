import 'server-only'

import type { AuthorizationCapability } from '@overlay/authz-contracts'
import type { AuthorizationService } from '@/server/authorization'
import type { DurableJob } from './DurableJobRepository'

export const DURABLE_JOB_AUTHORIZATION_KEY = '_authorization'

export type DurableJobAuthorizationRequirement = {
  actorUserId: string
  requiredCapabilities: AuthorizationCapability[]
}

export function durableJobAuthorization(
  actorUserId: string,
  requiredCapabilities: readonly AuthorizationCapability[],
): Record<string, DurableJobAuthorizationRequirement> {
  return {
    [DURABLE_JOB_AUTHORIZATION_KEY]: {
      actorUserId,
      requiredCapabilities: [...new Set(requiredCapabilities)],
    },
  }
}

export async function authorizeDurableJob(args: {
  authorization: AuthorizationService
  job: DurableJob
}): Promise<{
  allowed: boolean
  actorUserId?: string
  deniedCapabilities: AuthorizationCapability[]
  reason?: 'authorization_metadata_missing' | 'authorization_revoked'
}> {
  const requirement = parseRequirement(args.job.payload[DURABLE_JOB_AUTHORIZATION_KEY])
  if (!requirement) {
    return {
      allowed: false,
      deniedCapabilities: [],
      reason: 'authorization_metadata_missing',
    }
  }
  const subject = await args.authorization.resolveSubject(requirement.actorUserId)
  const deniedCapabilities = requirement.requiredCapabilities.filter((capability) => (
    !args.authorization.checkResolvedCapability(subject, capability).allowed
  ))
  return {
    allowed: deniedCapabilities.length === 0,
    actorUserId: requirement.actorUserId,
    deniedCapabilities,
    ...(deniedCapabilities.length > 0 ? { reason: 'authorization_revoked' as const } : {}),
  }
}

function parseRequirement(value: unknown): DurableJobAuthorizationRequirement | null {
  if (!value || typeof value !== 'object') return null
  const actorUserId = 'actorUserId' in value ? value.actorUserId : undefined
  const requiredCapabilities = 'requiredCapabilities' in value ? value.requiredCapabilities : undefined
  if (typeof actorUserId !== 'string' || !actorUserId.trim() || !Array.isArray(requiredCapabilities)) {
    return null
  }
  if (!requiredCapabilities.every((capability) => typeof capability === 'string')) return null
  return {
    actorUserId: actorUserId.trim(),
    requiredCapabilities: requiredCapabilities as AuthorizationCapability[],
  }
}
