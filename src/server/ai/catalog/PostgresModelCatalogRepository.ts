import 'server-only'

import { desc } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { modelCatalogSnapshots } from '@/server/database/postgres/schema'
import type {
  ModelCatalogRepository,
  PersistedModelCatalogSnapshot,
} from './ModelCatalogRepository'

export class PostgresModelCatalogRepository implements ModelCatalogRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async getLatest(): Promise<PersistedModelCatalogSnapshot | null> {
    const [row] = await this.db
      .select()
      .from(modelCatalogSnapshots)
      .orderBy(desc(modelCatalogSnapshots.fetchedAt))
      .limit(1)
    return row
      ? {
          fetchedAt: row.fetchedAt.getTime(),
          modelsJson: JSON.stringify(row.modelsJson),
          source: row.source,
        }
      : null
  }

  async upsert(snapshot: PersistedModelCatalogSnapshot): Promise<void> {
    const models = JSON.parse(snapshot.modelsJson) as unknown
    if (!Array.isArray(models)) throw new Error('Model catalog snapshot must contain a JSON array')
    const now = new Date()
    await this.db
      .insert(modelCatalogSnapshots)
      .values({
        fetchedAt: new Date(snapshot.fetchedAt),
        modelsJson: models,
        source: snapshot.source,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: modelCatalogSnapshots.source,
        set: {
          fetchedAt: new Date(snapshot.fetchedAt),
          modelsJson: models,
          updatedAt: now,
        },
      })
  }
}
