import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { Id } from '../../../convex/_generated/dataModel'
import type {
  FileIngestionJobRepository,
  FileIngestionJobStatusRecord,
} from './FileIngestionJobRepository'

export class ConvexFileIngestionJobRepository implements FileIngestionJobRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async createJob(args: {
    userId: string
    workspaceId?: string
    r2Key: string
    fileName: string
    mimeType: string
    sizeBytes: number
    projectId?: string
    parentId?: string
  }): Promise<{ jobId: string }> {
    const result = await convex.mutation<{ jobId: string } | null>('files/ingestion/jobs:createJob', {
      userId: args.userId,
      r2Key: args.r2Key,
      fileName: args.fileName,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      ...(args.projectId ? { projectId: args.projectId } : {}),
      ...(args.parentId ? { parentId: args.parentId } : {}),
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!result) throw new Error('Failed to create ingestion job')
    return result
  }

  async getJob(args: {
    jobId: string
    userId: string
  }): Promise<FileIngestionJobStatusRecord | null> {
    return await convex.query<FileIngestionJobStatusRecord | null>('files/ingestion/jobs:getJob', {
      jobId: args.jobId as Id<'documentIngestionJobs'>,
      userId: args.userId,
      serverSecret: this.serverSecret,
    }, { throwOnError: false })
  }

  async updateJobStatus(args: {
    jobId: string
    userId: string
    status: 'queued' | 'extracting' | 'indexing' | 'completed' | 'failed'
    statusMessage?: string
    fileIds?: string[]
    partCount?: number
    error?: string
  }): Promise<void> {
    await convex.mutation('files/ingestion/jobs:updateJobStatus', {
      jobId: args.jobId as Id<'documentIngestionJobs'>,
      userId: args.userId,
      status: args.status,
      ...(args.statusMessage !== undefined ? { statusMessage: args.statusMessage } : {}),
      ...(args.fileIds !== undefined ? { fileIds: args.fileIds as Id<'files'>[] } : {}),
      ...(args.partCount !== undefined ? { partCount: args.partCount } : {}),
      ...(args.error !== undefined ? { error: args.error } : {}),
      serverSecret: this.serverSecret,
    })
  }
}
