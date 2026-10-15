import assert from 'node:assert/strict'
import test from 'node:test'
import { ConvexError } from 'convex/values'
import { ZodError } from 'zod'
import { describeFailure, recordConvexCallFailure } from './failure-classification'

test('a Convex failure names its function, class, codes and request id without its message', () => {
  const failure = recordConvexCallFailure(
    new Error('[Request ID: 4f2a9c81d0e3] Server Error\nUncaught Error: AGENT_REMOTE_SESSION_NOT_FOUND for user alice@example.com'),
    { path: 'agents/connectedAgents:applyRemoteEventsByServer', type: 'mutation' },
  )
  const described = describeFailure(failure)
  assert.deepEqual(described, {
    failureType: 'Error',
    failureClass: 'convex_function',
    failureCodes: ['AGENT_REMOTE_SESSION_NOT_FOUND'],
    convexPath: 'agents/connectedAgents:applyRemoteEventsByServer',
    convexCallType: 'mutation',
    convexRequestId: '4f2a9c81d0e3',
  })
  assert.ok(!JSON.stringify(described).includes('alice'))
})

test('write conflicts, limits, timeouts and outages are told apart', () => {
  const convex = { path: 'agents/connectedAgents:claimCommandsByServer', type: 'mutation' }
  const describe = (message: string, extra: Record<string, unknown> = {}) =>
    describeFailure(recordConvexCallFailure(new Error(message), { ...convex, ...extra })).failureClass
  assert.equal(describe('Documents read from or written to the "agentRunCommands" table changed while this mutation was being run'), 'convex_occ')
  assert.equal(describe('Too many reads in a single function execution'), 'convex_limit')
  assert.equal(describe('Convex mutation request timed out after 10000ms'), 'convex_timeout')
  assert.equal(describe('fetch failed'), 'convex_unavailable')
  assert.equal(describe('Convex mutation request failed with HTTP 503', { httpStatus: 503 }), 'convex_unavailable')
  assert.equal(describeFailure(new Error('socket hang up')).failureClass, 'network')
  assert.equal(describeFailure(new Error('The operation was aborted due to timeout')).failureClass, 'timeout')
})

test('our own errors keep their codes, and validation is its own class', () => {
  const controlPlane = Object.assign(new Error('Remote session was not found'), { code: 'remote_session_not_found', statusCode: 404 })
  Object.defineProperty(controlPlane, 'constructor', { value: class ConnectedAgentControlPlaneError {} })
  assert.deepEqual(describeFailure(controlPlane), {
    failureType: 'ConnectedAgentControlPlaneError', failureClass: 'control_plane',
    failureCodes: ['remote_session_not_found'], httpStatus: 404,
  })
  assert.equal(describeFailure(new ZodError([])).failureClass, 'validation')
  assert.deepEqual(describeFailure(new ConvexError({ code: 'AGENT_POLICY_LIMIT' })).failureCodes, ['AGENT_POLICY_LIMIT'])
})

test('field names avoid the logger’s redacted key fragments', () => {
  const described = describeFailure(recordConvexCallFailure(new Error('x'), { path: 'a:b', type: 'query', httpStatus: 500 }))
  const redacted = ['error', 'name', 'reason', 'key', 'token', 'session', 'body', 'content', 'input', 'output', 'query', 'ip']
  for (const key of Object.keys(described)) {
    assert.ok(!redacted.some((part) => key.toLowerCase().includes(part)), key)
  }
})
