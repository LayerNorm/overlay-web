import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type {
  ModelCatalogRepository,
  PersistedModelCatalogSnapshot,
} from './ModelCatalogRepository'

export class ConvexModelCatalogRepository implements ModelCatalogRepository {
  async getLatest(): Promise<PersistedModelCatalogSnapshot | null> {
    return await convex.query<PersistedModelCatalogSnapshot | null>(
      'platform/gatewayCatalog:getByServer',
      { serverSecret: getInternalApiSecret() },
      { background: true, suppressNetworkConsoleError: true },
    )
  }

  async upsert(snapshot: PersistedModelCatalogSnapshot): Promise<void> {
    await convex.mutation('platform/gatewayCatalog:upsertByServer', {
      serverSecret: getInternalApiSecret(),
      ...snapshot,
    }, { throwOnError: true })
  }
}
