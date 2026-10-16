import assert from 'node:assert/strict'
import test from 'node:test'
import type {AgentHostCommand} from '@layernorm/overlay-agent-bridge-protocol'
import {requireNativeRestorationSource} from './native-restoration.js'
import type {StoredRemoteSession} from './state.js'

const stored: StoredRemoteSession = {runId: 'run', adapterId: 'claude-code', remoteSessionId: 'original-native',
  workingDirectory: '/drive', execution: {attemptId: 'old', generation: 2, hostBootId: 'old-boot'}}
const command: Extract<AgentHostCommand, {type: 'start'}> = {protocolVersion: 1, environmentId: 'env', workspaceId: 'workspace',
  commandId: 'restore', runId: 'run', sequence: 1, issuedAt: 1, type: 'start', execution: {attemptId: 'new', generation: 3},
  payload: {bindingId: 'binding', adapterId: 'claude-code', workingDirectory: '/drive', sessionId: 'original-native',
    prompt: 'Continue', metadata: {recoveryTextOffset: 0}, restore: {
      previousExecution: {attemptId: 'old', generation: 2, hostBootId: 'old-boot'},
      providerStop: {provider: 'box', leaseId: 'lease', providerReference: 'machine', observedAt: 1}}}}

test('restoration binds its saved native session and exact previous fence before any process may start', () => {
  assert.equal(requireNativeRestorationSource(command, stored), stored)
  assert.throws(() => requireNativeRestorationSource(command, undefined), /original persisted session/)
  assert.throws(() => requireNativeRestorationSource(command, {...stored, runId: 'other-run'}), /original persisted session/)
  assert.throws(() => requireNativeRestorationSource({...command, execution: undefined}, stored), /original persisted session/)
  for (const change of [{sessionId: 'other'}, {adapterId: 'other'}, {fresh: true}, {metadata: {}},
    {metadata: {recoveryTextOffset: -1}}, {metadata: {recoveryTextOffset: 0.5}}]) {
    assert.throws(() => requireNativeRestorationSource({...command, payload: {...command.payload, ...change}}, stored))
  }
  for (const execution of [{attemptId: 'old', generation: 3}, {attemptId: 'new', generation: 2}, {attemptId: 'new', generation: 4}])
    assert.throws(() => requireNativeRestorationSource({...command, execution}, stored), /previous execution fence/)
  assert.throws(() => requireNativeRestorationSource(command, {...stored,
    execution: {attemptId: 'old', generation: 2, hostBootId: 'another-boot'}}), /previous execution fence/)
  assert.throws(() => requireNativeRestorationSource({...command, payload: {...command.payload,
    metadata: {recoveryTextOffset: 0, overlayDrive: {version: 1, location: 'cloud', sessionId: 'old'}}}}, stored), /drive credentials/)
  assert.equal(requireNativeRestorationSource({...command, payload: {...command.payload,
    metadata: {recoveryTextOffset: 0, overlayDrive: {version: 1, location: 'cloud', sessionId: 'new'}}}}, stored), stored)
})
