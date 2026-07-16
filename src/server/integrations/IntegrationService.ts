import 'server-only'

import type { AuditService } from '@/server/admin'
import { DefaultIntegrationPolicyEvaluator } from './DefaultIntegrationPolicyEvaluator'
import type { IntegrationProvider, IntegrationPolicyEvaluator } from './contracts'

export class IntegrationService {
  constructor(
    private readonly provider: IntegrationProvider,
    private readonly audit?: AuditService,
    private readonly policy: IntegrationPolicyEvaluator = new DefaultIntegrationPolicyEvaluator(),
  ) {}

  get id() {
    return this.provider.id
  }

  get capabilities() {
    return this.provider.capabilities
  }

  async health() {
    return await this.provider.health()
  }

  async listCatalog(args: Parameters<IntegrationProvider['listCatalog']>[0]) {
    return await this.provider.listCatalog(args)
  }

  async listConnected(args: { accessToken?: string; userId: string }) {
    const connections = await this.provider.listConnections(args)
    const uniqueKeys = [...new Set(connections.map((item) => item.providerKey))]
    const items = (await Promise.all(uniqueKeys.map((providerKey) =>
      this.provider.getCatalogEntry({ ...args, providerKey }),
    ))).filter((item): item is NonNullable<typeof item> => item !== null)
    return { connections, items }
  }

  async connect(args: Parameters<IntegrationProvider['beginConnection']>[0]) {
    const decision = this.policy.evaluate({ capabilities: this.capabilities, operation: 'connect' })
    if (!decision.allowed) throw new Error(decision.reason ?? 'Connection denied')
    try {
      const result = await this.provider.beginConnection(args)
      await this.record('integration.connection.begin', args.userId, args.providerKey, 'success', {
        provider: this.id,
        status: result.status,
      })
      return result
    } catch (error) {
      await this.record('integration.connection.begin', args.userId, args.providerKey, 'failure', {
        provider: this.id,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async disconnect(args: Parameters<IntegrationProvider['disconnect']>[0]) {
    const decision = this.policy.evaluate({ capabilities: this.capabilities, operation: 'disconnect' })
    if (!decision.allowed) {
      await this.record('integration.connection.delete', args.userId, args.providerKey, 'failure', {
        provider: this.id,
        denied: true,
        reason: decision.reason,
      })
      throw new Error(decision.reason ?? 'Disconnect denied')
    }
    try {
      await this.provider.disconnect(args)
      await this.record('integration.connection.delete', args.userId, args.providerKey, 'success', {
        provider: this.id,
      })
    } catch (error) {
      await this.record('integration.connection.delete', args.userId, args.providerKey, 'failure', {
        provider: this.id,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async deleteConnectionsForUser(args: { accessToken?: string; userId: string }) {
    const count = await this.provider.deleteConnectionsForUser(args)
    await this.record('integration.connection.account_cleanup', args.userId, args.userId, 'success', {
      provider: this.id,
      deletedConnectionCount: count,
      lifecycle: this.capabilities.connectionLifecycle,
    })
    return count
  }

  private async record(
    action: string,
    userId: string,
    providerKey: string,
    outcome: 'success' | 'failure',
    metadata: Record<string, unknown>,
  ) {
    if (!this.audit) return
    await this.audit.record({
      action,
      actorType: 'user',
      actorUserId: userId,
      resourceType: 'integration_connection',
      resourceId: providerKey,
      outcome,
      metadata,
    }).catch((_error) => undefined)
  }
}
