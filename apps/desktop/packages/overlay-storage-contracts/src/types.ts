/** Metadata for a stored object (S3 key, R2 object, etc.). */
export interface FileMetadata {
  key: string
  sizeBytes?: number
  contentType?: string
  lastModified?: string
  etag?: string
}

/** @deprecated Prefer `FileMetadata`; kept for existing imports. */
export type ObjectSummary = FileMetadata

export interface UploadUrl {
  url: string
  fields?: Record<string, string>
  expiresIn?: number
  maxSizeBytes?: number
}

/** Presigned or public URL for downloading an object. */
export type DownloadUrl = string

export interface QueryResult {
  id: string
  score: number
  metadata: Record<string, unknown>
}

export interface ObjectStore {
  getUploadUrl(key: string, contentType: string): Promise<UploadUrl>
  getDownloadUrl(key: string): Promise<DownloadUrl>
  deleteObject(key: string): Promise<void>
  listObjects(prefix: string): Promise<FileMetadata[]>
}

export interface VectorStore {
  upsert(args: {
    id: string
    vector: number[]
    metadata: Record<string, unknown>
  }): Promise<void>
  query(args: {
    vector: number[]
    topK: number
    filter?: Record<string, unknown>
  }): Promise<QueryResult[]>
  delete(id: string): Promise<void>
}
