import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { FileService, FileServiceError, type FileServiceStorage } from './FileService'
import type {
  FileRecord,
  FileRepository,
  FileStorageEntitlements,
  FileStorageProxyTarget,
  FileSubtreeStorageEntry,
  FileUploadIntentRecord,
} from './FileRepository'

function createStorage(overrides: Partial<FileServiceStorage> = {}): FileServiceStorage & {
  deletedKeys: string[]
  uploadedKeys: string[]
} {
  const storage = {
    deletedKeys: [] as string[],
    uploadedKeys: [] as string[],
    async checkGlobalR2Budget() {},
    async deleteObject(key: string) {
      storage.deletedKeys.push(key)
    },
    async deleteObjects(keys: string[]) {
      storage.deletedKeys.push(...keys)
    },
    async generatePresignedDownloadUrl(key: string) {
      return `https://download.test/${encodeURIComponent(key)}`
    },
    async generatePresignedUploadUrl(key: string) {
      return `https://upload.test/${encodeURIComponent(key)}`
    },
    getMaxPresignedUploadBytes() {
      return 1024
    },
    getR2PresignTtlSeconds() {
      return 900
    },
    async headObject() {
      return { sizeBytes: 12, contentType: 'text/plain' }
    },
    keyForFile(userId: string, fileId: string, fileName: string) {
      return `users/${userId}/files/${fileId}/${fileName}`
    },
    async uploadBuffer(key: string) {
      storage.uploadedKeys.push(key)
    },
    ...overrides,
  } satisfies FileServiceStorage & { deletedKeys: string[]; uploadedKeys: string[] }
  return storage
}

function createRepository(overrides: Partial<FileRepository> = {}): FileRepository & {
  createdFiles: Array<Record<string, unknown>>
  createdUploadIntents: Array<Record<string, unknown>>
  extractedDocuments: Array<Record<string, unknown>>
  removedFiles: Array<Record<string, unknown>>
} {
  const createdFiles: Array<Record<string, unknown>> = []
  const createdUploadIntents: Array<Record<string, unknown>> = []
  const extractedDocuments: Array<Record<string, unknown>> = []
  const removedFiles: Array<Record<string, unknown>> = []
  const repository = {
    storageCleanupMode: 'immediate' as const,
    createdFiles,
    createdUploadIntents,
    extractedDocuments,
    removedFiles,
    async getFile({ fileId, userId }: { fileId: string; userId: string }) {
      return {
        _id: fileId,
        userId,
        name: 'notes.txt',
        content: 'alpha beta alpha',
      } satisfies FileRecord
    },
    async getFileByLegacyOutputId() {
      return null
    },
    async listFiles() {
      return []
    },
    async createFile(args: Record<string, unknown> & { userId: string }) {
      createdFiles.push(args)
      return `file_${createdFiles.length}`
    },
    async createFileWithStorage(args: Record<string, unknown> & { userId: string }) {
      createdFiles.push(args)
      return `file_${createdFiles.length}`
    },
    async createExtractedDocument(args) {
      extractedDocuments.push(args)
      args.parts.forEach((part) => createdFiles.push({ ...part, userId: args.userId }))
      return args.parts.map((_, index) => `file_${index + 1}`)
    },
    async updateFile() {},
    async removeFile(args: { fileId: string; r2CleanupConfirmed?: boolean; userId: string }) {
      removedFiles.push(args)
    },
    async getUploadIntent() {
      return { _id: 'intent_1', declaredSizeBytes: 20, expiresAt: Date.now() + 1000 } satisfies FileUploadIntentRecord
    },
    async createUploadIntent(args: Record<string, unknown> & {
      declaredSizeBytes: number
      expiresAt: number
      mimeType: string
      r2Key: string
      userId: string
    }) {
      createdUploadIntents.push(args)
    },
    async cleanupExpiredUploadIntents() {
      return 0
    },
    async finalizeUploadIntent() {},
    async expireUploadIntent() {},
    async getR2KeysForSubtree() {
      return []
    },
    async getStorageUrlForProxy() {
      return null
    },
    async recordFileBandwidth() {},
    async getStorageEntitlements() {
      return {
        overlayStorageBytesUsed: 100,
        overlayStorageBytesLimit: 10_000,
      } satisfies FileStorageEntitlements
    },
    async setShare() {
      return { visibility: 'public' as const, token: 'share_token' }
    },
    ...overrides,
  } satisfies FileRepository & {
    createdFiles: Array<Record<string, unknown>>
    createdUploadIntents: Array<Record<string, unknown>>
    extractedDocuments: Array<Record<string, unknown>>
    removedFiles: Array<Record<string, unknown>>
  }
  return repository
}

function createPdfFixture(text: string): Buffer {
  const content = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf)
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function createService(repository = createRepository(), storage = createStorage()) {
  return new FileService({
    repository,
    storage,
    clock: {
      now: () => 1_700_000_000_000,
      randomBytes: () => ({ toString: () => 'randombytes' }),
      randomUUID: () => 'uuid_1',
    },
  })
}

test('FileService.createFile preserves missing-name error shape', async () => {
  const service = createService()
  await assert.rejects(
    () => service.createFile({ userId: 'user_1', body: {} }),
    (error) =>
      error instanceof FileServiceError &&
      error.statusCode === 400 &&
      error.payload.error === 'name required',
  )
})

test('FileService.createFile rejects legacy Convex storage uploads', async () => {
  const service = createService()
  await assert.rejects(
    () => service.createFile({ userId: 'user_1', body: { name: 'x', storageId: 'old' } }),
    (error) =>
      error instanceof FileServiceError &&
      error.statusCode === 400 &&
      error.payload.error === 'Convex file storage is no longer supported. Upload to R2 and pass r2Key from the upload-url flow.',
  )
})

test('FileService.createFile splits large text into Convex-safe parts', async () => {
  const repository = createRepository()
  const service = createService(repository)
  const result = await service.createFile({
    userId: 'user_1',
    body: {
      name: 'large.txt',
      type: 'file',
      textContent: 'a'.repeat(900_000),
    },
  })

  assert.equal(result.id, 'file_1')
  assert.equal(result.parts, 2)
  assert.deepEqual(result.ids, ['file_1', 'file_2'])
  assert.equal(repository.createdFiles[0]?.name, 'large (part 1 of 2).txt')
  assert.equal(repository.createdFiles[1]?.name, 'large (part 2 of 2).txt')
})

for (const fixture of [
  {
    mimeType: 'application/pdf',
    name: 'private-ai-report.pdf',
    expectedText: /private ai/i,
    read: async () => createPdfFixture('Private AI ingestion fixture'),
  },
  {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    name: 'customer-research.docx',
    expectedText: /customer research/i,
    read: async () => readFile(new URL('../../../public/showcase/customer-research.docx', import.meta.url)),
  },
] as const) {
  test(`FileService.ingestDocument extracts and persists ${fixture.name}`, async () => {
    const repository = createRepository()
    const storage = createStorage()
    const service = createService(repository, storage)
    const bytes = await fixture.read()
    const file = new File([copyToArrayBuffer(bytes)], fixture.name, { type: fixture.mimeType })

    const result = await service.ingestDocument({
      file,
      projectId: 'project0123456789',
      userId: 'user_1',
    })

    assert.equal(result.id, 'file_1')
    assert.ok(result.parts >= 1)
    assert.deepEqual(storage.uploadedKeys, [`users/user_1/files/uuid_1/${fixture.name}`])
    assert.equal(repository.createdFiles.length, result.parts)
    assert.match(String(repository.createdFiles[0]?.content), fixture.expectedText)
    assert.equal(repository.extractedDocuments[0]?.projectId, 'project0123456789')
  })
}

test('FileService.createUploadUrl returns current upload-url DTO and records intent', async () => {
  const repository = createRepository()
  const service = createService(repository)
  const result = await service.createUploadUrl({
    userId: 'user_1',
    sizeBytes: 256,
    name: 'hello.txt',
    mimeType: 'text/plain; charset=utf-8',
  })

  assert.equal(result.expiresIn, 900)
  assert.equal(result.maxSizeBytes, 256)
  assert.equal(result.r2Key, 'users/user_1/files/tmp-1700000000000-randombytes/hello.txt')
  assert.equal(result.uploadUrl, 'https://upload.test/users%2Fuser_1%2Ffiles%2Ftmp-1700000000000-randombytes%2Fhello.txt')
  assert.equal(repository.createdUploadIntents[0]?.mimeType, 'text/plain')
  assert.equal(repository.createdUploadIntents[0]?.declaredSizeBytes, 256)
})

test('FileService.createUploadUrl preserves storage-limit error shape', async () => {
  const repository = createRepository({
    async getStorageEntitlements() {
      return { overlayStorageBytesUsed: 900, overlayStorageBytesLimit: 1000 }
    },
  })
  const service = createService(repository)

  await assert.rejects(
    () => service.createUploadUrl({ userId: 'user_1', sizeBytes: 200 }),
    (error) =>
      error instanceof FileServiceError &&
      error.statusCode === 403 &&
      error.payload.error === 'Overlay storage limit reached.' &&
      error.payload.message === 'Not enough Overlay storage remaining. 100 B available, 200 B needed.',
  )
})

test('FileService.createPresignedUpload returns current presign DTO', async () => {
  const repository = createRepository()
  const service = createService(repository)
  const result = await service.createPresignedUpload({
    userId: 'user_1',
    name: 'hello.txt',
    mimeType: 'text/plain',
    sizeBytesRaw: '128',
  })

  assert.equal(result.expiresIn, 900)
  assert.equal(result.maxSizeBytes, 128)
  assert.equal(result.r2Key, 'users/user_1/files/tmp-1700000000000-randombytes/hello.txt')
  assert.equal(result.presignedUrl, 'https://upload.test/users%2Fuser_1%2Ffiles%2Ftmp-1700000000000-randombytes%2Fhello.txt')
})

test('FileService.deleteFile deletes only owned R2 keys before removing row', async () => {
  const repository = createRepository({
    async getR2KeysForSubtree() {
      return [
        { fileId: 'file_1', r2Key: 'users/user_1/files/file_1/a.txt' },
        { fileId: 'file_2', r2Key: 'users/user_2/files/file_2/b.txt' },
      ] satisfies FileSubtreeStorageEntry[]
    },
  })
  const storage = createStorage()
  const service = createService(repository, storage)

  const result = await service.deleteFile({ userId: 'user_1', fileId: 'file_1' })

  assert.deepEqual(result, { success: true })
  assert.deepEqual(storage.deletedKeys, ['users/user_1/files/file_1/a.txt'])
  assert.deepEqual(repository.removedFiles[0], {
    fileId: 'file_1',
    userId: 'user_1',
    r2CleanupConfirmed: true,
  })
})

test('FileService.deleteFile defers physical deletion for durable repositories', async () => {
  const storage = createStorage()
  const repository = createRepository({
    storageCleanupMode: 'durable',
    async getR2KeysForSubtree() {
      return [{ fileId: 'file_1', r2Key: 'users/user_1/files/file_1/report.pdf' }]
    },
  })
  await createService(repository, storage).deleteFile({ fileId: 'file_1', userId: 'user_1' })
  assert.deepEqual(storage.deletedKeys, [])
  assert.equal(repository.removedFiles[0]?.r2CleanupConfirmed, false)
})

test('FileService.ingestDocument persists extracted parts in one repository operation', async () => {
  const storage = createStorage()
  let extractedCalls = 0
  const repository = createRepository({
    async createExtractedDocument(args) {
      extractedCalls += 1
      assert.equal(args.parts.length, 1)
      assert.equal(args.parts[0]?.content, 'document body')
      return ['file_document']
    },
  })
  const result = await createService(repository, storage).ingestDocument({
    file: new File(['document body'], 'document.txt', { type: 'text/plain' }),
    userId: 'user_1',
  })
  assert.equal(extractedCalls, 1)
  assert.deepEqual(result.ids, ['file_document'])
  assert.equal(storage.uploadedKeys.length, 1)
})

test('FileService.getContentProxy records bandwidth and keeps storage previews same-origin', async () => {
  let bandwidth: Record<string, unknown> | undefined
  const repository = createRepository({
    async getStorageUrlForProxy() {
      return {
        r2Key: 'users/user_1/files/file_1/a.txt',
        name: 'a.txt',
        sizeBytes: 42,
      } satisfies FileStorageProxyTarget
    },
    async recordFileBandwidth(args) {
      bandwidth = args
    },
  })
  const service = createService(repository)

  const result = await service.getContentProxy({ userId: 'user_1', fileId: 'file_1' })

  assert.deepEqual(result, {
    kind: 'upstream',
    name: 'a.txt',
    url: 'https://download.test/users%2Fuser_1%2Ffiles%2Ffile_1%2Fa.txt',
  })
  assert.deepEqual(bandwidth, { userId: 'user_1', bytes: 42 })
})

test('FileService.getContentProxy never signs a foreign user storage key', async () => {
  let signed = false
  const repository = createRepository({
    async getStorageUrlForProxy() {
      return {
        name: 'foreign.txt',
        r2Key: 'users/user_2/files/file_2/foreign.txt',
        sizeBytes: 42,
      } satisfies FileStorageProxyTarget
    },
  })
  const storage = createStorage({
    async generatePresignedDownloadUrl() {
      signed = true
      return 'https://download.test/should-not-exist'
    },
  })
  const result = await createService(repository, storage).getContentProxy({
    fileId: 'file_2',
    userId: 'user_1',
  })
  assert.deepEqual(result, {
    kind: 'json',
    payload: { error: 'Not found' },
    status: 404,
  })
  assert.equal(signed, false)
})

test('FileService.searchText preserves match response shape', async () => {
  const service = createService()
  const result = await service.searchText({
    userId: 'user_1',
    body: {
      fileIds: ['file_1'],
      query: 'beta',
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.truncated, false)
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0]?.fileId, 'file_1')
  assert.equal(result.matches[0]?.fileName, 'notes.txt')
  assert.equal(result.matches[0]?.snippet.includes('beta'), true)
})
