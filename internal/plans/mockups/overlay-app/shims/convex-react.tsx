import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { getFunctionName } from 'convex/server'
import { resolveMutation, resolveQuery, subscribeFixtures, fixtureVersion } from '../fixtures/convex'

/** Convex without a server: every query reads the mockup fixtures by function name. */
type Ref = Parameters<typeof getFunctionName>[0]
const nameOf = (ref: unknown) => {
  if (typeof ref === 'string') return ref
  try { return getFunctionName(ref as Ref) } catch { return String(ref) }
}

function useFixtureVersion() {
  return useSyncExternalStore(subscribeFixtures, fixtureVersion, fixtureVersion)
}

/** Like Convex, a query nobody subscribed to yet answers undefined on its first render, then its value. */
const delivered = new Set<string>()
const deliveryListeners = new Set<() => void>()
let deliveries = 0
const subscribeDeliveries = (listener: () => void) => {
  deliveryListeners.add(listener)
  return () => { deliveryListeners.delete(listener) }
}
const deliveryCount = () => deliveries

export function useQuery(ref: unknown, ...rest: unknown[]) {
  useFixtureVersion()
  const args = rest[0]
  const key = args === 'skip' ? null : nameOf(ref) + ' ' + JSON.stringify(args ?? {})
  useSyncExternalStore(subscribeDeliveries, deliveryCount, deliveryCount)
  const pending = key !== null && !delivered.has(key)
  useEffect(() => {
    if (!pending || key === null) return
    delivered.add(key)
    deliveries += 1
    deliveryListeners.forEach((listener) => listener())
  }, [key, pending])
  if (key === null || pending) return undefined
  return resolveQuery(nameOf(ref), (args ?? {}) as Record<string, unknown>)
}

export function useQueries(queries: Record<string, { query: unknown; args: Record<string, unknown> } | undefined>) {
  const version = useFixtureVersion()
  const values = Object.entries(queries).map(([key, entry]) => [key, entry ? resolveQuery(nameOf(entry.query), entry.args ?? {}) : undefined] as const)
  const signature = JSON.stringify(Object.entries(queries).map(([key, entry]) => [key, entry ? nameOf(entry.query) : null, entry?.args ?? null]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => Object.fromEntries(values), [signature, version])
}

const noop = () => undefined
const SKIPPED = { results: [], status: 'LoadingFirstPage', isLoading: true, loadMore: noop }

export function usePaginatedQuery(ref: unknown, args: unknown) {
  useFixtureVersion()
  const value = args === 'skip' ? undefined : resolveQuery(nameOf(ref), { ...(args as Record<string, unknown>), paginationOpts: { numItems: 100, cursor: null } })
  return useMemo(() => {
    if (args === 'skip') return SKIPPED
    const results = Array.isArray(value) ? value : (value as { page?: unknown[] } | undefined)?.page ?? []
    return { results, status: 'Exhausted', isLoading: false, loadMore: noop }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, args === 'skip'])
}

const mutations = new Map<string, ((args?: Record<string, unknown>) => Promise<unknown>) & { withOptimisticUpdate: () => unknown }>()

/** Stable per function, as Convex's own hooks are. */
function mutationFor(ref: unknown) {
  const name = nameOf(ref)
  const existing = mutations.get(name)
  if (existing) return existing
  const run = async (args?: Record<string, unknown>) => resolveMutation(name, args ?? {})
  const fn = Object.assign(run, { withOptimisticUpdate: () => fn })
  mutations.set(name, fn)
  return fn
}

export function useMutation(ref: unknown) {
  return mutationFor(ref)
}

export function useAction(ref: unknown) {
  return mutationFor(ref)
}

export const useConvexMutation = useMutation

const client = {
  query: async (ref: unknown, args?: Record<string, unknown>) => resolveQuery(nameOf(ref), args ?? {}),
  mutation: async (ref: unknown, args?: Record<string, unknown>) => resolveMutation(nameOf(ref), args ?? {}),
  action: async (ref: unknown, args?: Record<string, unknown>) => resolveMutation(nameOf(ref), args ?? {}),
  watchQuery: (ref: unknown, args?: Record<string, unknown>) => ({
    onUpdate: (callback: () => void) => subscribeFixtures(callback),
    localQueryResult: () => resolveQuery(nameOf(ref), args ?? {}),
    journal: () => undefined,
  }),
  setAuth: () => undefined,
  clearAuth: () => undefined,
  close: async () => undefined,
  connectionState: () => ({ isWebSocketConnected: true, hasInflightRequests: false, hasEverConnected: true, connectionCount: 1, connectionRetries: 0 }),
  subscribeToConnectionState: () => () => undefined,
}

export class ConvexReactClient {
  constructor(_url?: string) {
    return client as unknown as ConvexReactClient
  }
}

export function useConvex() {
  return client
}

export function useConvexAuth() {
  return { isLoading: false, isAuthenticated: true }
}

export function useConvexConnectionState() {
  return client.connectionState()
}

export function ConvexProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}

export function ConvexProviderWithAuth({ children }: { children: ReactNode }) {
  return <>{children}</>
}

export function Authenticated({ children }: { children: ReactNode }) {
  return <>{children}</>
}

export function Unauthenticated() {
  return null
}

export function AuthLoading() {
  return null
}

export function optimisticallyUpdateValueInPaginatedQuery() {}
export function insertAtTop() {}
export function insertAtBottomIfLoaded() {}
export function insertAtPosition() {}
