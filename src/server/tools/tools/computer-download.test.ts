import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { SandboxInstance } from '@overlay/sandbox-runtime'
import { executeComputerDownloadFile } from './overlay-executes'
import type { ComputerTarget, OverlayToolsOptions } from './types'

type FileMetadata = {
  type: 'file' | 'folder'
  name?: string
  userId?: string
  workspaceId?: string
  scope?: 'personal' | 'workspace'
  kind?: string
  sizeBytes?: number
  isStorageBacked?: boolean
  textInObjectStore?: boolean
}

type FixtureInput = {
  metadata?: Partial<FileMetadata>
  metadataError?: Error
  bytes?: Uint8Array | null
  readError?: Error
  location?: 'cloud' | 'local'
  writeError?: Error
  commandStdout?: string
  commandExitCode?: number
  resolution?: unknown
}

const defaultBytes = new Uint8Array([0, 255, 11, 128, 3])
const defaultTempDirectory = '/tmp/overlay-download.ABCdef1234'
const localWorkingDirectory = '/Users/test/Approved'
const localTempDirectory = `${localWorkingDirectory}/.overlay-download.ABCdef1234`
const metadata: FileMetadata = {
  type: 'file',
  name: 'source-video.mp4',
  userId: 'another-member',
  workspaceId: 'workspace_1',
  scope: 'workspace',
  sizeBytes: defaultBytes.byteLength,
  isStorageBacked: true,
}

function options(allowedToolIds: string[] = ['computer_download_file', 'read_file']): OverlayToolsOptions {
  return {
    userId: 'user_1',
    workspaceId: 'workspace_1',
    allowedToolIds,
  }
}

function fixture(input: FixtureInput = {}) {
  const calls: {
    metadataArgs?: Record<string, unknown>
    readArgs?: Record<string, unknown>
    target?: ComputerTarget
    command?: Record<string, unknown>
    writes: Array<{ path: string; contents: Uint8Array }>
  } = { writes: [] }
  const files = {
    async getOrListFiles(args: Record<string, unknown>) {
      calls.metadataArgs = args
      if (input.metadataError) throw input.metadataError
      return { ...metadata, ...input.metadata }
    },
    async readFileBytes(args: Record<string, unknown>) {
      calls.readArgs = args
      if (input.readError) throw input.readError
      return input.bytes === undefined ? defaultBytes : input.bytes
    },
  }
  const instance = {
    async runCommand(request: Record<string, unknown>) {
      calls.command = request
      return {
        async wait() {
          return {
            exitCode: input.commandExitCode ?? 0,
            stdout: input.commandStdout ?? (input.location === 'local' ? localTempDirectory : defaultTempDirectory),
            stderr: '',
            startedAt: 0,
            endedAt: 1,
          }
        },
      }
    },
    async workingDirectory() {
      return localWorkingDirectory
    },
    async writeFiles(writes: Array<{ path: string; contents: Uint8Array }>) {
      calls.writes.push(...writes)
      if (input.writeError) throw input.writeError
    },
  } as unknown as SandboxInstance
  const resolution = input.resolution ?? {
    ok: true,
    computer: { id: 'computer_1', location: input.location ?? 'cloud' },
    async operate(operation: (instance: SandboxInstance, computer: { controlledByUserId: undefined }) => Promise<unknown>) {
      return operation(instance, { controlledByUserId: undefined })
    },
  }
  const resolveComputer = async (_options: OverlayToolsOptions, selection: { target?: ComputerTarget }) => {
    calls.target = selection.target
    return resolution
  }
  return {
    calls,
    dependencies: {
      files: files as never,
      resolveComputer: resolveComputer as never,
    },
  }
}

test('computer_download_file transfers exact binary bytes to a generated path and reports the source hash', async () => {
  const state = fixture({ metadata: { name: 'source video.mp4' } })
  const result = await executeComputerDownloadFile(options(), { fileId: ' file_1 ' }, state.dependencies)

  assert.equal(result.success, true)
  if (!result.success) return
  assert.equal(result.fileId, 'file_1')
  assert.equal(result.path, `${defaultTempDirectory}/source video.mp4`)
  assert.equal(result.sizeBytes, defaultBytes.byteLength)
  assert.equal(result.sourceChecksumSha256, createHash('sha256').update(defaultBytes).digest('hex'))
  assert.equal(result.computerId, 'computer_1')
  assert.deepEqual(state.calls.readArgs, {
    fileId: 'file_1',
    userId: 'user_1',
    maximumBytes: 50 * 1024 * 1024,
    workspaceId: 'workspace_1',
    scope: undefined,
  })
  assert.deepEqual(state.calls.writes, [{ path: result.path, contents: defaultBytes }])
  assert.equal(state.calls.command?.command, 'mktemp -d /tmp/overlay-download.XXXXXXXXXX')
  assert.deepEqual(Object.keys(result).sort(), [
    'computerId',
    'fileId',
    'path',
    'sizeBytes',
    'sourceChecksumSha256',
    'success',
  ])
  assert.doesNotMatch(JSON.stringify(result), /https?:|r2Key|token/i)
})

test('computer_download_file execution requires both grants', async () => {
  for (const grants of [['computer_download_file'], ['read_file']]) {
    const state = fixture()
    await assert.rejects(
      executeComputerDownloadFile(options(grants), { fileId: 'file_1' }, state.dependencies),
      /not allowed|not exposed/i,
    )
    assert.equal(state.calls.metadataArgs, undefined)
  }
})

test('computer_download_file denies inaccessible sources and missing Computers', async () => {
  const inaccessible = fixture({ metadataError: Object.assign(new Error('Not found'), { statusCode: 404 }) })
  const denied = await executeComputerDownloadFile(options(), { fileId: 'file_1' }, inaccessible.dependencies)
  assert.deepEqual(denied, { success: false, error: 'File not found or not readable.' })

  const noComputer = fixture({ resolution: { ok: false, error: 'No Computer is bound.' } })
  const unavailable = await executeComputerDownloadFile(options(), { fileId: 'file_1' }, noComputer.dependencies)
  assert.deepEqual(unavailable, { success: false, error: 'No Computer is bound.' })
  assert.equal(noComputer.calls.readArgs, undefined)
})

test('computer_download_file rejects folders, notes, missing objects and oversized metadata', async () => {
  const cases: Array<{ input: FixtureInput; error: string }> = [
    { input: { metadata: { type: 'folder' } }, error: 'folder' },
    { input: { metadata: { kind: 'note' } }, error: 'note' },
    { input: { metadata: { isStorageBacked: false } }, error: 'no downloadable object' },
    { input: { metadata: { sizeBytes: 50 * 1024 * 1024 + 1 } }, error: 'too large' },
    { input: { location: 'local', metadata: { sizeBytes: 450 * 1024 + 1 } }, error: 'too large' },
  ]
  for (const { input, error } of cases) {
    const state = fixture(input)
    const result = await executeComputerDownloadFile(options(), { fileId: 'file_1' }, state.dependencies)
    assert.equal(result.success, false)
    assert.match(result.error ?? '', new RegExp(error, 'i'))
    assert.equal(state.calls.readArgs, undefined)
    assert.equal(state.calls.writes.length, 0)
  }

  const noBytes = fixture({ bytes: null })
  const missingObject = await executeComputerDownloadFile(options(), { fileId: 'file_1' }, noBytes.dependencies)
  assert.match(missingObject.error ?? '', /no downloadable object/i)
})

test('computer_download_file checks actual bytes and reports write failures without provider details', async () => {
  const tooManyBytes = fixture({ location: 'local', metadata: { sizeBytes: 1 }, bytes: new Uint8Array(450 * 1024 + 1) })
  const oversized = await executeComputerDownloadFile(options(), { fileId: 'file_1', target: 'local' }, tooManyBytes.dependencies)
  assert.match(oversized.error ?? '', /too large/i)
  assert.equal(tooManyBytes.calls.writes.length, 0)

  const writeFailure = fixture({ writeError: new Error('private storage token') })
  const failed = await executeComputerDownloadFile(options(), { fileId: 'file_1' }, writeFailure.dependencies)
  assert.deepEqual(failed, { success: false, error: 'Could not write the file to the Computer.' })
  assert.doesNotMatch(JSON.stringify(failed), /private storage token/i)
})

test('local Computer downloads stay inside the approved working directory', async () => {
  const state = fixture({ location: 'local' })
  const result = await executeComputerDownloadFile(options(), { fileId: 'file_1', target: 'local' }, state.dependencies)
  assert.equal(result.success, true)
  if (!result.success) return
  assert.equal(result.path, `${localTempDirectory}/source-video.mp4`)
  assert.equal(state.calls.command?.command, 'mktemp -d "$PWD"/.overlay-download.XXXXXXXXXX')
  assert.equal(state.calls.command?.cwd, localWorkingDirectory)
})

test('computer_download_file rejects a malformed mktemp path', async () => {
  const state = fixture({ commandStdout: '/home/user/not-a-temp-directory' })
  const result = await executeComputerDownloadFile(options(), { fileId: 'file_1' }, state.dependencies)
  assert.deepEqual(result, { success: false, error: 'Could not prepare a temporary destination on the Computer.' })
  assert.equal(state.calls.writes.length, 0)
})

test('computer_download_file transfers workspace files owned by another member in shared rooms', async () => {
  const state = fixture()
  const result = await executeComputerDownloadFile(
    { ...options(), sharedRoom: true },
    { fileId: 'file_1' },
    state.dependencies,
  )
  assert.equal(result.success, true)
  assert.equal(state.calls.metadataArgs?.workspaceId, 'workspace_1')
  assert.equal(state.calls.readArgs?.scope, 'workspace')
  assert.equal(state.calls.writes.length, 1)
})

test('computer_download_file requires a workspace before looking up the source', async () => {
  const state = fixture()
  const result = await executeComputerDownloadFile(
    { ...options(), workspaceId: undefined },
    { fileId: 'file_1' },
    state.dependencies,
  )
  assert.deepEqual(result, { success: false, error: 'A workspace is required to transfer this file.' })
  assert.equal(state.calls.metadataArgs, undefined)
})

test('computer_download_file allows readable personal files outside shared rooms', async () => {
  const state = fixture({ metadata: { scope: 'personal', userId: 'user_1' } })
  const result = await executeComputerDownloadFile(options(), { fileId: 'file_1' }, state.dependencies)
  assert.equal(result.success, true)
  assert.equal(state.calls.readArgs?.workspaceId, 'workspace_1')
  assert.equal(state.calls.readArgs?.scope, undefined)
})

test('computer_download_file denies personal sources in shared rooms and wrong workspaces everywhere', async () => {
  const personal = fixture({ metadata: { scope: 'personal' } })
  const personalResult = await executeComputerDownloadFile(
    { ...options(), sharedRoom: true },
    { fileId: 'file_1' },
    personal.dependencies,
  )
  assert.equal(personalResult.success, false)
  assert.match(personalResult.error ?? '', /workspace/i)
  assert.equal(personal.calls.readArgs, undefined)

  for (const sharedRoom of [true, false]) {
    const state = fixture({ metadata: { workspaceId: 'workspace_2' } })
    const result = await executeComputerDownloadFile(
      { ...options(), sharedRoom },
      { fileId: 'file_1' },
      state.dependencies,
    )
    assert.equal(result.success, false)
    assert.match(result.error ?? '', /workspace/i)
    assert.equal(state.calls.readArgs, undefined)
    assert.equal(state.calls.writes.length, 0)
  }
})

test('computer_download_file rejects a source whose scope changes before byte retrieval', async () => {
  const state = fixture({
    readError: Object.assign(new Error('scope changed'), { statusCode: 404 }),
  })
  const result = await executeComputerDownloadFile(
    { ...options(), sharedRoom: true },
    { fileId: 'file_1' },
    state.dependencies,
  )
  assert.equal(result.success, false)
  assert.match(result.error ?? '', /not readable in this workspace/i)
  assert.equal(state.calls.readArgs?.workspaceId, 'workspace_1')
  assert.equal(state.calls.readArgs?.scope, 'workspace')
  assert.equal(state.calls.writes.length, 0)
})

test('computer_download_file preserves a long basename extension within the filename bound', async () => {
  const state = fixture({ metadata: { name: `${'a'.repeat(150)}.mp4` } })
  const result = await executeComputerDownloadFile(options(), { fileId: 'file_1' }, state.dependencies)
  assert.equal(result.success, true)
  if (!result.success) return
  const basename = result.path.slice(result.path.lastIndexOf('/') + 1)
  assert.equal(basename.length, 120)
  assert.equal(basename.endsWith('.mp4'), true)
})

test('computer_download_file rejects dot-segment names after trimming whitespace', async () => {
  for (const name of ['.', '..', ' . ', ' .. ']) {
    const state = fixture({ metadata: { name } })
    const result = await executeComputerDownloadFile(options(), { fileId: 'file_1' }, state.dependencies)
    assert.equal(result.success, false)
    assert.match(result.error ?? '', /file name/i)
    assert.equal(state.calls.command, undefined)
    assert.equal(state.calls.writes.length, 0)
  }
})
