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

export function sanitizeAuditMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizeObject(value, 0)
}

function sanitizeObject(value: Record<string, unknown>, depth: number): Record<string, unknown> {
  if (depth > 4) return { truncated: true }
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value).slice(0, 50)) {
    if (/(secret|token|password|authorization|cookie|api.?key)/i.test(key)) {
      result[key] = '[REDACTED]'
    } else if (typeof item === 'string') {
      result[key] = item.slice(0, 1000)
    } else if (Array.isArray(item)) {
      result[key] = item.slice(0, 50).map((entry) =>
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? sanitizeObject(entry as Record<string, unknown>, depth + 1)
          : typeof entry === 'string' ? entry.slice(0, 1000) : entry,
      )
    } else if (item && typeof item === 'object') {
      result[key] = sanitizeObject(item as Record<string, unknown>, depth + 1)
    } else {
      result[key] = item
    }
  }
  return result
}
