import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {DriveRequestError} from './drive-client'
import {ControlPlaneRequestError} from './transport'
import {isRetryablePreparationFailure} from './preparation-failure'
import {SqliteHostStateStore} from './state'
import {nativePreparationFingerprint} from './native-start-preparation'
import {processHostCommand} from './process-host-command'
import type {AgentHostCommand} from '@layernorm/overlay-agent-bridge-protocol'

test('recognized transport failures retry while credential and programming failures remain permanent', () => {
  for (const error of [new DriveRequestError(503, 'DRIVE_BACKEND_UNAVAILABLE'), new ControlPlaneRequestError(429),
    new DOMException('Timed out', 'TimeoutError'), new TypeError('fetch failed', {cause: {code: 'ECONNRESET'}})])
    assert.equal(isRetryablePreparationFailure(error), true)
  for (const error of [new DriveRequestError(403, 'DRIVE_RUN_UNAVAILABLE'), new ControlPlaneRequestError(401),
    new ControlPlaneRequestError(409, 'account_needs_reauth'), new ControlPlaneRequestError(503, 'account_needs_reauth'),
    new Error('Bug'), new TypeError('Programming error')])
    assert.equal(isRetryablePreparationFailure(error), false)
})

test('the same 503 becomes retryable only before the durable native-start boundary', async () => {
  for (const crossed of [false, true]) {
    const directory = await mkdtemp(join(tmpdir(), 'preparation-failure-')), state = new SqliteHostStateStore(join(directory, 'host.sqlite'))
    try {
      const previous = {runId: 'run', adapterId: 'acp', remoteSessionId: 'native', workingDirectory: directory,
        execution: {attemptId: 'previous', generation: 1}}
      state.claimExecution('run', 'previous'); state.saveSession(previous)
      const command: Extract<AgentHostCommand, {type: 'start'}> = {protocolVersion: 1, commandId: 'restore', environmentId: 'env', workspaceId: 'ws',
        runId: 'run', sequence: 1, issuedAt: 1, execution: {attemptId: 'next', generation: 2}, type: 'start', payload: {
          bindingId: 'binding', adapterId: 'acp', workingDirectory: directory, sessionId: 'native', prompt: 'Continue', metadata: {recoveryTextOffset: 0},
          restore: {previousExecution: previous.execution, providerStop: {provider: 'box', leaseId: 'lease', providerReference: 'machine', observedAt: 1}}}}
      let code: string | undefined
      await assert.rejects(processHostCommand({command, state, environmentId: 'env', workspaceId: 'ws', shuttingDown: false,
        resolvedThroughSequence: 0, errorMessage: () => 'transient failure', acknowledge: async (_command, _accepted, _message, errorCode) => {code = errorCode},
        dispatch: async () => {
          if (crossed) state.enterNativeProviderStart({commandId: command.commandId, fingerprint: nativePreparationFingerprint(command), previous,
            nextExecution: {attemptId: 'next', generation: 2}})
          throw new DriveRequestError(503, 'DRIVE_BACKEND_UNAVAILABLE')
        }}), /503/)
      assert.equal(code, crossed ? 'command_rejected' : 'native_preparation_retryable')
      assert.equal(state.getProcessedCommand('restore')?.errorCode, code)
      assert.equal(state.getSession('run')?.execution?.attemptId, crossed ? 'next' : 'previous')
    } finally {state.close(); await rm(directory, {recursive: true, force: true})}
  }
})
