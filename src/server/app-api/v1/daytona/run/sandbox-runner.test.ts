import assert from 'node:assert/strict'
import test from 'node:test'
import type { Sandbox } from '@daytona/sdk'
import {
  buildDaytonaRunResult,
  collectDaytonaArtifacts,
  stageDaytonaInputFiles,
  stageInlineCodeFile,
} from './sandbox-runner'

const sandbox = { id: 'sandbox_1' } as unknown as Sandbox

test('stageDaytonaInputFiles preserves duplicate-name staging behavior', async () => {
  const uploads: Array<{ path: string; contents: string }> = []

  const uploadedFiles = await stageDaytonaInputFiles({
    fileIds: [' file_a ', 'file_b', ''],
    findFile: async (fileId) => ({
      _id: fileId,
      name: 'notes.txt',
      content: `content:${fileId}`,
    }),
    paths: { inputDir: '/workspace/input' },
    readFileBuffer: async (file) => Buffer.from(file.content),
    sandbox,
    uploadBuffer: async (_sandbox, remotePath, contents) => {
      uploads.push({ path: remotePath, contents: contents.toString('utf8') })
    },
  })

  assert.deepEqual(uploadedFiles, [
    { fileId: 'file_a', fileName: 'notes.txt', sandboxPath: '/workspace/input/notes.txt' },
    { fileId: 'file_b', fileName: '2-notes.txt', sandboxPath: '/workspace/input/2-notes.txt' },
  ])
  assert.deepEqual(uploads, [
    { path: '/workspace/input/notes.txt', contents: 'content:file_a' },
    { path: '/workspace/input/2-notes.txt', contents: 'content:file_b' },
  ])
})

test('stageDaytonaInputFiles preserves missing file failure', async () => {
  await assert.rejects(
    () => stageDaytonaInputFiles({
      fileIds: ['missing'],
      findFile: async () => null,
      paths: { inputDir: '/workspace/input' },
      readFileBuffer: async () => Buffer.from(''),
      sandbox,
      uploadBuffer: async () => {},
    }),
    /Overlay file not found: missing/,
  )
})

test('stageInlineCodeFile writes runtime-specific entrypoints', async () => {
  const uploads: Array<{ path: string; contents: string }> = []

  const nodePath = await stageInlineCodeFile({
    code: 'console.log(1)',
    paths: { runDir: '/workspace/run' },
    runtime: 'node',
    sandbox,
    uploadBuffer: async (_sandbox, remotePath, contents) => {
      uploads.push({ path: remotePath, contents })
    },
  })
  const pythonPath = await stageInlineCodeFile({
    code: 'print(1)',
    paths: { runDir: '/workspace/run' },
    runtime: 'python',
    sandbox,
    uploadBuffer: async (_sandbox, remotePath, contents) => {
      uploads.push({ path: remotePath, contents })
    },
  })
  const emptyPath = await stageInlineCodeFile({
    code: '',
    paths: { runDir: '/workspace/run' },
    runtime: 'node',
    sandbox,
    uploadBuffer: async () => {
      throw new Error('should not upload empty code')
    },
  })

  assert.equal(nodePath, '/workspace/run/main.js')
  assert.equal(pythonPath, '/workspace/run/main.py')
  assert.equal(emptyPath, undefined)
  assert.deepEqual(uploads, [
    { path: '/workspace/run/main.js', contents: 'console.log(1)' },
    { path: '/workspace/run/main.py', contents: 'print(1)' },
  ])
})

test('collectDaytonaArtifacts preserves artifact DTO mapping and missing output behavior', async () => {
  const originalDateNow = Date.now
  Date.now = () => 123
  const uploadedObjects: Array<{ key: string; body: string; mimeType: string }> = []
  const createdOutputs: Record<string, unknown>[] = []
  try {
    const result = await collectDaytonaArtifacts({
      checkGlobalBudget: async (sizeBytes) => assert.equal(sizeBytes, 5),
      command: 'python main.py',
      conversationId: 'conversation_1',
      createOutput: async (args) => {
        createdOutputs.push(args)
        return 'output_1'
      },
      deleteObject: async () => {
        throw new Error('should not delete successful artifact')
      },
      downloadFile: async (_sandbox, remotePath) => {
        assert.equal(remotePath, '/workspace/out/report.txt')
        return Buffer.from('hello')
      },
      expectedOutputs: ['out/report.txt', 'out/missing.txt'],
      findSandboxFile: async (_sandbox, remotePath) => (
        remotePath.endsWith('report.txt') ? { isDir: false } : null
      ),
      paths: { rootDir: '/workspace' },
      runtime: 'python',
      sandbox,
      serverSecret: 'secret',
      task: 'make report',
      turnId: 'turn_1',
      uploadObject: async (key, body, mimeType) => {
        uploadedObjects.push({ key, body: Buffer.from(body).toString('utf8'), mimeType })
      },
      userId: 'user_1',
    })

    assert.deepEqual(result.missingExpectedOutputs, ['out/missing.txt'])
    assert.deepEqual(result.artifacts, [{
      outputId: 'output_1',
      fileName: 'report.txt',
      mimeType: 'text/plain; charset=utf-8',
      sizeBytes: 5,
      type: 'text',
    }])
    assert.deepEqual(uploadedObjects, [{
      key: 'users/user_1/outputs/tmp-123/report.txt',
      body: 'hello',
      mimeType: 'text/plain; charset=utf-8',
    }])
    assert.deepEqual(createdOutputs, [{
      userId: 'user_1',
      serverSecret: 'secret',
      type: 'text',
      source: 'sandbox',
      status: 'completed',
      prompt: 'make report',
      modelId: 'daytona/default',
      r2Key: 'users/user_1/outputs/tmp-123/report.txt',
      fileName: 'report.txt',
      mimeType: 'text/plain; charset=utf-8',
      sizeBytes: 5,
      metadata: {
        runtime: 'python',
        command: 'python main.py',
        remotePath: '/workspace/out/report.txt',
      },
      conversationId: 'conversation_1',
      turnId: 'turn_1',
    }])
  } finally {
    Date.now = originalDateNow
  }
})

test('collectDaytonaArtifacts deletes uploaded object when output creation fails', async () => {
  const originalDateNow = Date.now
  Date.now = () => 456
  const deletedKeys: string[] = []
  try {
    await assert.rejects(
      () => collectDaytonaArtifacts({
        checkGlobalBudget: async () => {},
        command: 'node main.js',
        createOutput: async () => null,
        deleteObject: async (key) => {
          deletedKeys.push(key)
        },
        downloadFile: async () => Buffer.from('hello'),
        expectedOutputs: ['out/report.txt'],
        findSandboxFile: async () => ({ isDir: false }),
        paths: { rootDir: '/workspace' },
        runtime: 'node',
        sandbox,
        serverSecret: 'secret',
        task: 'make report',
        uploadObject: async () => {},
        userId: 'user_1',
      }),
      /Failed to create Output record for sandbox artifact "report.txt"./,
    )
    assert.deepEqual(deletedKeys, ['users/user_1/outputs/tmp-456/report.txt'])
  } finally {
    Date.now = originalDateNow
  }
})

test('buildDaytonaRunResult preserves response success, failure, and warning messages', () => {
  assert.deepEqual(buildDaytonaRunResult({
    artifacts: [{ outputId: 'output_1', fileName: 'a.txt', type: 'text', sizeBytes: 1 }],
    execution: { exitCode: 0, stdout: 'ok', stderr: '' },
    missingExpectedOutputs: [],
    sandboxId: 'sandbox_1',
    uploadedFiles: [],
    workspaceState: 'started',
  }), {
    status: 200,
    payload: {
      success: true,
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      artifacts: [{ outputId: 'output_1', fileName: 'a.txt', type: 'text', sizeBytes: 1 }],
      missingExpectedOutputs: [],
      uploadedFiles: [],
      sandboxId: 'sandbox_1',
      workspaceState: 'started',
      message: 'Sandbox run completed and imported 1 artifact.',
    },
  })

  assert.equal(buildDaytonaRunResult({
    artifacts: [],
    execution: { exitCode: 0, stdout: '', stderr: '' },
    missingExpectedOutputs: ['out.txt'],
    sandboxId: 'sandbox_1',
    uploadedFiles: [],
    workspaceState: 'started',
  }).payload.message, 'Sandbox run completed, but some declared outputs were missing: out.txt.')

  assert.equal(buildDaytonaRunResult({
    artifacts: [],
    execution: { exitCode: 1, stdout: '', stderr: 'nope' },
    missingExpectedOutputs: [],
    sandboxId: 'sandbox_1',
    uploadedFiles: [],
    workspaceState: 'started',
  }).payload.message, 'Sandbox run failed with exit code 1.')
})
