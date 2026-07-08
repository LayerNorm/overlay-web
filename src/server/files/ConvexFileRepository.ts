import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { cleanupExpiredR2UploadIntents } from '@/server/storage/r2-upload-intents'
import type {
  FileRepository,
  FileRecord,
  FileShareResult,
  FileStorageEntitlements,
  FileStorageProxyTarget,
  FileSubtreeStorageEntry,
  FileUploadIntentRecord,
} from './FileRepository'

export class ConvexFileRepository implements FileRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async getFile(args: {
    accessToken?: string
    fileId: string
    userId: string
  }): Promise<FileRecord | null> {
    return await convex.query<FileRecord | null>('files/files:get', {
      fileId: args.fileId,
      userId: args.userId,
      serverSecret: this.serverSecret,
      ...(args.accessToken ? { accessToken: args.accessToken } : {}),
    })
  }

  async listFiles(args: Record<string, unknown> & { userId: string }): Promise<unknown[]> {
    return await convex.query<unknown[]>('files/files:list', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async createFile(args: Record<string, unknown> & { userId: string }): Promise<string | null> {
    return await convex.mutation<string | null>('files/files:create', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async createFileWithStorage(args: Record<string, unknown> & { userId: string }): Promise<string | null> {
    return await convex.mutation<string | null>('files/files:createWithStorage', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async updateFile(args: Record<string, unknown> & { fileId: string; userId: string }): Promise<void> {
    await convex.mutation('files/files:update', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async removeFile(args: {
    fileId: string
    r2CleanupConfirmed?: boolean
    userId: string
  }): Promise<void> {
    await convex.mutation('files/files:remove', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async getUploadIntent(args: {
    now: number
    r2Key: string
    userId: string
  }): Promise<FileUploadIntentRecord | null> {
    return await convex.query<FileUploadIntentRecord | null>('files/files:getUploadIntentByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async createUploadIntent(args: {
    declaredSizeBytes: number
    expiresAt: number
    mimeType: string
    r2Key: string
    userId: string
  }): Promise<void> {
    await convex.mutation('files/files:createUploadIntentByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async cleanupExpiredUploadIntents(args: {
    userId: string
  }): Promise<number> {
    return cleanupExpiredR2UploadIntents({
      userId: args.userId,
      serverSecret: this.serverSecret,
    })
  }

  async finalizeUploadIntent(args: {
    actualSizeBytes: number
    fileId: string
    now: number
    r2Key: string
    userId: string
  }): Promise<void> {
    await convex.mutation('files/files:finalizeUploadIntentByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async expireUploadIntent(args: {
    intentId: string
    now: number
    userId: string
  }): Promise<void> {
    await convex.mutation('files/files:expireUploadIntentsByServer', {
      userId: args.userId,
      serverSecret: this.serverSecret,
      intentIds: [args.intentId],
      now: args.now,
    }, { throwOnError: true })
  }

  async getR2KeysForSubtree(args: {
    fileId: string
    userId: string
  }): Promise<FileSubtreeStorageEntry[]> {
    return await convex.query<FileSubtreeStorageEntry[]>('files/files:getR2KeysForSubtree', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async getStorageUrlForProxy(args: {
    fileId: string
    userId: string
  }): Promise<FileStorageProxyTarget | null> {
    return await convex.query<FileStorageProxyTarget | null>(
      'files/files:getStorageUrlForProxy',
      {
        ...args,
        serverSecret: this.serverSecret,
      },
      { throwOnError: true },
    )
  }

  async recordFileBandwidth(args: {
    bytes: number
    userId: string
  }): Promise<void> {
    await convex.mutation('platform/usage:recordFileBandwidthByServer', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async getStorageEntitlements(args: {
    userId: string
  }): Promise<FileStorageEntitlements | null> {
    return await convex.query<FileStorageEntitlements | null>('platform/usage:getEntitlementsByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async setShare(args: {
    fileId: string
    userId: string
    visibility: 'private' | 'public'
  }): Promise<FileShareResult | null> {
    return await convex.mutation<FileShareResult | null>('files/files:setShare', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }
}
