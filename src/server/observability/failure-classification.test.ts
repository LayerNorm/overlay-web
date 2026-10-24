import assert from 'node:assert/strict'
import test from 'node:test'
import { ConvexError } from 'convex/values'
import { ZodError } from 'zod/v3'
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
    failureSignature: 'CONVEX_UNCLASSIFIED',
    failureCodes: ['AGENT_REMOTE_SESSION_NOT_FOUND'],
    convexPath: 'agents/connectedAgents:applyRemoteEventsByServer',
    convexCallType: 'mutation',
    convexRequestId: '4f2a9c81d0e3',
  })
  assert.ok(!JSON.stringify(described).includes('alice'))
})

test('known backend signatures and source locations retain no raw exception or arguments', () => {
  for (const [message, signature] of [
    ['ArgumentValidationError: Value does not match validator', 'CONVEX_ARGUMENT_VALIDATION'],
    ['ReturnValidationError: invalid result', 'CONVEX_RETURN_VALIDATION'],
    ['Uncaught Error: Unauthorized', 'CONVEX_AUTHORIZATION'],
    ['unique() query returned more than one result', 'CONVEX_NON_UNIQUE_RESULT'],
    ['Could not find public function for agents/missing:read', 'CONVEX_FUNCTION_NOT_FOUND'],
    ['Server Error', 'CONVEX_UNCLASSIFIED'],
  ]) {
    assert.equal(describeFailure(new Error(message), { path: 'agents/environmentControlPlane:getEnvironmentByServer', type: 'query' }).failureSignature, signature)
  }
  const error = recordConvexCallFailure(new ConvexError({ code: 'AGENT_POLICY_LIMIT' }), {
    path: 'agents/environmentControlPlane:getEnvironmentByServer', type: 'query', httpStatus: 200,
    backendMessage: '[Request ID: abcdef123456] ArgumentValidationError: secret@example.com PRIVATE_PROMPT\n    at handler (convex/agents/environmentControlPlane.ts:165:5)\n    at privateFunction (/home/private/customer.ts:1:2)',
  })
  const diagnostic = describeFailure(error)
  assert.equal(diagnostic.convexRequestId, 'abcdef123456')
  assert.equal(diagnostic.failureSignature, 'CONVEX_ARGUMENT_VALIDATION')
  assert.deepEqual(diagnostic.failureCodes, ['AGENT_POLICY_LIMIT'])
  assert.ok(diagnostic.failureFrames?.includes('convex/agents/environmentControlPlane.ts:165:5'))
  assert.doesNotMatch(JSON.stringify(diagnostic), /secret@example|PRIVATE_PROMPT|privateFunction|\/home\/private/)
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
