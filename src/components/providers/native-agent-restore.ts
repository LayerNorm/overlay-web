import type { ConvexReactClient } from 'convex/react'
import { api } from '../../../convex/_generated/api'

export function waitForArchivedRevision(convex: ConvexReactClient, workspaceId: string, agentId: string, signal: AbortSignal): Promise<string> {
  const watch = convex.watchQuery(api.agents.nativeDirectory.get, { workspaceId, agentId, includeArchived: true })
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {}
    const finish = (revision?: string, error?: unknown) => {
      clearTimeout(timer)
      unsubscribe()
      signal.removeEventListener('abort', abort)
      if (revision) resolve(revision)
      else reject(error)
    }
    const abort = () => finish(undefined, new Error('Native agent directory is unavailable'))
    const timer = setTimeout(() => finish(undefined, new Error('Agent archive is still syncing. Retry Undo.')), 10_000)
    const read = () => {
      try {
        const agent = watch.localQueryResult()
        if (agent === null || (agent && (agent.id !== agentId || agent.workspaceId !== workspaceId))) {
          finish(undefined, new Error('The archived agent is no longer available'))
        } else if (agent?.archivedAt !== undefined) {
          finish(agent.revision)
        }
      } catch (error) { finish(undefined, error) }
    }
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    unsubscribe = watch.onUpdate(read)
    read()
  })
}
