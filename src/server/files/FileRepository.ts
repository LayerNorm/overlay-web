import 'server-only'
import type {
  ComputerArtifactCommit,
  ComputerArtifactLookup,
  ComputerArtifactManifest,
  ComputerArtifactPrepare,
  UploadedFileInput,
} from '@/shared/storage/file-publication'

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
  checksumSha256?: string
  fileId?: string
  status?: 'pending' | 'finalized'
  expiresAt: number
}

export type FileStorageEntitlements = {
  overlayStorageBytesUsed: number
  overlayStorageBytesLimit: number
}

export type FileSubtreeStorageEntry = {
  fileId: string
  r2Key?: string
  extractedTextKey?: string
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

export type FileListPage = {
  data: unknown[]
  nextCursor: string | null
  hasMore: boolean
}

export interface FileRepository {
  readonly storageCleanupMode: 'immediate' | 'durable'
  getFile(args: {
    accessToken?: string
    fileId: string
    userId: string
    workspaceId?: string
  }): Promise<FileRecord | null>
  getExtractionStorage?(args: { fileId: string; userId: string; workspaceId?: string }): Promise<{
    ownerUserId: string
    extractedTextKey?: string
  } | null>
  getFileByLegacyOutputId(args: {
    outputId: string
    userId: string
  }): Promise<FileRecord | null>
  listFiles(args: Record<string, unknown> & { userId: string }): Promise<unknown[]>
  listFilesPage?(args: Record<string, unknown> & { userId: string }): Promise<FileListPage>
  createFile(args: Record<string, unknown> & { userId: string }): Promise<string | null>
  createFileWithStorage(args: Record<string, unknown> & { userId: string }): Promise<string | null>
  commitUploadedFile(args: UploadedFileInput): Promise<string>
  storeFileExtraction(args: {
    fileId: string
    jobId: string
    userId: string
    attemptToken: string
    sourceChecksumSha256: string
    extractionStatus: 'ready' | 'failed' | 'unavailable'
    extractedTextKey?: string
    extractedTextBytes?: number
    content?: string
    extractionError?: string
    extractionTruncated?: boolean
    indexTruncated?: boolean
    indexedCharCount?: number
  }): Promise<void>
  getComputerArtifact(args: ComputerArtifactLookup): Promise<ComputerArtifactManifest | null>
  prepareComputerArtifact(args: ComputerArtifactPrepare): Promise<ComputerArtifactManifest>
  commitComputerArtifact(args: ComputerArtifactCommit): Promise<string>
  createExtractedDocument(args: {
    mimeType: string
    parentId?: string
    parts: ExtractedDocumentPart[]
    r2Key: string
    sourceSizeBytes: number
    scope?: 'personal' | 'workspace'
    userId: string
    workspaceId?: string
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
    checksumSha256?: string
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
