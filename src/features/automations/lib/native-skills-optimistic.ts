import type { OptimisticLocalStore } from 'convex/browser'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../../../convex/_generated/api'

type Detail = NonNullable<FunctionReturnType<typeof api.integrations.nativeSkills.get>>
type Change = Partial<Pick<Detail, 'name' | 'description' | 'instructions' | 'enabled' | 'scope' | 'archivedAt' | 'archivedFromScope'>>

// Convex replays these entity patches over the newest server state when any mutation settles.
export function optimisticallyChangeSkill(
  store: OptimisticLocalStore,
  args: { workspaceId: string; skillId: string; expectedRevision: number },
  change: Change | null,
) {
  const belongs = (row: { _id: string; revision: number }) => row._id === args.skillId && row.revision === args.expectedRevision
  const apply = <T extends { _id: string; revision: number }>(row: T) => ({ ...row, ...change, revision: row.revision + 1 })
  for (const entry of store.getAllQueries(api.integrations.nativeSkills.get)) {
    if (entry.args.workspaceId !== args.workspaceId || !entry.value || !belongs(entry.value)) continue
    store.setQuery(api.integrations.nativeSkills.get, entry.args, change === null ? null : apply(entry.value))
  }
  for (const entry of store.getAllQueries(api.integrations.nativeSkills.list)) {
    if (entry.args.workspaceId !== args.workspaceId || !entry.value) continue
    const page = entry.value.page.flatMap(row => {
      if (!belongs(row)) return [row]
      if (change === null) return []
      const next = apply(row)
      const view = next.archivedAt !== undefined ? 'archived' : next.scope
      return view === entry.args.view ? [next] : []
    })
    store.setQuery(api.integrations.nativeSkills.list, entry.args, { ...entry.value, page })
  }
  for (const entry of store.getAllQueries(api.integrations.nativeSkills.availability)) {
    if (entry.args.workspaceId !== args.workspaceId || entry.args.legacyPersonal || !entry.value) continue
    const page = entry.value.page.flatMap(row => {
      if (!belongs(row)) return [row]
      if (change === null || change.enabled === false || change.archivedAt !== undefined
        || (entry.args.workspaceOnly && change.scope === 'personal')) return []
      return [{ ...row, name: change.name ?? row.name, description: change.description ?? row.description, revision: row.revision + 1 }]
    })
    store.setQuery(api.integrations.nativeSkills.availability, entry.args, { ...entry.value, page })
  }
}
