import type { FunctionReference, OptionalRestArgs } from 'convex/server'
import { queryConvex, subscribeConvex } from './convexClient'

type Options = { paginationOpts: { numItems: number; cursor: string | null } }
type Page<T> = { page: T[]; isDone: boolean; continueCursor: string }
type Query<A extends Record<string, unknown>, T> = FunctionReference<'query', 'public', A & Options, Page<T>>

export async function queryAllPages<A extends Record<string, unknown>, T>(query: Query<A, T>, args: A): Promise<T[]> {
  const rows: T[] = []
  let cursor: string | null = null
  do {
    const result: Page<T> = await queryConvex(query, ...[{ ...args, paginationOpts: { numItems: 100, cursor } }] as OptionalRestArgs<Query<A, T>>)
    rows.push(...result.page)
    if (result.isDone) return rows
    if (cursor === result.continueCursor) throw new Error('The workspace could not load more results.')
    cursor = result.continueCursor
  } while (true)
}

export function subscribeAllPages<A extends Record<string, unknown>, T>(query: Query<A, T>, args: A, onValue: (rows: T[]) => void): () => void {
  let active = true
  const pages = new Map<number, { cursor: string | null; rows: T[]; stop: () => void }>()
  const dropAfter = (index: number) => {
    for (const [number, page] of pages) {
      if (number <= index) continue
      page.stop()
      pages.delete(number)
    }
  }
  const watch = (index: number, cursor: string | null) => {
    const page = { cursor, rows: [] as T[], stop: () => {} }
    pages.set(index, page)
    page.stop = subscribeConvex(query, { ...args, paginationOpts: { numItems: 100, cursor } }, result => {
      if (!active || pages.get(index) !== page) return
      page.rows = result.page
      if (result.isDone || pages.get(index + 1)?.cursor !== result.continueCursor) dropAfter(index)
      onValue([...pages.values()].flatMap(value => value.rows))
      if (!result.isDone && result.continueCursor !== cursor && !pages.has(index + 1)) watch(index + 1, result.continueCursor)
    })
  }
  watch(0, null)
  return () => { active = false; for (const page of pages.values()) page.stop(); pages.clear() }
}
