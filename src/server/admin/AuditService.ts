import 'server-only'

import type { AuditActorType, AuditOutcome, AuditRepository } from './AuditRepository'

export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async record(args: {
    action: string
    actorApiKeyId?: string
    actorType: AuditActorType
    actorUserId?: string
    ipAddress?: string
    metadata?: Record<string, unknown>
    outcome: AuditOutcome
    requestId?: string
    resourceId?: string
    resourceType: string
  }): Promise<void> {
    await this.repository.append({
      ...args,
      metadata: args.metadata ?? {},
    })
  }

  async list(args: Parameters<AuditRepository['list']>[0]) {
    return await this.repository.list(args)
  }
}
