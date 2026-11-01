import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { beforeEach, expect, test, vi } from 'vitest'
import type { ArtifactPublicationAuthority } from './ArtifactPublicationAuthority'
import type { FileRepository } from './FileRepository'
import { FileService, type FileServiceStorage } from './FileService'
import type {
  ArtifactExecutionReference,
  ComputerArtifactInput,
  ComputerArtifactManifest,
  ComputerArtifactPrepare,
} from '@/shared/storage/file-publication'

const authorizeMock = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('./ArtifactPublicationAuthority', () => ({
  authorizeComputerPublication: authorizeMock,
}))

const authority: ArtifactPublicationAuthority = {
  kind: 'native',
  access: { actorUserId: 'user', workspaceId: 'workspace' } as never,
  context: {} as never,
}
const reference: ArtifactExecutionReference = {
  actorUserId: 'user',
  runId: 'run',
  workflowRunId: 'workflow',
}

function manifest(overrides: Partial<ComputerArtifactManifest> = {}): ComputerArtifactManifest {
  return {
    artifactId: 'artifact-1',
    sourcePath: '/tmp/movie.mp4',
    name: 'movie.mp4',
    mimeType: 'video/mp4',
    scope: 'personal',
    sourceComputerId: 'computer-1',
    stagingPath: '/tmp/overlay-artifact-snapshot.bin',
    checksumSha256: 'a'.repeat(64),
    sizeBytes: 12,
    userId: 'user',
    workspaceId: 'workspace',
    rootRunId: 'root',
    r2Key: 'users/user/files/artifact/movie.mp4',
    uploadExpiresAt: 1_700_000_300_000,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function createStorage(overrides: Partial<FileServiceStorage> = {}) {
  return {
    checkGlobalR2Budget: vi.fn(async () => undefined),
    deleteObject: vi.fn(async () => undefined),
    deleteObjects: vi.fn(async () => undefined),
    downloadBuffer: vi.fn(async () => null),
    generatePresignedDownloadUrl: vi.fn(async () => 'http://127.0.0.1/download'),
    generatePresignedUploadUrl: vi.fn(async () => 'https://upload.example/scoped'),
    getMaxPresignedUploadBytes: vi.fn(() => 256 * 1024 * 1024),
    getR2PresignTtlSeconds: vi.fn(() => 900),
    headObject: vi.fn(async () => ({ sizeBytes: 12, contentType: 'video/mp4' })),
    keyForFile: vi.fn(() => 'users/user/files/key/movie.mp4'),
    uploadBuffer: vi.fn(async () => undefined),
    ...overrides,
  } satisfies FileServiceStorage
}

function createService(args: {
  repository?: Partial<FileRepository>
  storage?: Partial<FileServiceStorage>
}) {
  const repository = {
    getComputerArtifact: vi.fn(async () => null),
    prepareComputerArtifact: vi.fn(async ({ input, snapshot }: ComputerArtifactPrepare) => ({
      ...input,
      ...snapshot,
      userId: 'user',
      workspaceId: 'workspace',
      rootRunId: 'root',
      r2Key: 'users/user/files/key/movie.mp4',
      uploadExpiresAt: 1_700_000_300_000,
      createdAt: 1,
      updatedAt: 1,
    })),
    commitComputerArtifact: vi.fn(async () => 'files:published'),
    ...args.repository,
  } as unknown as FileRepository
  const storage = createStorage(args.storage)
  const service = new FileService({
    repository,
    storage,
    clock: {
      now: () => 1_700_000_000_000,
      randomBytes: () => ({ toString: () => 'randombytes' }),
      randomUUID: () => 'uuid',
    },
  })
  return { repository, service, storage }
}

async function startServer(bytes: Uint8Array): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'video/mp4',
      'content-length': String(bytes.byteLength),
    })
    response.end(bytes)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}/download`,
    close: async () => await new Promise<void>(resolve => server.close(() => resolve())),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  authorizeMock.mockResolvedValue(reference)
})

test('prepares normalized MIME and mints a bounded create-only scoped URL', async () => {
  const uploadSigner = vi.fn(async () => 'https://upload.example/scoped')
  const { repository, service, storage } = createService({
    storage: { generatePresignedUploadUrl: uploadSigner },
  })
  const input: ComputerArtifactInput = {
    artifactId: 'artifact-1',
    sourcePath: '/tmp/movie.mp4',
    name: 'movie.mp4',
    mimeType: 'VIDEO/MP4; codecs=avc1',
    scope: 'personal',
  }
  const prepared = await service.prepareComputerArtifact({
    reference,
    input,
    snapshot: {
      sourceComputerId: 'computer-1',
      stagingPath: '/tmp/overlay-artifact-snapshot.bin',
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 12,
      mimeType: 'video/mp4',
    },
  })
  await service.getComputerArtifactUploadUrl(prepared)
  expect(repository.prepareComputerArtifact).toHaveBeenCalledWith(expect.objectContaining({
    input: expect.objectContaining({ mimeType: 'video/mp4' }),
    snapshot: expect.objectContaining({ mimeType: 'video/mp4' }),
  }))
  expect(uploadSigner).toHaveBeenCalledWith(
    prepared.r2Key,
    'video/mp4',
    12,
    120,
    'a'.repeat(64),
    true,
  )
  expect(service.getComputerArtifactMaxBytes()).toBe(100 * 1024 * 1024)
  expect(storage.checkGlobalR2Budget).toHaveBeenCalledTimes(2)
  await expect(service.prepareComputerArtifact({
    reference,
    input,
    snapshot: {
      sourceComputerId: 'computer-1',
      stagingPath: '/tmp/oversized-snapshot.bin',
      checksumSha256: 'b'.repeat(64),
      sizeBytes: 100 * 1024 * 1024 + 1,
      mimeType: 'video/mp4',
    },
  })).rejects.toThrow('ARTIFACT_SIZE_LIMIT_EXCEEDED')
  expect(repository.prepareComputerArtifact).toHaveBeenCalledTimes(1)
})

test('streaming checksum mismatch prevents authority refresh and Files commit', async () => {
  const bytes = Buffer.from('not the pinned bytes')
  const server = await startServer(bytes)
  const { repository, service } = createService({
    storage: {
      generatePresignedDownloadUrl: async () => server.url,
      headObject: async () => ({ sizeBytes: bytes.length, contentType: 'video/mp4' }),
    },
  })
  try {
    await expect(service.verifyAndCommitComputerArtifact({
      manifest: manifest({
        sizeBytes: bytes.length,
        checksumSha256: '0'.repeat(64),
      }),
      authority,
    })).rejects.toThrow('ARTIFACT_CHECKSUM_MISMATCH')
    expect(authorizeMock).not.toHaveBeenCalled()
    expect(repository.commitComputerArtifact).not.toHaveBeenCalled()
  } finally {
    await server.close()
  }
})

test('final authority revocation after streaming readback prevents Files commit', async () => {
  const bytes = Buffer.from('verified bytes')
  const checksumSha256 = createHash('sha256').update(bytes).digest('hex')
  const server = await startServer(bytes)
  const { repository, service } = createService({
    storage: {
      generatePresignedDownloadUrl: async () => server.url,
      headObject: async () => ({ sizeBytes: bytes.length, contentType: 'video/mp4' }),
    },
  })
  authorizeMock.mockRejectedValue(new Error('HARNESS_PUBLICATION_NOT_AUTHORIZED'))
  try {
    await expect(service.verifyAndCommitComputerArtifact({
      manifest: manifest({ sizeBytes: bytes.length, checksumSha256 }),
      authority,
    })).rejects.toThrow('HARNESS_PUBLICATION_NOT_AUTHORIZED')
    expect(authorizeMock).toHaveBeenCalledTimes(1)
    expect(repository.commitComputerArtifact).not.toHaveBeenCalled()
  } finally {
    await server.close()
  }
})

test('a lost commit acknowledgement reconciles the stored file on get without another registration', async () => {
  const bytes = Buffer.from('commit replay')
  const checksumSha256 = createHash('sha256').update(bytes).digest('hex')
  const server = await startServer(bytes)
  let storedManifest = manifest({ sizeBytes: bytes.length, checksumSha256 })
  let registrations = 0
  let commitCalls = 0
  const getManifest = vi.fn(async () => storedManifest)
  const { service } = createService({
    repository: {
      getComputerArtifact: getManifest,
      async commitComputerArtifact() {
        commitCalls += 1
        if (registrations === 0) {
          registrations += 1
          storedManifest = { ...storedManifest, fileId: 'files:published' }
          throw new Error('commit acknowledgement lost')
        }
        return storedManifest.fileId!
      },
    },
    storage: {
      generatePresignedDownloadUrl: async () => server.url,
      headObject: async () => ({ sizeBytes: bytes.length, contentType: 'video/mp4' }),
    },
  })
  try {
    await expect(service.verifyAndCommitComputerArtifact({
      manifest: storedManifest,
      authority,
    })).rejects.toThrow('commit acknowledgement lost')
    const replay = await service.getComputerArtifact(reference, {
      artifactId: storedManifest.artifactId,
      sourcePath: storedManifest.sourcePath,
      name: storedManifest.name,
      mimeType: storedManifest.mimeType,
      scope: storedManifest.scope,
    })
    expect(replay?.fileId).toBe('files:published')
    expect(registrations).toBe(1)
    expect(commitCalls).toBe(1)
    expect(getManifest).toHaveBeenCalledTimes(1)
  } finally {
    await server.close()
  }
})
