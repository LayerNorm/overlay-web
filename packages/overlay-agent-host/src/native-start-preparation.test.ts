import assert from 'node:assert/strict'
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {DatabaseSync} from 'node:sqlite'
import type {AgentHostCommand} from '@layernorm/overlay-agent-bridge-protocol'
import {nativePreparationFingerprint} from './native-start-preparation'
import {SqliteHostStateStore, type StoredRemoteSession} from './state'

function command(): Extract<AgentHostCommand, {type: 'start'}> {
  return {protocolVersion: 1, commandId: 'restore', environmentId: 'environment', workspaceId: 'workspace', runId: 'run',
    sequence: 1, issuedAt: 1, execution: {attemptId: 'next', generation: 2}, type: 'start', payload: {
      bindingId: 'binding', adapterId: 'acp', workingDirectory: '/repo', prompt: 'Continue', sessionId: 'original-native',
      metadata: {recoveryTextOffset: 10, model: 'original-model', effort: 'high', overlayMcp: {
        url: 'https://preview.invalid/api/agent-mcp', token: 'private-delivery-token'}},
      restore: {previousExecution: {attemptId: 'previous', generation: 1, hostBootId: 'old-boot'},
        providerStop: {provider: 'box', leaseId: 'lease', providerReference: 'machine', observedAt: 1}},
    }}
}
const original: StoredRemoteSession = {runId: 'run', adapterId: 'acp', remoteSessionId: 'original-native', workingDirectory: '/repo',
  execution: {attemptId: 'previous', generation: 1, hostBootId: 'old-boot'}}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'native-preparation-')), path = join(directory, 'host.sqlite')
  let state = new SqliteHostStateStore(path)
  state.claimExecution('run', 'previous'); state.saveSession(original)
  state.saveAdapterSessionState('run', 'acp', {nativeSessionId: 'original-native'})
  return {directory, path, get state() {return state},
    reopen: () => {state.close(); state = new SqliteHostStateStore(path)},
    close: async () => {state.close(); await rm(directory, {recursive: true, force: true})}}
}

test('preparation identity permits delivery-token rotation and key order changes, but binds scope, source proof, settings and text cursor', () => {
  const original = command(), rotated = command()
  const restore = original.payload.restore
  if (!restore) throw Error('Missing restoration fixture')
  rotated.payload.metadata = {overlayMcp: {token: 'rotated-private-token', url: 'https://preview.invalid/api/agent-mcp'},
    effort: 'high', model: 'original-model', recoveryTextOffset: 10}
  rotated.execution = {...rotated.execution, attemptId: 'next', generation: 2, hostBootId: 'new-boot'}
  assert.equal(nativePreparationFingerprint(original), nativePreparationFingerprint(rotated))
  for (const changed of [
    {...original, workspaceId: 'foreign'}, {...original, sequence: 2},
    {...original, payload: {...original.payload, workingDirectory: '/other'}},
    {...original, payload: {...original.payload, metadata: {...original.payload.metadata, recoveryTextOffset: 11}}},
    {...original, payload: {...original.payload, metadata: {...original.payload.metadata, effort: 'low'}}},
    {...original, payload: {...original.payload, restore: {...restore, providerStop: {...restore.providerStop, providerReference: 'foreign-machine'}}}},
    {...original, payload: {...original.payload, restore: {...restore, previousExecution: {attemptId: 'foreign', generation: 1}}}},
  ]) assert.notEqual(nativePreparationFingerprint(original), nativePreparationFingerprint(changed))
})

test('preparation survives reopen without transferring the old execution claim or storing delivery credentials', async () => {
  const f = await fixture(), fingerprint = nativePreparationFingerprint(command())
  try {
    assert.equal(f.state.claimNativePreparation('restore', fingerprint), true)
    f.reopen()
    assert.equal(f.state.claimNativePreparation('restore', fingerprint), true)
    assert.deepEqual(f.state.getSession('run'), original)
    assert.equal(f.state.claimNativePreparation('restore', 'changed'), false)
    f.state.enterNativeProviderStart({commandId: 'restore', fingerprint, previous: original,
      nextExecution: {attemptId: 'next', generation: 2, hostBootId: 'new-boot'}})
    f.reopen()
    assert.equal(f.state.claimNativePreparation('restore', fingerprint), false, 'unknown native startup must never replay')
    assert.equal(f.state.getSession('run')?.remoteSessionId, 'original-native')
    assert.equal(f.state.getSession('run')?.execution?.attemptId, 'next')
    assert.deepEqual(f.state.getAdapterSessionState('run', 'acp'), {nativeSessionId: 'original-native'})
    assert.throws(() => f.state.enterNativeProviderStart({commandId: 'restore', fingerprint, previous: original,
      nextExecution: {attemptId: 'another', generation: 2}}), /outcome is unknown/)
    for (const file of await readdir(f.directory))
      assert.equal((await readFile(join(f.directory, file))).includes(Buffer.from('private-delivery-token')), false)
  } finally {await f.close()}
})

test('two preparation observers still admit only one native writer at the atomic provider-start boundary', async () => {
  const f = await fixture(), peer = new SqliteHostStateStore(f.path), fingerprint = nativePreparationFingerprint(command())
  try {
    assert.equal(f.state.claimNativePreparation('restore', fingerprint), true)
    assert.equal(peer.claimNativePreparation('restore', fingerprint), true)
    f.state.enterNativeProviderStart({commandId: 'restore', fingerprint, previous: original, nextExecution: {attemptId: 'next', generation: 2}})
    assert.throws(() => peer.enterNativeProviderStart({commandId: 'restore', fingerprint, previous: original,
      nextExecution: {attemptId: 'next', generation: 2}}), /outcome is unknown/)
    assert.equal(peer.getSession('run')?.execution?.attemptId, 'next')
  } finally {peer.close(); await f.close()}
})

test('an unknown legacy claim cannot become replayable preparation', async () => {
  const f = await fixture()
  try {
    assert.equal(f.state.claimCommand('legacy-restore'), true)
    assert.equal(f.state.claimNativePreparation('legacy-restore', nativePreparationFingerprint(command())), false)
    assert.deepEqual(f.state.getSession('run'), original)
  } finally {await f.close()}
})

test('a failed checkpoint rolls back the native-start marker and execution transfer before any provider can start', async () => {
  const f = await fixture(), fingerprint = nativePreparationFingerprint(command())
  const peer = new DatabaseSync(f.path)
  try {
    assert.equal(f.state.claimNativePreparation('restore', fingerprint), true)
    peer.exec("CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON remote_sessions BEGIN SELECT RAISE(ABORT,'checkpoint refused'); END")
    assert.throws(() => f.state.enterNativeProviderStart({commandId: 'restore', fingerprint, previous: original,
      nextExecution: {attemptId: 'next', generation: 2}}), /checkpoint refused/)
    assert.deepEqual(f.state.getSession('run'), original)
    assert.equal(f.state.claimNativePreparation('restore', fingerprint), true)
    peer.exec('DROP TRIGGER reject_checkpoint')
    f.state.enterNativeProviderStart({commandId: 'restore', fingerprint, previous: original, nextExecution: {attemptId: 'next', generation: 2}})
    assert.equal(f.state.getSession('run')?.execution?.attemptId, 'next')
  } finally {peer.close(); await f.close()}
})
