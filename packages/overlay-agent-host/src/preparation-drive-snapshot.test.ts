import assert from 'node:assert/strict'
import {mkdtemp, open, readFile, rm, utimes, writeFile, type FileHandle} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {type TestContext} from 'node:test'
import type {AgentHostCommand} from '@layernorm/overlay-agent-bridge-protocol'
import {AgentDriveCache} from './drive-cache.js'
import {isRetryablePreparationFailure} from './preparation-failure.js'
import {nativePreparationFingerprint} from './native-start-preparation.js'
import {processHostCommand} from './process-host-command.js'
import {SqliteHostStateStore} from './state.js'

async function changedSnapshot(t: TestContext, directory: string) {
  const cache = await AgentDriveCache.create(directory, 'cache'), path = join(cache.root, 'source.md')
  await writeFile(path, 'Public startup snapshot fixture\n')
  const probe = await open(path, 'r'), originalStat = probe.stat, prototype = Reflect.getPrototypeOf(probe)
  await probe.close()
  if (!prototype || !('stat' in prototype) || typeof prototype.stat !== 'function') throw Error('FileHandle stat unavailable')
  let calls = 0, failure: unknown
  t.mock.method(prototype, 'stat', async function(this: FileHandle, options?: Parameters<FileHandle['stat']>[0]) {
    if (++calls === 2) await utimes(path, new Date(Date.now() + 1000), new Date(Date.now() + 1000))
    return originalStat.call(this, options)
  }, {})
  try {await cache.inventory()} catch (error) {failure = error}
  finally {t.mock.restoreAll()}
  assert.ok(failure instanceof Error, 'the real metadata change must reject the in-progress snapshot')
  assert.equal(failure.message, 'DRIVE_FILE_CHANGED')
  const inventory = await cache.inventory()
  assert.equal(inventory.length, 1)
  assert.equal(Buffer.from(inventory[0].kind === 'file' ? inventory[0].bytes : []).toString(), 'Public startup snapshot fixture\n')
  assert.equal(await readFile(path, 'utf8'), 'Public startup snapshot fixture\n')
  return {failure, workingDirectory: cache.root}
}

for (const crossed of [false, true]) test(`a real drive snapshot race is retryable only before native start (crossed=${crossed})`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'preparation-drive-snapshot-'))
  const state = new SqliteHostStateStore(join(directory, 'host.sqlite'))
  try {
    const {failure, workingDirectory} = await changedSnapshot(t, directory)
    const previous = {runId: 'run', adapterId: 'acp', remoteSessionId: 'native', workingDirectory,
      execution: {attemptId: 'previous', generation: 1}}
    state.claimExecution('run', 'previous'); state.saveSession(previous)
    const command: Extract<AgentHostCommand, {type: 'start'}> = {protocolVersion: 1, commandId: 'restore', environmentId: 'env', workspaceId: 'ws',
      runId: 'run', sequence: 1, issuedAt: 1, execution: {attemptId: 'next', generation: 2}, type: 'start', payload: {
        bindingId: 'binding', adapterId: 'acp', workingDirectory, sessionId: 'native', prompt: 'Continue', metadata: {recoveryTextOffset: 0},
        restore: {previousExecution: previous.execution, providerStop: {provider: 'box', leaseId: 'lease', providerReference: 'machine', observedAt: 1}}}}
    let code: string | undefined
    await assert.rejects(processHostCommand({command, state, environmentId: 'env', workspaceId: 'ws', shuttingDown: false,
      resolvedThroughSequence: 0, errorMessage: error => error instanceof Error ? error.message : 'Unknown failure',
      acknowledge: async (_command, accepted, _message, errorCode) => {assert.equal(accepted, false); code = errorCode},
      dispatch: async () => {
        if (crossed) state.enterNativeProviderStart({commandId: command.commandId, fingerprint: nativePreparationFingerprint(command), previous,
          nextExecution: {attemptId: 'next', generation: 2}})
        throw failure
      }}), error => error === failure)
    assert.equal(code, crossed ? 'command_rejected' : 'native_preparation_retryable')
    assert.equal(state.getSession('run')?.execution?.attemptId, crossed ? 'next' : 'previous')
  } finally {state.close(); await rm(directory, {recursive: true, force: true})}
})

test('ordinary file conflicts do not become retryable by sharing a snapshot error message', () => {
  assert.equal(isRetryablePreparationFailure(new Error('DRIVE_FILE_CHANGED')), false)
  assert.equal(isRetryablePreparationFailure(new Error('DRIVE_LOCAL_PATH_CONFLICT')), false)
  assert.equal(isRetryablePreparationFailure(new Error('DRIVE_UNSAFE_PATH')), false)
})
