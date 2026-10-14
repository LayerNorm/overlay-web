/**
 * Structure rules for tasks: parent links form a shallow tree, and "blocked by" links form a graph with no cycles.
 * Pure functions over a lookup, so Convex enforces exactly what the UI previews.
 */
import { WORK_LIMITS } from './status'

export type ParentLookup = (id: string) => string | null | undefined
export type BlockedByLookup = (id: string) => ReadonlyArray<string> | null | undefined

/** Ids above `id`, nearest first. Stops at a cycle or the depth cap. */
export function ancestorsOf(id: string, parentOf: ParentLookup): string[] {
  const chain: string[] = []
  const seen = new Set<string>([id])
  let current = parentOf(id) ?? null
  while (current && !seen.has(current) && chain.length <= WORK_LIMITS.maxDepth) {
    chain.push(current)
    seen.add(current)
    current = parentOf(current) ?? null
  }
  return chain
}

/** Levels in the tree under `id` (a task with no children is 1). */
export function subtreeHeight(id: string, childrenOf: (id: string) => ReadonlyArray<string>, seen = new Set<string>()): number {
  if (seen.has(id)) return 0
  seen.add(id)
  let tallest = 0
  for (const child of childrenOf(id)) tallest = Math.max(tallest, subtreeHeight(child, childrenOf, seen))
  return 1 + tallest
}

export type ParentCheck = { ok: true } | { ok: false; reason: 'self' | 'descendant' | 'too_deep' }

/**
 * Whether `id` may sit under `parentId`: not under itself or one of its own descendants, and not so deep that the chain
 * (ancestors of the parent, the parent, `id` and everything below `id`) passes the depth cap.
 */
export function checkParent(args: {
  id: string
  parentId: string
  parentOf: ParentLookup
  childrenOf: (id: string) => ReadonlyArray<string>
}): ParentCheck {
  if (args.parentId === args.id) return { ok: false, reason: 'self' }
  const above = ancestorsOf(args.parentId, args.parentOf)
  if (above.includes(args.id)) return { ok: false, reason: 'descendant' }
  const depth = above.length + 1 + subtreeHeight(args.id, args.childrenOf)
  if (depth > WORK_LIMITS.maxDepth) return { ok: false, reason: 'too_deep' }
  return { ok: true }
}

/** Every id reachable below `id` through child links. */
export function descendantsOf(id: string, childrenOf: (id: string) => ReadonlyArray<string>): string[] {
  const out: string[] = []
  const seen = new Set<string>([id])
  const queue = [...childrenOf(id)]
  while (queue.length > 0) {
    const next = queue.shift() as string
    if (seen.has(next)) continue
    seen.add(next)
    out.push(next)
    queue.push(...childrenOf(next))
  }
  return out
}

export type BlockedByCheck = { ok: true } | { ok: false; reason: 'self' | 'cycle' | 'too_many' }

/**
 * Whether `id` may be blocked by every id in `blockers`. A cycle exists when a blocker is already (transitively)
 * blocked by `id`.
 */
export function checkBlockedBy(args: { id: string; blockers: ReadonlyArray<string>; blockedByOf: BlockedByLookup }): BlockedByCheck {
  const unique = [...new Set(args.blockers)]
  if (unique.length > WORK_LIMITS.blockedBy) return { ok: false, reason: 'too_many' }
  if (unique.includes(args.id)) return { ok: false, reason: 'self' }
  const seen = new Set<string>()
  const stack = [...unique]
  while (stack.length > 0) {
    const current = stack.pop() as string
    if (current === args.id) return { ok: false, reason: 'cycle' }
    if (seen.has(current)) continue
    seen.add(current)
    stack.push(...(args.blockedByOf(current) ?? []))
  }
  return { ok: true }
}

export function workGraphErrorMessage(reason: string): string {
  switch (reason) {
    case 'self': return 'A task cannot be inside or blocked by itself.'
    case 'descendant': return 'A task cannot be moved inside one of its own subtasks.'
    case 'too_deep': return 'Tasks can only be nested a few levels deep.'
    case 'cycle': return 'That would make two tasks wait on each other.'
    case 'too_many': return 'A task can be blocked by up to 50 others.'
    default: return 'That is not allowed.'
  }
}
