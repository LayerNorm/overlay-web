import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { ObjectStore, ObjectSummary } from '@overlay/app-core'

type ConvexObjectStoreOptions = {
  downloadPath?: string
  deletePath?: string
  listPath?: string
}

function unsupported(method: string): Error {
  return new Error(
    `ConvexObjectStore.${method} is not configured. ` +
      'Pass explicit Convex function paths for a concrete file-storage adapter.',
  )
}

export class ConvexObjectStore implements ObjectStore {
  constructor(private readonly options: ConvexObjectStoreOptions = {}) {}

  async getUploadUrl(key: string, contentType: string): Promise<{ url: string; fields?: Record<string, string> }> {
    void key
    void contentType
    throw unsupported('getUploadUrl')
  }

  async getDownloadUrl(key: string): Promise<string> {
    if (!this.options.downloadPath) throw unsupported('getDownloadUrl')
    const url = await convex.query<string | null>(
      this.options.downloadPath,
      {
        serverSecret: getInternalApiSecret(),
        key,
      },
      { throwOnError: true },
    )
    if (!url) {
      throw new Error(`Convex object not found: ${key}`)
    }
    return url
  }

  async deleteObject(key: string): Promise<void> {
    if (!this.options.deletePath) throw unsupported('deleteObject')
    await convex.mutation(
      this.options.deletePath,
      {
        serverSecret: getInternalApiSecret(),
        key,
      },
      { throwOnError: true },
    )
  }

  async listObjects(prefix: string): Promise<ObjectSummary[]> {
    if (!this.options.listPath) throw unsupported('listObjects')
    return (
      (await convex.query<ObjectSummary[]>(
        this.options.listPath,
        {
          serverSecret: getInternalApiSecret(),
          prefix,
        },
        { throwOnError: true },
      )) ?? []
    )
  }
}
