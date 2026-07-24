import { describe, expect, it } from 'vitest'
import {
  validateHostCapabilityOperation,
  validateIsolatedProcessRequest
} from './agent-provider-input-validation'

describe('agent provider input validation', () => {
  it('accepts only exact typed host operations', () => {
    expect(
      validateHostCapabilityOperation({
        type: 'message.send',
        recipient: '+15555550100',
        text: 'Hello'
      })
    ).toEqual({
      type: 'message.send',
      recipient: '+15555550100',
      text: 'Hello'
    })
    expect(() =>
      validateHostCapabilityOperation({
        type: 'message.send',
        recipient: '+15555550100',
        text: 'Hello',
        script: 'do shell script "id"'
      })
    ).toThrow('invalid_host_capability_operation')
  })

  it('rejects arbitrary script/shell operation types and unknown operations', () => {
    for (const input of [
      { type: 'applescript.run', source: 'tell application "Finder"' },
      { type: 'shell.run', command: 'id' },
      { type: 'application.launch', bundleId: 'bad bundle id' },
      { type: 'timer.start', durationSeconds: 0 }
    ]) {
      expect(() => validateHostCapabilityOperation(input)).toThrow(
        'invalid_host_capability_operation'
      )
    }
  })

  it('bounds integration arguments and rejects prototype-bearing input', () => {
    expect(() =>
      validateHostCapabilityOperation({
        type: 'integration.execute',
        connectionId: 'connection_123',
        toolkit: 'GMAIL',
        action: 'GMAIL_SEND_EMAIL',
        mutation: true,
        arguments: { body: 'x'.repeat(70 * 1024) }
      })
    ).toThrow('invalid_host_capability_operation')

    const argumentsWithPrototype = Object.create({ inherited: 'secret' })
    argumentsWithPrototype.safe = 'value'
    expect(() =>
      validateHostCapabilityOperation({
        type: 'integration.execute',
        connectionId: 'connection_123',
        toolkit: 'GMAIL',
        action: 'GMAIL_SEND_EMAIL',
        mutation: true,
        arguments: argumentsWithPrototype
      })
    ).toThrow('invalid_host_capability_operation')
  })

  it('accepts bounded VM argv requests with an explicit minimal environment', () => {
    expect(
      validateIsolatedProcessRequest({
        executable: '/usr/bin/git',
        argv: ['status', '--short'],
        cwd: '/workspace',
        environment: { LANG: 'C.UTF-8', PATH: '/usr/bin:/bin' },
        timeoutMs: 30_000,
        outputLimitBytes: 1024 * 1024
      })
    ).toEqual({
      executable: '/usr/bin/git',
      argv: ['status', '--short'],
      cwd: '/workspace',
      environment: { LANG: 'C.UTF-8', PATH: '/usr/bin:/bin' },
      timeoutMs: 30_000,
      outputLimitBytes: 1024 * 1024
    })
  })

  it('rejects inherited-style environments, oversized output, NULs, and unknown fields', () => {
    for (const input of [
      {
        executable: '/usr/bin/env',
        argv: [],
        cwd: '/workspace',
        environment: { provider_api_key: 'secret' },
        timeoutMs: 30_000,
        outputLimitBytes: 1024
      },
      {
        executable: '/usr/bin/env',
        argv: ['bad\0arg'],
        cwd: '/workspace',
        environment: {},
        timeoutMs: 30_000,
        outputLimitBytes: 1024
      },
      {
        executable: '/usr/bin/env',
        argv: [],
        cwd: '/workspace',
        environment: {},
        timeoutMs: 30_000,
        outputLimitBytes: 9 * 1024 * 1024
      },
      {
        executable: '/usr/bin/env',
        argv: [],
        cwd: '/workspace',
        environment: {},
        timeoutMs: 30_000,
        outputLimitBytes: 1024,
        shell: true
      }
    ]) {
      expect(() => validateIsolatedProcessRequest(input)).toThrow(
        'invalid_isolated_process_request'
      )
    }
  })
})
