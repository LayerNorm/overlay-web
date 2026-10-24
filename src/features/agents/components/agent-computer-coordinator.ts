export type AgentComputerMutation = 'start' | 'stop' | 'control' | 'delete'

export type AgentComputerRequestToken = {
  scope: string
  generation: number
  id: number
  kind: AgentComputerMutation
}

export type AgentComputerRefreshToken = {
  scope: string
  generation: number
  revision: number
}

export class AgentComputerCoordinator {
  private scope: string | null = null
  private generation = 0
  private nextId = 0
  private active: AgentComputerRequestToken | null = null
  private queuedRefresh = false
  private refreshRevision = 0

  setScope(scope: string | null) {
    if (scope === this.scope) return
    this.scope = scope
    this.generation += 1
    this.active = null
    this.queuedRefresh = false
  }

  invalidate() {
    this.generation += 1
    this.scope = null
    this.active = null
    this.queuedRefresh = false
  }

  acceptSnapshot(scope: string | null) {
    if (!scope || this.scope !== scope || this.active) return false
    this.generation += 1
    return true
  }

  beginMutation(kind: AgentComputerMutation): AgentComputerRequestToken | null {
    if (!this.scope || this.active) return null
    const token = { scope: this.scope, generation: ++this.generation, id: ++this.nextId, kind }
    this.active = token
    return token
  }

  beginRefresh(): AgentComputerRefreshToken | null {
    if (!this.scope) return null
    if (this.active) {
      this.queuedRefresh = true
      return null
    }
    return { scope: this.scope, generation: ++this.generation, revision: ++this.refreshRevision }
  }

  isCurrent(token: AgentComputerRequestToken | AgentComputerRefreshToken) {
    return token.scope === this.scope && token.generation === this.generation
      && ('id' in token ? this.active?.id === token.id : true)
  }

  finishMutation(token: AgentComputerRequestToken) {
    if (this.active?.id !== token.id || !this.isCurrent(token)) return false
    this.active = null
    const refresh = this.queuedRefresh
    this.queuedRefresh = false
    return refresh
  }

  getBusyKind() {
    return this.active?.kind ?? null
  }

  async mutate<T>(kind: AgentComputerMutation, work: () => Promise<T>, callbacks: {
    start(): void
    apply(value: T): void
    error(error: unknown): void
    finish(refreshQueued: boolean): void
  }): Promise<T | null> {
    const token = this.beginMutation(kind)
    if (!token) return null
    callbacks.start()
    try {
      const result = await work()
      if (!this.isCurrent(token)) return null
      callbacks.apply(result)
      return result
    } catch (error) {
      if (this.isCurrent(token)) callbacks.error(error)
      return null
    } finally {
      if (this.isCurrent(token)) callbacks.finish(this.finishMutation(token))
    }
  }
}
