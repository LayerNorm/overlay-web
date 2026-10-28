import 'server-only'
import type { Session } from '@overlay/app-core'

export type AuthenticatedUserWriter = { upsertFromSession(session: Pick<Session, 'user'>): Promise<unknown> }

/** Password sessions and retained cookies need the same profile bootstrap as OAuth. */
export class AuthenticatedUserInitializer {
  private readonly completed = new Map<string, number>()
  private readonly pending = new Map<string, Promise<void>>()

  constructor(private readonly users?: AuthenticatedUserWriter, private readonly now = Date.now) {}

  async initialize(session: Session | null): Promise<Session | null> {
    if (!session || !this.users) return session
    const userId = session.user.id
    const completedAt = this.completed.get(userId)
    if (completedAt !== undefined && this.now() - completedAt < 60_000) return session
    let pending = this.pending.get(userId)
    if (!pending) {
      pending = this.users.upsertFromSession(session).then(() => {
        if (this.completed.size >= 1_000) this.completed.delete(this.completed.keys().next().value!)
        this.completed.set(userId, this.now())
      }).finally(() => { this.pending.delete(userId) })
      this.pending.set(userId, pending)
    }
    await pending
    return session
  }
}
