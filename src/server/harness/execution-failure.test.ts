import { runInNewContext } from 'node:vm'
import { expect, test } from 'vitest'
import { harnessExecutionFailureReason } from './execution-failure'

test('preserves native, cross-realm and string errors', () => {
  expect(harnessExecutionFailureReason(new Error('Connection closed.'))).toBe('Connection closed.')
  expect(harnessExecutionFailureReason(runInNewContext('new Error("Connection closed.")'))).toBe('Connection closed.')
  expect(harnessExecutionFailureReason('Connection closed.')).toBe('Connection closed.')
})

test('preserves serialized Workflow codes and underlying causes without arbitrary metadata', () => {
  expect(harnessExecutionFailureReason({ name: 'WorkflowError', code: 'STREAM_ERROR',
    message: 'Step failed.', cause: { name: 'TypeError', message: 'Connection closed.' },
    request: { headers: { authorization: 'private-token' } }, stack: 'private-stack',
  })).toBe('WorkflowError / STREAM_ERROR: Step failed. Caused by: TypeError: Connection closed.')
})

test('redacts credentials before truncation', () => {
  const reason = harnessExecutionFailureReason({ message: 'Request failed: https://provider.test/?api_key=url-secret '
    + 'Bearer bearer-secret api_key="quoted secret" password=hidden sk-test1234567890 '
    + 'owner@example.test ' + 'x'.repeat(2_000), cause: new Error('Other failure') })
  for (const secret of ['url-secret', 'bearer-secret', 'quoted secret', 'hidden', 'sk-test1234567890', 'owner@example.test']) {
    expect(reason).not.toContain(secret)
  }
  expect(reason).toHaveLength(2_000)
  expect(reason).toContain('Request failed:')
})

test('normalization tolerates missing details, circular causes and throwing getters', () => {
  const circular: { message: string; cause?: unknown } = { message: 'Step failed.' }
  circular.cause = circular
  expect(harnessExecutionFailureReason(circular)).toBe('Step failed.')
  expect(harnessExecutionFailureReason({ get message() { throw new Error('private'); }, cause: 'Underlying failure.' }))
    .toBe('Underlying failure.')
  for (const error of [null, undefined, {}, false, 0]) {
    expect(harnessExecutionFailureReason(error)).toBe('Harness execution failed without error details.')
  }
})
