/** Convex fixture registry. Each entry answers one Convex function by name ("module/path:function"). */
type Args = Record<string, unknown>
type Resolver = (args: Args) => unknown

const queries = new Map<string, Resolver>()
const mutations = new Map<string, Resolver>()
const listeners = new Set<() => void>()
let version = 0

export const missing = new Set<string>()
if (typeof window !== 'undefined') (window as unknown as { __mockupMissing: Set<string> }).__mockupMissing = missing

export function defineQueries(entries: Record<string, Resolver | unknown>) {
  for (const [name, value] of Object.entries(entries)) queries.set(name, typeof value === 'function' ? (value as Resolver) : () => value)
}

export function defineMutations(entries: Record<string, (args: never) => unknown>) {
  for (const [name, value] of Object.entries(entries)) mutations.set(name, value as Resolver)
}

const cache = new Map<string, { version: number; value: unknown }>()

/** Like Convex, a query answers the same object until its data changes, so effects that depend on it settle. */
export function resolveQuery(name: string, args: Args) {
  const key = name + ' ' + JSON.stringify(args)
  const cached = cache.get(key)
  if (cached && cached.version === version) return cached.value
  const value = computeQuery(name, args)
  cache.set(key, { version, value })
  return value
}

function computeQuery(name: string, args: Args) {
  const resolver = queries.get(name)
  if (typeof window !== 'undefined' && globalThis.location.search.includes('trace')) console.debug('[mockup] query', name, JSON.stringify(args))
  if (!resolver) {
    if (!missing.has('query ' + name)) {
      missing.add('query ' + name)
      console.warn('[mockup] no fixture for query', name, args)
    }
    return undefined
  }
  return resolver(args)
}

export async function resolveMutation(name: string, args: Args) {
  const resolver = mutations.get(name)
  if (!resolver) {
    console.info('[mockup] mutation ignored', name, args)
    return null
  }
  const result = resolver(args)
  notifyFixtures()
  return result
}

export function notifyFixtures() {
  version += 1
  listeners.forEach((listener) => listener())
}

export function subscribeFixtures(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function fixtureVersion() {
  return version
}
