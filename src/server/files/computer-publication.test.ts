import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { unlink, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { beforeEach, expect, test, vi } from 'vitest'
import { publishComputerFile, runHelper, safeFailure, type ComputerPublicationInstance } from './computer-publication'
import { verifyArtifactObject } from './verify-artifact-object'

const controllerMocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  service: {
    getComputerArtifact: vi.fn(),
    prepareComputerArtifact: vi.fn(),
    getComputerArtifactUploadUrl: vi.fn(),
    getComputerArtifactMaxBytes: vi.fn(),
    verifyAndCommitComputerArtifact: vi.fn(),
  },
}))

vi.mock('server-only', () => ({}))
vi.mock('./ArtifactPublicationAuthority', () => ({
  authorizeComputerPublication: controllerMocks.authorize,
}))
vi.mock('./ConvexFileRepository', () => ({
  ConvexFileRepository: class {},
}))
vi.mock('./FileService', () => ({
  FileService: class {
    constructor() {
      return controllerMocks.service
    }
  },
}))
vi.mock('./http', () => ({ fileService: controllerMocks.service }))

const execFileAsync = promisify(execFile)

function localComputer(audit?: { commands: string[]; written: Array<{ path: string; contents: Uint8Array; mode?: number }> }): ComputerPublicationInstance {
  return {
    async writeFiles(files) {
      audit?.written.push(...files)
      for (const file of files) {
        await writeFile(file.path, file.contents, { mode: file.mode })
      }
    },
    async runCommand({ command }) {
      audit?.commands.push(command)
      let result: { exitCode: number; stdout: string }
      if (command.startsWith('python3 ')) {
        const [, script, config] = command.split(' ')
        try {
          const output = await execFileAsync('python3', [script!, config!], { maxBuffer: 1024 * 1024 })
          result = { exitCode: 0, stdout: output.stdout }
        } catch (error) {
          const failure = error as { code?: number; stdout?: string }
          result = { exitCode: typeof failure.code === 'number' ? failure.code : 1, stdout: failure.stdout ?? '' }
        }
      } else {
        const paths = command.split(' ').slice(3)
        await Promise.all(paths.map(path => unlink(path).catch(() => undefined)))
        result = { exitCode: 0, stdout: '' }
      }
      return { wait: async () => result }
    },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  controllerMocks.authorize.mockResolvedValue({
    actorUserId: 'user',
    runId: 'run',
    workflowRunId: 'workflow',
  })
  controllerMocks.service.getComputerArtifactMaxBytes.mockReturnValue(1024 * 1024)
})

test('uses the caller actor and workspace rather than authority fields before touching publication state', async () => {
  controllerMocks.authorize.mockImplementation(async ({ userId, workspaceId, artifactPublicationAuthority }) => {
    const access = artifactPublicationAuthority?.access
    if (userId !== access?.actorUserId || workspaceId !== access?.workspaceId || !workspaceId) {
      throw new Error('HARNESS_PUBLICATION_NOT_AUTHORIZED')
    }
    return { actorUserId: userId, runId: 'run', workflowRunId: 'workflow' }
  })
  for (const identity of [
    { userId: 'caller', workspaceId: 'workspace', authorityUserId: 'authority-user', authorityWorkspaceId: 'workspace' },
    { userId: 'caller', workspaceId: 'other-workspace', authorityUserId: 'caller', authorityWorkspaceId: 'workspace' },
  ]) {
    const resolveComputer = vi.fn()
    const result = await publishComputerFile({
      request: {
        artifactId: 'mismatch',
        sourcePath: '/tmp/mismatch.mp4',
        name: 'mismatch.mp4',
        mimeType: 'video/mp4',
        scope: 'personal',
      },
      authority: {
        kind: 'native',
        access: {
          actorUserId: identity.authorityUserId,
          workspaceId: identity.authorityWorkspaceId,
        } as never,
        context: {} as never,
      },
      userId: identity.userId,
      workspaceId: identity.workspaceId,
      resolveComputer,
    })
    expect(result).toMatchObject({ success: false, error: 'HARNESS_PUBLICATION_NOT_AUTHORIZED' })
    expect(resolveComputer).not.toHaveBeenCalled()
  }
  expect(controllerMocks.service.getComputerArtifact).not.toHaveBeenCalled()
  expect(controllerMocks.service.prepareComputerArtifact).not.toHaveBeenCalled()
  expect(controllerMocks.service.getComputerArtifactUploadUrl).not.toHaveBeenCalled()
  expect(controllerMocks.service.verifyAndCommitComputerArtifact).not.toHaveBeenCalled()
  expect(controllerMocks.authorize).toHaveBeenCalledTimes(2)
})

test('revocation after the source snapshot prevents scoped signing and upload', async () => {
  const sourcePath = `/tmp/overlay-revoked-${randomUUID()}.bin`
  await writeFile(sourcePath, Buffer.from('source bytes'), { mode: 0o600 })
  controllerMocks.service.getComputerArtifact.mockResolvedValue(null)
  controllerMocks.authorize
    .mockResolvedValueOnce({ actorUserId: 'user', runId: 'run', workflowRunId: 'workflow' })
    .mockResolvedValueOnce({ actorUserId: 'user', runId: 'run', workflowRunId: 'workflow' })
    .mockRejectedValueOnce(new Error('HARNESS_PUBLICATION_NOT_AUTHORIZED'))
  controllerMocks.service.prepareComputerArtifact.mockResolvedValue({
    artifactId: 'revoked',
    sourcePath,
    name: 'revoked.mp4',
    mimeType: 'video/mp4',
    scope: 'personal',
    sourceComputerId: 'computer-1',
    stagingPath: `/tmp/overlay-artifact-${randomUUID()}.bin`,
    checksumSha256: 'a'.repeat(64),
    sizeBytes: 12,
    userId: 'user',
    workspaceId: 'workspace',
    rootRunId: 'root',
    r2Key: 'private-key',
    uploadExpiresAt: Date.now() + 60_000,
    createdAt: 1,
    updatedAt: 1,
  })
  const resolveComputer = vi.fn(async () => ({
    ok: true as const,
    computer: { id: 'computer-1' },
    operate: async <T>(operation: (instance: ComputerPublicationInstance) => Promise<T>) =>
      await operation(localComputer()),
  }))
  try {
    const result = await publishComputerFile({
      request: {
        artifactId: 'revoked',
        sourcePath,
        name: 'revoked.mp4',
        mimeType: 'video/mp4',
        scope: 'personal',
      },
      authority: {
        kind: 'native',
        access: { actorUserId: 'user', workspaceId: 'workspace' } as never,
        context: {} as never,
      },
      userId: 'user',
      workspaceId: 'workspace',
      resolveComputer,
    })
    expect(result).toMatchObject({ success: false, error: 'HARNESS_PUBLICATION_NOT_AUTHORIZED' })
    expect(controllerMocks.service.prepareComputerArtifact).toHaveBeenCalled()
    expect(controllerMocks.service.getComputerArtifactUploadUrl).not.toHaveBeenCalled()
  } finally {
    await unlink(sourcePath).catch(() => undefined)
  }
})

test('returns a verified publication when post-commit Computer cleanup fails', async () => {
  const sourcePath = `/tmp/overlay-cleanup-${randomUUID()}.bin`
  await writeFile(sourcePath, Buffer.from('cleanup bytes'), { mode: 0o600 })
  const server = createServer((_request, response) => response.writeHead(200).end())
  const origin = await listen(server)
  const artifact = {
    artifactId: 'cleanup',
    sourcePath,
    name: 'cleanup.mp4',
    mimeType: 'video/mp4',
    scope: 'personal' as const,
    artifactIdentity: JSON.stringify(['root', 'cleanup']),
    fileId: 'files:cleanup',
    rootRunId: 'root',
    checksumSha256: 'a'.repeat(64),
    sizeBytes: 13,
    workspaceId: 'workspace',
  }
  controllerMocks.service.getComputerArtifact.mockResolvedValue(null)
  controllerMocks.service.prepareComputerArtifact.mockImplementation(async ({ input, snapshot }) => ({
    ...input,
    ...snapshot,
    userId: 'user',
    workspaceId: 'workspace',
    rootRunId: 'root',
    r2Key: 'private-key',
    uploadExpiresAt: Date.now() + 60_000,
    createdAt: 1,
    updatedAt: 1,
  }))
  controllerMocks.service.getComputerArtifactUploadUrl.mockResolvedValue(`${origin}/upload`)
  controllerMocks.service.verifyAndCommitComputerArtifact.mockResolvedValue({ kind: 'published', artifact })
  let operations = 0
  const resolveComputer = vi.fn(async () => ({
    ok: true as const,
    computer: { id: 'computer-1' },
    operate: async <T>(operation: (instance: ComputerPublicationInstance) => Promise<T>) => {
      operations += 1
      if (operations === 3) throw new Error('Computer stopped during cleanup')
      return await operation(localComputer())
    },
  }))
  try {
    const result = await publishComputerFile({
      request: {
        artifactId: 'cleanup',
        sourcePath,
        name: 'cleanup.mp4',
        mimeType: 'video/mp4',
        scope: 'personal',
      },
      authority: {
        kind: 'native',
        access: { actorUserId: 'user', workspaceId: 'workspace' } as never,
        context: {} as never,
      },
      userId: 'user',
      workspaceId: 'workspace',
      resolveComputer,
    })
    expect(result).toEqual({ success: true, artifact })
    expect(operations).toBe(3)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await unlink(sourcePath).catch(() => undefined)
  }
})

test('normalizes only allowlisted failure identifiers and keeps unknown errors opaque', () => {
  const cases = [
    [new Error('Uncaught Error: storage_limit_exceeded: used=1 cap=0'), 'storage_limit_exceeded', false],
    [new Error('R2GlobalBudgetError: r2_global_budget_exceeded: used=1 cap=0'), 'r2_global_budget_exceeded', false],
    [new Error('ARTIFACT_UPLOAD_UNCERTAIN'), 'ARTIFACT_UPLOAD_UNCERTAIN', true],
    [new Error('ConvexError: {"code":"WORKSPACE_ACCESS_DENIED"}'), 'WORKSPACE_ACCESS_DENIED', false],
    [new Error('Uncaught Error: HARNESS_ACCESS_DENIED'), 'HARNESS_ACCESS_DENIED', false],
    [new Error('Uncaught Error: Unauthorized'), 'Unauthorized', false],
    [new Error('artifact_identity_conflict'), 'artifact_identity_conflict', false],
    [new Error('artifact_manifest_not_found'), 'artifact_manifest_not_found', false],
    [new Error('artifact_destination_mismatch'), 'artifact_destination_mismatch', false],
    [new Error('ARTIFACT_AUTHORITY_EXPIRED'), 'ARTIFACT_AUTHORITY_EXPIRED', false],
    [new Error('ARTIFACT_HEAD_FAILED'), 'ARTIFACT_HEAD_FAILED', true],
    [new Error('ARTIFACT_READBACK_FAILED'), 'ARTIFACT_READBACK_FAILED', true],
    [new Error('COMPUTER_UNAVAILABLE: internal details'), 'COMPUTER_UNAVAILABLE', false],
    [{ payload: { error: 'File type not allowed: application/x-test' } }, 'FILE_MIME_NOT_ALLOWED', false],
    [{ payload: { error: 'File is too large for direct upload. 100MiB' } }, 'ARTIFACT_SIZE_LIMIT_EXCEEDED', false],
    [new Error('provider failed at https://signed.example/token'), 'ARTIFACT_PUBLICATION_UNKNOWN', true],
  ] as const
  for (const [error, code, retryable] of cases) {
    const result = safeFailure(error)
    expect(result.error).toBe(code)
    expect(result.retryable).toBe(retryable)
    expect(JSON.stringify(result)).not.toContain('https://')
    if (code === 'COMPUTER_UNAVAILABLE') expect(result.message).toContain('Computer access is unavailable')
  }
})

function listen(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('Local HTTP server did not bind'))
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

test('Computer helper snapshots and streams >256 KiB binary bytes with exact upload constraints', async () => {
  const bytes = Buffer.alloc(512 * 1024 + 13)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) % 256
  const sourcePath = `/tmp/overlay-computer-source-${randomUUID()}.bin`
  const stagingPath = `/tmp/overlay-artifact-${randomUUID()}.bin`
  const audit = { commands: [] as string[], written: [] as Array<{ path: string; contents: Uint8Array; mode?: number }> }
  await writeFile(sourcePath, bytes, { mode: 0o600 })
  const digest = createHash('sha256').update(bytes).digest('hex')
  let uploaded = Buffer.alloc(0)
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      uploaded = Buffer.concat(chunks)
      expect(request.method).toBe('PUT')
      expect(request.headers['content-length']).toBe(String(bytes.length))
      expect(request.headers['content-type']).toBe('video/mp4')
      expect(request.headers['if-none-match']).toBe('*')
      expect(request.headers['x-amz-checksum-sha256']).toBe(Buffer.from(digest, 'hex').toString('base64'))
      response.writeHead(200).end()
    })
  })
  const origin = await listen(server)
  try {
    const computer = localComputer(audit)
    const snapshot = await runHelper(computer, {
      operation: 'snapshot',
      sourcePath,
      savedPath: null,
      newPath: stagingPath,
      expectedChecksum: null,
      expectedSize: null,
      maxBytes: 1024 * 1024,
    })
    expect(snapshot).toMatchObject({
      kind: 'snapshot',
      path: stagingPath,
      sizeBytes: bytes.length,
      checksumSha256: digest,
    })
    const upload = await runHelper(computer, {
      operation: 'upload',
      stagingPath,
      url: `${origin}/upload`,
      sizeBytes: bytes.length,
      checksumSha256: digest,
      mimeType: 'video/mp4',
      maxBytes: 1024 * 1024,
    })
    expect(upload).toEqual({ kind: 'uploaded' })
    expect(uploaded).toEqual(bytes)
    expect(JSON.stringify(upload)).not.toContain(origin)
    expect(audit.written.every(file => file.mode === 0o600)).toBe(true)
    expect(audit.commands.join('\n')).not.toContain(origin)
    expect(audit.written.map(file => new TextDecoder().decode(file.contents)).join('\n')).toContain(origin)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await unlink(sourcePath).catch(() => undefined)
    await unlink(stagingPath).catch(() => undefined)
  }
})

test('a finalized retry returns the canonical Files artifact without resolving a Computer', async () => {
  const manifest = {
    artifactId: 'film-final',
    sourcePath: '/tmp/final.mp4',
    name: 'film.mp4',
    mimeType: 'video/mp4',
    scope: 'personal',
    sourceComputerId: 'computer-old',
    stagingPath: '/tmp/overlay-artifact-final.mp4',
    checksumSha256: 'a'.repeat(64),
    sizeBytes: 5,
    userId: 'user',
    workspaceId: 'workspace',
    rootRunId: 'root',
    r2Key: 'private-object-key',
    uploadExpiresAt: Date.now() + 60_000,
    fileId: 'files:published',
    createdAt: 1,
    updatedAt: 1,
  }
  controllerMocks.service.getComputerArtifact.mockResolvedValue(manifest)
  const resolveComputer = vi.fn()
  const result = await publishComputerFile({
    request: {
      artifactId: manifest.artifactId,
      sourcePath: manifest.sourcePath,
      name: manifest.name,
      mimeType: manifest.mimeType,
      scope: 'personal',
    },
    authority: {
      kind: 'native',
      access: { actorUserId: 'user', workspaceId: 'workspace' } as never,
      context: {} as never,
    },
    userId: 'user',
    workspaceId: 'workspace',
    resolveComputer,
  })
  expect(resolveComputer).not.toHaveBeenCalled()
  expect(result).toMatchObject({ success: true, artifact: { fileId: 'files:published', rootRunId: 'root' } })
  expect(JSON.stringify(result)).not.toContain('private-object-key')
})

test('a missing Computer source does not allocate a Files publication', async () => {
  controllerMocks.service.getComputerArtifact.mockResolvedValue(null)
  const resolveComputer = vi.fn(async () => ({
    ok: true as const,
    computer: { id: 'computer-1' },
    operate: async <T>(operation: (instance: ComputerPublicationInstance) => Promise<T>) =>
      await operation(localComputer()),
  }))
  const result = await publishComputerFile({
    request: {
      artifactId: 'missing-source',
      sourcePath: `/tmp/overlay-missing-${randomUUID()}.mp4`,
      name: 'missing.mp4',
      mimeType: 'video/mp4',
      scope: 'personal',
    },
    authority: {
      kind: 'native',
      access: { actorUserId: 'user', workspaceId: 'workspace' } as never,
      context: {} as never,
    },
    userId: 'user',
    workspaceId: 'workspace',
    resolveComputer,
  })
  expect(result).toMatchObject({ success: false, error: 'ARTIFACT_SOURCE_UNAVAILABLE' })
  expect(controllerMocks.service.prepareComputerArtifact).not.toHaveBeenCalled()
  expect(controllerMocks.service.verifyAndCommitComputerArtifact).not.toHaveBeenCalled()
})

test('a restored Computer cannot change bytes pinned to an existing artifactId', async () => {
  const sourcePath = `/tmp/overlay-computer-pinned-${randomUUID()}.bin`
  await writeFile(sourcePath, Buffer.from('different bytes'), { mode: 0o600 })
  controllerMocks.service.getComputerArtifact.mockResolvedValue({
    artifactId: 'film-pinned',
    sourcePath,
    name: 'film.mp4',
    mimeType: 'video/mp4',
    scope: 'personal',
    sourceComputerId: 'computer-old',
    stagingPath: '/tmp/removed-staging.bin',
    checksumSha256: '0'.repeat(64),
    sizeBytes: 15,
    userId: 'user',
    workspaceId: 'workspace',
    rootRunId: 'root',
    r2Key: 'private-object-key',
    uploadExpiresAt: Date.now() + 60_000,
    createdAt: 1,
    updatedAt: 1,
  })
  controllerMocks.service.verifyAndCommitComputerArtifact.mockResolvedValue({ kind: 'missing' })
  const resolveComputer = vi.fn(async () => ({
    ok: true as const,
    computer: { id: 'computer-restored' },
    operate: async <T>(operation: (instance: ComputerPublicationInstance) => Promise<T>) =>
      await operation(localComputer()),
  }))
  try {
    const result = await publishComputerFile({
      request: {
        artifactId: 'film-pinned',
        sourcePath,
        name: 'film.mp4',
        mimeType: 'video/mp4',
        scope: 'personal',
      },
      authority: {
        kind: 'native',
        access: { actorUserId: 'user', workspaceId: 'workspace' } as never,
        context: {} as never,
      },
      userId: 'user',
      workspaceId: 'workspace',
      resolveComputer,
    })
    expect(result).toMatchObject({ success: false, error: 'artifact_identity_conflict' })
    expect(controllerMocks.service.prepareComputerArtifact).not.toHaveBeenCalled()
  } finally {
    await unlink(sourcePath).catch(() => undefined)
  }
})

test('a prepared object is reconciled before Computer resolution', async () => {
  const manifest = {
    artifactId: 'film-final',
    sourcePath: '/tmp/final.mp4',
    name: 'film.mp4',
    mimeType: 'video/mp4',
    scope: 'personal',
    sourceComputerId: 'computer-old',
    stagingPath: '/tmp/overlay-artifact-final.mp4',
    checksumSha256: 'a'.repeat(64),
    sizeBytes: 5,
    userId: 'user',
    workspaceId: 'workspace',
    rootRunId: 'root',
    r2Key: 'private-object-key',
    uploadExpiresAt: Date.now() + 60_000,
    createdAt: 1,
    updatedAt: 1,
  }
  const artifact = {
    artifactId: manifest.artifactId,
    sourcePath: manifest.sourcePath,
    name: manifest.name,
    mimeType: manifest.mimeType,
    scope: manifest.scope,
    artifactIdentity: JSON.stringify([manifest.rootRunId, manifest.artifactId]),
    fileId: 'files:published',
    rootRunId: manifest.rootRunId,
    checksumSha256: manifest.checksumSha256,
    sizeBytes: manifest.sizeBytes,
    workspaceId: manifest.workspaceId,
  }
  controllerMocks.service.getComputerArtifact.mockResolvedValue(manifest)
  controllerMocks.service.verifyAndCommitComputerArtifact.mockResolvedValue({ kind: 'published', artifact })
  const resolveComputer = vi.fn()
  const result = await publishComputerFile({
    request: {
      artifactId: manifest.artifactId,
      sourcePath: manifest.sourcePath,
      name: manifest.name,
      mimeType: manifest.mimeType,
      scope: 'personal',
    },
    authority: {
      kind: 'native',
      access: { actorUserId: 'user', workspaceId: 'workspace' } as never,
      context: {} as never,
    },
    userId: 'user',
    workspaceId: 'workspace',
    resolveComputer,
  })
  expect(resolveComputer).not.toHaveBeenCalled()
  expect(controllerMocks.service.verifyAndCommitComputerArtifact).toHaveBeenCalledWith({
    manifest,
    authority: expect.any(Object),
  })
  expect(result).toEqual({ success: true, artifact })
})

test('a restored Computer with identical bytes refreshes an expired URL for the frozen artifact', async () => {
  const bytes = Buffer.alloc(320 * 1024 + 11, 0x2a)
  const sourcePath = `/tmp/overlay-computer-retry-${randomUUID()}.bin`
  const digest = createHash('sha256').update(bytes).digest('hex')
  const urls: string[] = []
  const receivedSizes: number[] = []
  let uploaded = 0
  const server = createServer((request, response) => {
    let received = 0
    request.on('data', (chunk: Buffer) => { received += chunk.length })
    request.on('end', () => {
      receivedSizes.push(received)
      uploaded += 1
      response.writeHead(uploaded === 1 ? 403 : 200).end()
    })
  })
  const origin = await listen(server)
  await writeFile(sourcePath, bytes, { mode: 0o600 })
  const manifestBase = {
    userId: 'user',
    workspaceId: 'workspace',
    rootRunId: 'root',
    artifactId: 'film-final',
    sourcePath,
    name: 'film.mp4',
    mimeType: 'video/mp4',
    scope: 'personal' as const,
    sourceComputerId: 'computer-old',
    stagingPath: '/tmp/removed-staging.bin',
    checksumSha256: digest,
    sizeBytes: bytes.length,
    r2Key: 'private-object-key',
    uploadExpiresAt: Date.now() + 60_000,
    createdAt: 1,
    updatedAt: 1,
  }
  const artifact = {
    artifactId: manifestBase.artifactId,
    sourcePath,
    name: 'film.mp4',
    mimeType: 'video/mp4',
    scope: 'personal',
    artifactIdentity: JSON.stringify(['root', 'film-final']),
    fileId: 'files:published',
    rootRunId: 'root',
    checksumSha256: digest,
    sizeBytes: bytes.length,
    workspaceId: 'workspace',
  }
  controllerMocks.service.getComputerArtifact.mockResolvedValue(manifestBase)
  controllerMocks.service.prepareComputerArtifact.mockImplementation(async ({ input, snapshot }) => ({
    ...manifestBase,
    ...input,
    ...snapshot,
  }))
  controllerMocks.service.getComputerArtifactUploadUrl.mockImplementation(async () => {
    const url = `${origin}/upload?token=${urls.length + 1}`
    urls.push(url)
    return url
  })
  controllerMocks.service.verifyAndCommitComputerArtifact
    .mockResolvedValueOnce({ kind: 'missing' })
    .mockResolvedValueOnce({ kind: 'missing' })
    .mockResolvedValueOnce({ kind: 'published', artifact })
  const audit = { commands: [] as string[], written: [] as Array<{ path: string; contents: Uint8Array; mode?: number }> }
  const resolveComputer = vi.fn(async () => ({
    ok: true as const,
    computer: { id: 'computer-1' },
    operate: async <T>(operation: (instance: ComputerPublicationInstance) => Promise<T>) =>
      await operation(localComputer(audit)),
  }))
  try {
    const result = await publishComputerFile({
      request: {
        artifactId: 'film-final',
        sourcePath,
        name: 'film.mp4',
        mimeType: 'video/mp4',
        scope: 'personal',
      },
      authority: {
        kind: 'native',
        access: { actorUserId: 'user', workspaceId: 'workspace' } as never,
        context: {} as never,
      },
      userId: 'user',
      workspaceId: 'workspace',
      resolveComputer,
    })
    expect(uploaded).toBe(2)
    expect(receivedSizes).toEqual([bytes.length, bytes.length])
    expect(urls).toHaveLength(2)
    expect(controllerMocks.service.getComputerArtifactUploadUrl).toHaveBeenCalledTimes(2)
    expect(controllerMocks.service.verifyAndCommitComputerArtifact).toHaveBeenCalledTimes(3)
    expect(result).toEqual({ success: true, artifact })
    expect(JSON.stringify(result)).not.toContain(origin)
    expect(audit.commands.join('\n')).not.toContain(origin)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await unlink(sourcePath).catch(() => undefined)
  }
})

test('the controller reconciles after the upload acknowledgement is lost', async () => {
  const bytes = Buffer.alloc(300 * 1024 + 5, 0x6b)
  const sourcePath = `/tmp/overlay-computer-ack-${randomUUID()}.bin`
  const digest = createHash('sha256').update(bytes).digest('hex')
  let storedBytes = 0
  const server = createServer((request) => {
    request.on('data', (chunk: Buffer) => { storedBytes += chunk.length })
    request.on('end', () => request.socket.destroy())
  })
  const origin = await listen(server)
  await writeFile(sourcePath, bytes, { mode: 0o600 })
  const artifact = {
    artifactId: 'film-ack',
    sourcePath,
    name: 'film.mp4',
    mimeType: 'video/mp4',
    scope: 'personal',
    artifactIdentity: JSON.stringify(['root', 'film-ack']),
    fileId: 'files:published',
    rootRunId: 'root',
    checksumSha256: digest,
    sizeBytes: bytes.length,
    workspaceId: 'workspace',
  }
  const manifest = {
    artifactId: 'film-ack',
    sourcePath,
    name: 'film.mp4',
    mimeType: 'video/mp4',
    scope: 'personal' as const,
    sourceComputerId: 'computer-1',
    stagingPath: `/tmp/overlay-staged-${randomUUID()}.bin`,
    checksumSha256: digest,
    sizeBytes: bytes.length,
    userId: 'user',
    workspaceId: 'workspace',
    rootRunId: 'root',
    r2Key: 'private-object-key',
    uploadExpiresAt: Date.now() + 60_000,
    createdAt: 1,
    updatedAt: 1,
  }
  controllerMocks.service.getComputerArtifact.mockResolvedValue(null)
  controllerMocks.service.prepareComputerArtifact.mockImplementation(async ({ input, snapshot }) => ({
    ...manifest,
    ...input,
    ...snapshot,
  }))
  controllerMocks.service.getComputerArtifactUploadUrl.mockResolvedValue(`${origin}/upload`)
  controllerMocks.service.verifyAndCommitComputerArtifact.mockResolvedValueOnce({ kind: 'published', artifact })
  const resolveComputer = vi.fn(async () => ({
    ok: true as const,
    computer: { id: 'computer-1' },
    operate: async <T>(operation: (instance: ComputerPublicationInstance) => Promise<T>) =>
      await operation(localComputer()),
  }))
  try {
    const result = await publishComputerFile({
      request: {
        artifactId: manifest.artifactId,
        sourcePath,
        name: manifest.name,
        mimeType: manifest.mimeType,
        scope: manifest.scope,
      },
      authority: {
        kind: 'native',
        access: { actorUserId: 'user', workspaceId: 'workspace' } as never,
        context: {} as never,
      },
      userId: 'user',
      workspaceId: 'workspace',
      resolveComputer,
    })
    expect(storedBytes).toBe(bytes.length)
    expect(controllerMocks.service.getComputerArtifactUploadUrl).toHaveBeenCalledTimes(1)
    expect(controllerMocks.service.verifyAndCommitComputerArtifact).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ success: true, artifact })
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await unlink(sourcePath).catch(() => undefined)
  }
})

test('streaming readback verifies a large object and rejects checksum, size, and missing-object mismatches', async () => {
  const bytes = Buffer.alloc(320 * 1024 + 7, 0x4d)
  const digest = createHash('sha256').update(bytes).digest('hex')
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(bytes.length) })
    response.end(bytes)
  })
  const url = await listen(server)
  const common = {
    key: 'private-key',
    sizeBytes: bytes.length,
    mimeType: 'video/mp4',
    checksumSha256: digest,
    maxBytes: bytes.length,
    headObject: async () => ({ sizeBytes: bytes.length, contentType: 'video/mp4' }),
    generatePresignedDownloadUrl: async () => url,
  }
  try {
    await expect(verifyArtifactObject(common)).resolves.toMatchObject({
      kind: 'verified',
      checksumSha256: digest,
      sizeBytes: bytes.length,
    })
    await expect(verifyArtifactObject({ ...common, checksumSha256: '0'.repeat(64) }))
      .rejects.toThrow('ARTIFACT_CHECKSUM_MISMATCH')
    await expect(verifyArtifactObject({ ...common, maxBytes: bytes.length - 1 }))
      .rejects.toThrow('ARTIFACT_READBACK_OVERSIZE')
    await expect(verifyArtifactObject({ ...common, headObject: async () => null }))
      .resolves.toEqual({ kind: 'missing' })
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
