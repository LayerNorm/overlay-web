import 'server-only'

export type FileRecord = {
  _id: string
  userId: string
  name: string
  kind?: string
  content?: string
  textContent?: string
  r2Key?: string
  storageId?: string
  sizeBytes?: number
  createdAt?: number
  updatedAt?: number
  [key: string]: unknown
}

export type FileStorageProxyTarget = {
  r2Key?: string
  url?: string
  name: string
  sizeBytes: number
}

export type FileUploadIntentRecord = {
  _id: string
  declaredSizeBytes: number
  mimeType?: string
  expiresAt: number
}

export type FileStorageEntitlements = {
  overlayStorageBytesUsed: number
  overlayStorageBytesLimit: number
}

export type FileSubtreeStorageEntry = {
  fileId: string
  r2Key?: string
  storageId?: string
}

export type FileShareResult = {
  token: string | null
  visibility: 'private' | 'public'
}

export type ExtractedDocumentPart = {
  content: string
  contentHash: string
  name: string
}

export interface FileRepository {
  readonly storageCleanupMode: 'immediate' | 'durable'
  getFile(args: {
    accessToken?: string
    fileId: string
    userId: string
  }): Promise<FileRecord | null>
  getFileByLegacyOutputId(args: {
    outputId: string
    userId: string
  }): Promise<FileRecord | null>
  listFiles(args: Record<string, unknown> & { userId: string }): Promise<unknown[]>
  createFile(args: Record<string, unknown> & { userId: string }): Promise<string | null>
  createFileWithStorage(args: Record<string, unknown> & { userId: string }): Promise<string | null>
  createExtractedDocument(args: {
    mimeType: string
    parentId?: string
    parts: ExtractedDocumentPart[]
    projectId?: string
    r2Key: string
    sourceSizeBytes: number
    userId: string
  }): Promise<string[]>
  updateFile(args: Record<string, unknown> & { fileId: string; userId: string }): Promise<void>
  removeFile(args: {
    fileId: string
    r2CleanupConfirmed?: boolean
    userId: string
  }): Promise<void>
  getUploadIntent(args: {
    now: number
    r2Key: string
    userId: string
  }): Promise<FileUploadIntentRecord | null>
  createUploadIntent(args: {
    declaredSizeBytes: number
    expiresAt: number
    mimeType: string
    r2Key: string
    userId: string
  }): Promise<void>
  cleanupExpiredUploadIntents(args: {
    userId: string
  }): Promise<number>
  finalizeUploadIntent(args: {
    actualSizeBytes: number
    fileId: string
    now: number
    r2Key: string
    userId: string
  }): Promise<void>
  expireUploadIntent(args: {
    intentId: string
    now: number
    userId: string
  }): Promise<void>
  getR2KeysForSubtree(args: {
    fileId: string
    userId: string
  }): Promise<FileSubtreeStorageEntry[]>
  getStorageUrlForProxy(args: {
    fileId: string
    userId: string
  }): Promise<FileStorageProxyTarget | null>
  recordFileBandwidth(args: {
    bytes: number
    userId: string
  }): Promise<void>
  getStorageEntitlements(args: {
    userId: string
  }): Promise<FileStorageEntitlements | null>
  setShare(args: {
    fileId: string
    userId: string
    visibility: 'private' | 'public'
  }): Promise<FileShareResult | null>
}
