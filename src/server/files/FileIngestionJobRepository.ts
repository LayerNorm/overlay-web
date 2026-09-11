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
  partCount?: number
  fileIds?: string[]
  error?: string
  createdAt: number
  updatedAt: number
  completedAt?: number
}

/**
 * Durable document-ingestion jobs created after a direct-to-R2 upload.
 * Only the Convex provider has an ingestion runner today; the Postgres
 * registration is an explicit unsupported sentinel, and routes gate on
 * the provider capability before touching this repository.
 */
export interface FileIngestionJobRepository {
  createJob(args: {
    userId: string
    workspaceId?: string
    r2Key: string
    fileName: string
    mimeType: string
    sizeBytes: number
    projectId?: string
    parentId?: string
  }): Promise<{ jobId: string }>

  getJob(args: {
    jobId: string
    userId: string
  }): Promise<FileIngestionJobStatusRecord | null>

  updateJobStatus(args: {
    jobId: string
    userId: string
    status: FileIngestionJobStatus
    statusMessage?: string
    fileIds?: string[]
    partCount?: number
    error?: string
  }): Promise<void>
}
