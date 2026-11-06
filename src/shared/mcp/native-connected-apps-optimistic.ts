import { makeFunctionReference } from 'convex/server'
import type { OptimisticLocalStore } from 'convex/browser'

type NativeGrant = { id: string }
type GrantPage = { page: NativeGrant[]; isDone: boolean; continueCursor: string }

export const nativeGrantListRef = makeFunctionReference<'query'>('mcp/grants:listNative')
export const nativeGrantRevokeRef = makeFunctionReference<'mutation'>('mcp/grants:revokeNative')

export function removeNativeGrantOptimistically(store: OptimisticLocalStore, grantId: string) {
  for (const query of store.getAllQueries(nativeGrantListRef)) {
    if (!query.value) continue
    const result = query.value as GrantPage
    store.setQuery(nativeGrantListRef, query.args, {
      ...result,
      page: result.page.filter((grant) => grant.id !== grantId),
    })
  }
}
