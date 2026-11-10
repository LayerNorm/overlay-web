import type { ConvexReactClient } from 'convex/react'
import type { FunctionArgs, FunctionReference, FunctionReturnType, OptionalRestArgs } from 'convex/server'
import { getRequestWorkspaceId } from './appApi'

export { api } from './convexApi'
export type { Id } from './convexApi'

let client: ConvexReactClient | null = null
let policyBlocked = false
const policyListeners = new Set<() => void>()

export function setMobileConvexClient(next: ConvexReactClient | null): void {
  client = next
  policyBlocked = false
  for (const listener of policyListeners) listener()
}

export function isNativePolicyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /DEPLOYMENT_FEATURE_ACCESS_DENIED|NATIVE_.*(?:DISABLED|POLICY)|native.*disabled/i.test(message)
}

export function reportConvexError(error: unknown): void {
  if (!isNativePolicyError(error)) return
  policyBlocked = true
  for (const listener of policyListeners) listener()
}

export const getNativePolicyBlocked = () => policyBlocked
export function subscribeNativePolicy(listener: () => void): () => void {
  policyListeners.add(listener)
  return () => { policyListeners.delete(listener) }
}

export function getMobileConvexClient(): ConvexReactClient {
  if (!client) throw new Error('Connect to your workspace to continue.')
  return client
}

export function convexWorkspaceId(): string {
  const workspaceId = getRequestWorkspaceId()
  if (!workspaceId) throw new Error('Choose a workspace to continue.')
  return workspaceId
}

export async function queryConvex<Q extends FunctionReference<'query'>>(query: Q, ...args: OptionalRestArgs<Q>): Promise<FunctionReturnType<Q>> {
  try { return await getMobileConvexClient().query(query, ...args) }
  catch (error) { reportConvexError(error); throw error }
}

export async function mutateConvex<M extends FunctionReference<'mutation'>>(mutation: M, ...args: OptionalRestArgs<M>): Promise<FunctionReturnType<M>> {
  try { return await getMobileConvexClient().mutation(mutation, ...args) }
  catch (error) { reportConvexError(error); throw error }
}

export function subscribeConvex<Q extends FunctionReference<'query'>>(
  query: Q,
  args: FunctionArgs<Q>,
  onValue: (value: FunctionReturnType<Q>) => void,
  onError: (error: unknown) => void = () => undefined,
): () => void {
  const watch = getMobileConvexClient().watchQuery(query, ...[args] as OptionalRestArgs<Q>)
  const update = () => {
    try {
      const value = watch.localQueryResult()
      if (value !== undefined) onValue(value)
    } catch (error) { reportConvexError(error); onError(error) }
  }
  const unsubscribe = watch.onUpdate(update)
  update()
  return unsubscribe
}
