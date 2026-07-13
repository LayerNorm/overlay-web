import 'server-only'

export type AuditActorType = 'user' | 'api_key' | 'service' | 'system'
export type AuditOutcome = 'success' | 'denied' | 'failure'

export type AuditEventRecord = {
  id: string
  actorType: AuditActorType
  actorUserId?: string
  actorApiKeyId?: string
  action: string
  resourceType: string
  resourceId?: string
  outcome: AuditOutcome
  requestId?: string
  ipAddress?: string
  metadata: Record<string, unknown>
  createdAt: number
}

export interface AuditRepository {
  append(args: Omit<AuditEventRecord, 'id' | 'createdAt'> & {
    createdAt?: number
    id?: string
  }): Promise<AuditEventRecord>
  list(args?: {
    action?: string
    actorUserId?: string
    before?: number
    limit?: number
    resourceType?: string
  }): Promise<AuditEventRecord[]>
}
