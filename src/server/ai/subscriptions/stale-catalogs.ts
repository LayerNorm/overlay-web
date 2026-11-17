import 'server-only'

import type { SubscriptionService } from './service'

const catalogMaxAgeMs = 6 * 60 * 60_000
const catalogRetryMs = 10 * 60_000
const catalogAttempts = new Map<string, number>()

export async function refreshStaleSubscriptionCatalogs(
  service: Pick<SubscriptionService, 'isEnabled' | 'discover'>,
  userId: string,
  connections: Array<{
    _id: string
    authKind?: string
    subscriptionProvider?: string
    canManage?: boolean
    status: string
    discoveredAt?: number
  }>,
  now = Date.now(),
): Promise<boolean> {
  const stale = connections.filter((connection) =>
    connection.authKind === 'subscription' &&
    connection.canManage !== false &&
    connection.status === 'active' &&
    service.isEnabled(connection.subscriptionProvider) &&
    (connection.discoveredAt ?? 0) <= now - catalogMaxAgeMs &&
    (catalogAttempts.get(connection._id) ?? 0) <= now - catalogRetryMs
  )
  const results = await Promise.all(stale.map(async (connection) => {
    catalogAttempts.set(connection._id, now)
    try {
      return (await service.discover(userId, connection._id)).status === 'connected'
    } catch (_error) {
      return false
    }
  }))
  return results.includes(true)
}
