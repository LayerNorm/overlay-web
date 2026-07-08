import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { QueryResult, VectorStore } from '@overlay/app-core'

type ConvexVectorStorePaths = {
  upsert?: string
  query?: string
  delete?: string
}

function requirePath(path: string | undefined, method: string): string {
  if (!path) {
    throw new Error(
      `ConvexVectorStore.${method} requires a Convex function path. ` +
        'Pass paths when constructing the provider for a concrete vector collection.',
    )
  }
  return path
}

export class ConvexVectorStore implements VectorStore {
  constructor(private readonly paths: ConvexVectorStorePaths = {}) {}

  async upsert(args: {
    id: string
    vector: number[]
    metadata: Record<string, unknown>
  }): Promise<void> {
    await convex.mutation(
      requirePath(this.paths.upsert, 'upsert'),
      {
        serverSecret: getInternalApiSecret(),
        ...args,
      },
      { throwOnError: true },
    )
  }

  async query(args: {
    vector: number[]
    topK: number
    filter?: Record<string, unknown>
  }): Promise<QueryResult[]> {
    return (
      (await convex.query<QueryResult[]>(
        requirePath(this.paths.query, 'query'),
        {
          serverSecret: getInternalApiSecret(),
          ...args,
        },
        { throwOnError: true },
      )) ?? []
    )
  }

  async delete(id: string): Promise<void> {
    await convex.mutation(
      requirePath(this.paths.delete, 'delete'),
      {
        serverSecret: getInternalApiSecret(),
        id,
      },
      { throwOnError: true },
    )
  }
}
