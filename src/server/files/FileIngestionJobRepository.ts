import 'server-only'

export type FileIngestionJobStatus =
  | 'queued'
  | 'extracting'
  | 'indexing'
  | 'completed'
  | 'failed'

export type FileIngestionJobStatusRecord = {
  _id: string
  status: string
  statusMessage?: string
  fileName: string
  sourceFileId?: string
  sourceChecksumSha256?: string
  partCount?: number
  fileIds?: string[]
  error?: string
  attemptToken?: string
  createdAt: number
  updatedAt: number
  completedAt?: number
}

export type FileIngestionJobProcessingRecord = {
  _id: string
  userId: string
  workspaceId?: string
  r2Key: string
  fileName: string
  mimeType: string
  sizeBytes: number
  parentId?: string
  sourceFileId?: string
  sourceChecksumSha256?: string
  status: string
  leaseToken?: string
  leaseExpiresAt?: number
}

/**
 * Durable document-ingestion jobs created after a direct-to-R2 upload.
 * The Convex ingestion runner owns these jobs end to end.
 */
export interface FileIngestionJobRepository {
  createJob(args: {
    userId: string
    workspaceId?: string
    r2Key: string
    fileName: string
    mimeType: string
    sizeBytes: number
    parentId?: string
  }): Promise<{ jobId: string }>
  createSourceJob(args: {
    userId: string
    workspaceId: string
    r2Key: string
    fileName: string
    mimeType: string
    sizeBytes: number
    sourceFileId: string
    sourceChecksumSha256: string
    parentId?: string
  }): Promise<{ jobId: string }>

  getJob(args: {
    jobId: string
    userId: string
  }): Promise<FileIngestionJobStatusRecord | null>
  getJobForProcessing(jobId: string): Promise<FileIngestionJobProcessingRecord | null>

  updateJobStatus(args: {
    jobId: string
    userId: string
    status: FileIngestionJobStatus
    statusMessage?: string
    fileIds?: string[]
    partCount?: number
    error?: string
    attemptToken?: string
  }): Promise<void>
}
