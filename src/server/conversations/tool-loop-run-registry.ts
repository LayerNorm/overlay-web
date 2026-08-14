import 'server-only'

type ToolLoopRunRegistry = Map<string, AbortController>

const registry = globalThis as typeof globalThis & {
  __overlayToolLoopRuns?: ToolLoopRunRegistry
}

function getRegistry(): ToolLoopRunRegistry {
  registry.__overlayToolLoopRuns ??= new Map()
  return registry.__overlayToolLoopRuns
}

export function registerToolLoopRun(runId: string | undefined, controller: AbortController): () => void {
  if (!runId) return () => undefined
  const runs = getRegistry()
  runs.set(runId, controller)
  return () => {
    if (runs.get(runId) === controller) runs.delete(runId)
  }
}

export function abortToolLoopRuns(runIds: readonly string[]): number {
  const runs = getRegistry()
  let aborted = 0
  for (const runId of runIds) {
    const controller = runs.get(runId)
    if (!controller) continue
    controller.abort('cancelled_by_user')
    runs.delete(runId)
    aborted += 1
  }
  return aborted
}
