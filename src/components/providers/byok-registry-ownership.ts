import type { ByokConnectionRow } from '@/shared/ai/gateway/byok-model-conversion'

export class ByokRegistryOwnership {
  private readonly subscribers = new Map<string, number>()
  private scopeKey: string | null = null

  constructor(private readonly register: (connections: ByokConnectionRow[]) => void) {}

  get activeScopeKey(): string | null {
    return this.scopeKey
  }

  isActive(scopeKey: string): boolean {
    return this.scopeKey === scopeKey
  }

  subscribe(
    scopeKey: string,
    cachedConnections: (scopeKey: string) => ByokConnectionRow[] | null,
  ): () => void {
    this.subscribers.set(scopeKey, (this.subscribers.get(scopeKey) ?? 0) + 1)
    if (this.scopeKey !== scopeKey) {
      this.scopeKey = scopeKey
      this.register(cachedConnections(scopeKey) ?? [])
    }

    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      const count = this.subscribers.get(scopeKey) ?? 0
      if (count > 1) {
        this.subscribers.set(scopeKey, count - 1)
        return
      }
      this.subscribers.delete(scopeKey)
      if (this.scopeKey !== scopeKey) return
      this.scopeKey = [...this.subscribers.keys()].at(-1) ?? null
      this.register(this.scopeKey ? cachedConnections(this.scopeKey) ?? [] : [])
    }
  }

  publish(scopeKey: string, connections: ByokConnectionRow[]): boolean {
    if (!this.isActive(scopeKey)) return false
    this.register(connections)
    return true
  }
}
