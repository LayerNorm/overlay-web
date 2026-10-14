import 'server-only'

import { randomUUID } from 'node:crypto'
import { adminConvexClient as convex } from '../convex-admin'
import type { AuditEventRecord, AuditRepository } from './AuditRepository'
import { sanitizeAuditMetadata } from './AuditRepository'

type ConvexAuditRow = Omit<AuditEventRecord, 'id' | 'metadata'> & {
  eventId: string
  metadataJson: string
}

export class ConvexAuditRepository implements AuditRepository {
  async append(args: Omit<AuditEventRecord, 'id' | 'createdAt'> & {
    createdAt?: number
    id?: string
  }): Promise<AuditEventRecord> {
    const { id, metadata, ...event } = args
    const row = await convex.mutation<ConvexAuditRow>(
      'admin/administration:appendAuditByServer',
      {
        ...event,
        eventId: id ?? `audit_${randomUUID()}`,
        metadataJson: JSON.stringify(sanitizeAuditMetadata(metadata)),
        createdAt: args.createdAt ?? Date.now(),
      },
      { throwOnError: true },
    )
    if (!row) throw new Error('Failed to append audit event')
    return fromRow(row)
  }

  async list(args: Parameters<AuditRepository['list']>[0] = {}): Promise<AuditEventRecord[]> {
    const rows = await convex.query<ConvexAuditRow[]>(
      'admin/administration:listAuditByServer',
      { ...args },
      { throwOnError: true },
    ) ?? []
    return rows.map(fromRow)
  }
}

function fromRow(row: ConvexAuditRow): AuditEventRecord {
  const { eventId, metadataJson, _id: _, _creationTime: __, ...event } = row as ConvexAuditRow & {
    _id?: string
    _creationTime?: number
  }
  return {
    ...event,
    id: eventId,
    metadata: JSON.parse(metadataJson) as Record<string, unknown>,
  }
}
