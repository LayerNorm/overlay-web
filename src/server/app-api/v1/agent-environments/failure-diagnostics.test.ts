import assert from 'node:assert/strict'
import test from 'node:test'
import * as Sentry from '@sentry/nextjs'
import { ConvexError } from 'convex/values'
import { ZodError } from 'zod'
import { sanitizeSentryEvent } from '@/shared/security/sentry-sanitize'
import { recordConvexCallFailure } from '@/server/observability/failure-classification'
import { ConnectedAgentControlPlaneError } from '@/server/agents'
import { agentEnvironmentErrorResponse } from './shared'
import { withAgentHostRouteTelemetry } from './host-route-telemetry'

test('caught poll failures link the HTTP response, safe log and real Sentry transport without raw arguments', async () => {
  const previousClient = Sentry.getClient()
  const envelopes: unknown[] = [], lines: string[] = []
  const previousConsole = console.error
  console.error = (line: unknown) => { lines.push(String(line)) }
  Sentry.init({
    dsn: 'https://public@diagnostics.invalid/1', defaultIntegrations: false,
    beforeSend: sanitizeSentryEvent,
    transport: () => ({
      send: async envelope => { envelopes.push(envelope); return { statusCode: 200 } },
      flush: async () => true,
    }),
  })
  try {
    const failure = recordConvexCallFailure(new ConvexError({ code: 'AGENT_POLICY_LIMIT' }), {
      path: 'agents/environmentControlPlane:getEnvironmentByServer', type: 'query', httpStatus: 400,
      backendMessage: '[Request ID: abcdef123456] ArgumentValidationError: private@example.com sk-secret123456789\n    at handler (convex/agents/environmentControlPlane.ts:165:5)',
    })
    const response = await withAgentHostRouteTelemetry('commands.poll',
      new Request('https://preview.invalid/poll', { headers: { 'x-vercel-id': 'iad1::diagnostic-test' } }),
      async () => agentEnvironmentErrorResponse(failure))
    assert.equal(response.status, 500)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('x-overlay-request-id'), 'iad1::diagnostic-test')
    const diagnosticId = response.headers.get('x-overlay-diagnostic-id')
    assert.match(diagnosticId ?? '', /^[a-f0-9]{32}$/)
    assert.deepEqual(await response.json(), { error: 'Agent environment request failed', code: 'internal_error' })
    await Sentry.flush(2000)
    assert.equal(envelopes.length, 1)
    const log = JSON.parse(lines[0] ?? '')
    assert.equal(log.context.diagnosticId, diagnosticId)
    assert.equal(log.context.requestId, 'iad1::diagnostic-test')
    assert.equal(log.context.route, '/agent-host/commands/poll')
    assert.equal(log.context.convexRequestId, 'abcdef123456')
    assert.equal(log.context.failureSignature, 'CONVEX_ARGUMENT_VALIDATION')
    const event = JSON.stringify(envelopes)
    assert.ok(event.includes(`"event_id":"${diagnosticId}"`))
    assert.ok(event.includes('CONVEX_ARGUMENT_VALIDATION'))
    assert.ok(event.includes('abcdef123456'))
    assert.ok(event.includes('iad1::diagnostic-test'))
    assert.doesNotMatch(JSON.stringify({ lines, envelopes }), /private@example|sk-secret123456789|ArgumentValidationError:/)
  } finally {
    await Sentry.close(2000)
    Sentry.setCurrentClient(previousClient)
    console.error = previousConsole
  }
})

test('unknown failures remain explicitly unclassified; expected rejections retain their status', async () => {
  const previousConsole = console.error
  const lines: string[] = []
  console.error = (line: unknown) => { lines.push(String(line)) }
  try {
    const response = agentEnvironmentErrorResponse(recordConvexCallFailure(new Error('Server Error'), {
      path: 'agents/environmentControlPlane:getEnvironmentByServer', type: 'query',
    }))
    assert.equal(response.status, 500)
    assert.equal(JSON.parse(lines[0] ?? '').context.failureSignature, 'CONVEX_UNCLASSIFIED')
    assert.equal(agentEnvironmentErrorResponse(new ZodError([])).status, 400)
    assert.equal(agentEnvironmentErrorResponse(new ConnectedAgentControlPlaneError('Unauthorized', 401, 'unauthorized')).status, 401)
    assert.equal(lines.length, 1)
  } finally { console.error = previousConsole }
})
