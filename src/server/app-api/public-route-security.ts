import 'server-only'

/**
 * The default public v1 route is `handleBffRoute`, which supplies authentication,
 * capability/authorization boundaries, origin checks for cookie mutations, rate
 * limits, idempotency support, and a payload-free mutation audit. A route may opt
 * out only when its protocol makes that impossible; each exception must state its
 * replacement controls here.
 */
export const PUBLIC_V1_ROUTE_SECURITY_EXCEPTIONS = {
  '/api/v1/agent-environments/enroll': agentHostException(['POST'], 'Single-use enrollment code redemption plus device public-key registration.'),
  '/api/v1/agent-environments/[environmentId]/credentials': agentHostException(['POST'], 'One-time challenge and Ed25519 proof-of-possession credential issuance.'),
  '/api/v1/agent-environments/[environmentId]/credentials/refresh': agentHostException(['POST'], 'Signed environment credential rotation.'),
  '/api/v1/agent-environments/[environmentId]/heartbeat': agentHostException(['POST'], 'Signed environment heartbeat.'),
  '/api/v1/agent-environments/[environmentId]/capabilities': agentHostException(['PUT'], 'Signed environment capability refresh.'),
  '/api/v1/agent-environments/[environmentId]/commands': agentHostException(['GET'], 'Signed, environment-scoped command polling.'),
  '/api/v1/agent-environments/[environmentId]/commands/[commandId]/ack': agentHostException(['POST'], 'Signed, environment-scoped command acknowledgement.'),
  '/api/v1/agent-environments/[environmentId]/events': agentHostException(['POST'], 'Signed, size-limited, sequenced event upload.'),
  '/api/v1/agent-environments/[environmentId]/artifacts': agentHostException(['POST'], 'Signed, scoped artifact upload-intent creation.'),
  '/api/v1/agent-environments/[environmentId]/artifacts/[artifactId]/complete': agentHostException(['POST'], 'Signed artifact completion with checksum and malware validation.'),
  '/api/v1/agent-environments/artifacts/cleanup': internalServiceException(['POST'], 'Internal-secret authenticated artifact retention cleanup.'),
  '/api/v1/agent-environments/operations/reconcile': internalServiceException(['POST'], 'Internal-secret authenticated remote-run supervision and settlement reconciliation.'),
  '/api/v1/files/ingest-jobs/process': internalServiceException(['POST'], 'Internal-secret authenticated Convex file-ingestion worker bridge.'),
  '/api/v1/imports/slack/process': internalServiceException(['POST'], 'Internal-secret authenticated Slack import worker bridge.'),
  '/api/v1/capabilities': {
    methods: ['GET'],
    reason: 'Public, read-only deployment capability discovery.',
    controls: {
      authentication: 'not-applicable-read-only',
      authorization: 'returns only the redacted capability summary',
      rateLimit: 'not-applicable-read-only',
      csrf: 'not-applicable-read-only',
      idempotency: 'not-applicable-read-only',
      audit: 'not-applicable-read-only',
    },
  },
  '/api/v1/discovery': {
    methods: ['GET'],
    reason: 'Public, read-only protocol discovery for desktop clients.',
    controls: {
      authentication: 'not-applicable-read-only',
      authorization: 'returns only non-secret protocol metadata',
      rateLimit: 'not-applicable-read-only',
      csrf: 'not-applicable-read-only',
      idempotency: 'not-applicable-read-only',
      audit: 'not-applicable-read-only',
    },
  },
  '/api/v1/mcps/oauth/callback': {
    methods: ['GET', 'POST'],
    reason: 'Third-party OAuth redirects and desktop confirmation cannot use app-session auth.',
    controls: {
      authentication: 'single-use state or sealed confirmation cookie',
      authorization: 'state is bound to the user and MCP server',
      rateLimit: 'endpoint-specific IP limits',
      csrf: 'OAuth state plus sealed same-site confirmation cookie',
      idempotency: 'OAuth state is consumed once before any exchange',
      audit: 'durable MCP OAuth lifecycle audit event',
    },
  },
} as const

function agentHostException(methods: readonly string[], reason: string) {
  return {
    methods,
    reason,
    controls: {
      authentication: 'short-lived opaque credential plus Ed25519 request proof',
      authorization: 'credential is bound to workspace, environment, audience, and method',
      rateLimit: 'endpoint-specific IP and credential limits',
      csrf: 'no browser cookie authority; signed request proof covers method, path, body, time, and nonce',
      idempotency: 'single-use enrollment/challenge secrets and atomic replay-nonce consumption',
      audit: 'enrollment and credential lifecycle writes canonical workspace audit events',
    },
  } as const
}

function internalServiceException(methods: readonly string[], reason: string) {
  return {
    methods,
    reason,
    controls: {
      authentication: 'deployment-scoped internal service secret',
      authorization: 'service identity can only invoke the bounded cleanup operation',
      rateLimit: 'scheduler cadence plus bounded batch size',
      csrf: 'no browser cookie authority',
      idempotency: 'object deletion and metadata tombstoning are idempotent',
      audit: 'artifact metadata retains cleanup state and timestamps',
    },
  } as const
}
