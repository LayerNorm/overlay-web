/**
 * Read-only backend fault smoke, without a deployed fault-injection endpoint.
 * NODE_OPTIONS=--require=./scripts/ci/register-server-only.cjs npx tsx \
 *   scripts/smoke/cloud-agent-long-horizon/diagnostics.ts \
 *   --backend-url https://<owned-PR-backend>.convex.cloud
 *
 * Calls one existing query with invalid arguments, then exercises the real local HTTP error boundary
 * and Sentry SDK using an in-memory transport. This proves backend-to-diagnostic correlation, not
 * hosted BFF fault injection or delivery to the remote Sentry service. No credentials or writes.
 */
import assert from 'node:assert/strict'
import * as Sentry from '@sentry/nextjs'
import { sanitizeSentryEvent } from '../../../src/shared/security/sentry-sanitize'
import { describeFailure } from '../../../src/server/observability/failure-classification'
import { withAgentHostRouteTelemetry } from '../../../src/server/app-api/v1/agent-environments/host-route-telemetry'

async function main() {
  const option = process.argv.indexOf('--backend-url')
  const target = new URL(option >= 0 ? process.argv[option + 1] ?? '' : '')
  assert.equal(target.protocol, 'https:')
  assert.match(target.hostname, /^[a-z]+-[a-z]+-\d+\.convex\.cloud$/)
  assert.notEqual(target.hostname, 'colorful-chickadee-419.convex.cloud', 'Customer production is excluded')
  assert.equal(target.origin + '/', target.href, 'Select an explicit backend origin without credentials or parameters')
  process.env.NEXT_PUBLIC_CONVEX_URL = target.origin
  process.env.DEV_NEXT_PUBLIC_CONVEX_URL = target.origin
  const { convex } = await import('../../../src/server/database/convex')
  const { agentEnvironmentErrorResponse } = await import('../../../src/server/app-api/v1/agent-environments/shared')
  const envelopes: unknown[] = []
  Sentry.init({
    dsn: 'https://public@diagnostics.invalid/1', defaultIntegrations: false, beforeSend: sanitizeSentryEvent,
    transport: () => ({ send: async envelope => { envelopes.push(envelope); return { statusCode: 200 } }, flush: async () => true }),
  })
  try {
    const failure = await convex.query('agents/environmentControlPlane:getEnvironmentByServer', {}, { throwOnError: true })
      .then(() => { throw new Error('Expected the backend argument validator to reject the read') }, error => error)
    const diagnostic = describeFailure(failure)
    assert.equal(diagnostic.failureSignature, 'CONVEX_ARGUMENT_VALIDATION')
    assert.ok(diagnostic.convexRequestId, 'The actual backend request id must survive the HTTP adapter')
    const response = await withAgentHostRouteTelemetry('commands.poll', new Request('https://diagnostics.invalid/poll'),
      async () => agentEnvironmentErrorResponse(failure))
    assert.equal(response.status, 500)
    const diagnosticId = response.headers.get('x-overlay-diagnostic-id')
    const requestId = response.headers.get('x-overlay-request-id')
    assert.match(diagnosticId ?? '', /^[a-f0-9]{32}$/)
    assert.ok(requestId)
    await Sentry.flush(2000)
    assert.equal(envelopes.length, 1)
    const captured = JSON.stringify(envelopes)
    assert.ok(captured.includes(diagnosticId ?? 'missing'))
    assert.ok(captured.includes(requestId))
    assert.ok(captured.includes(diagnostic.convexRequestId))
    assert.ok(captured.includes('CONVEX_ARGUMENT_VALIDATION'))
    console.info(JSON.stringify({ passed: true, backend: target.hostname, readOnly: true,
      diagnosticId, requestId, diagnostic, sentryInMemoryTransportVerified: true,
      hostedBffFaultInjected: false, remoteSentryDeliveryVerified: false }))
  } finally { await Sentry.close(2000) }
}

void main().catch(error => {
  console.error(JSON.stringify({ passed: false, diagnostic: describeFailure(error) }))
  process.exitCode = 1
})
