import 'server-only'

export type PersistedModelCatalogSnapshot = {
  fetchedAt: number
  modelsJson: string
  source: string
}

export interface ModelCatalogRepository {
  getLatest(): Promise<PersistedModelCatalogSnapshot | null>
  upsert(snapshot: PersistedModelCatalogSnapshot): Promise<void>
}
