import 'server-only'

/**
 * The default public v1 route is `handleBffRoute`, which supplies authentication,
 * capability/authorization boundaries, origin checks for cookie mutations, rate
 * limits, idempotency support, and a payload-free mutation audit. A route may opt
 * out only when its protocol makes that impossible; each exception must state its
 * replacement controls here.
 */
export const PUBLIC_V1_ROUTE_SECURITY_EXCEPTIONS = {
  '/api/v1/surfaces/slack/identity/start': slackIdentityException(['GET']),
  '/api/v1/surfaces/slack/identity/callback': slackIdentityException(['GET']),
  '/api/v1/surfaces/slack/identity/unlink': slackIdentityException(['POST']),
  '/api/v1/agent-environments/enroll': agentHostException(['POST'], 'Single-use enrollment code redemption plus device public-key registration.'),
  '/api/v1/agent-environments/[environmentId]/credentials': agentHostException(['POST'], 'One-time challenge and Ed25519 proof-of-possession credential issuance.'),
  '/api/v1/agent-environments/[environmentId]/credentials/refresh': agentHostException(['POST'], 'Signed environment credential rotation.'),
  '/api/v1/agent-environments/[environmentId]/run-credentials': {
    methods: ['POST'],
    reason: 'Retired hosted-runtime credential endpoint; returns HTTP 410 without reading data, issuing credentials, or mutating state.',
    controls: {
      authentication: 'not-applicable-retired-410; the fixed response does not inspect request identity',
      authorization: 'not-applicable-retired-410; no user data is read or changed',
      rateLimit: 'not-applicable-retired-410; the response has no side effects',
      csrf: 'not-applicable-retired-410; no browser-authorized mutation occurs',
      idempotency: 'not-applicable-retired-410; no mutation occurs',
      audit: 'not-applicable-retired-410; no state or credentials are written',
    },
  },
  '/api/v1/agent-environments/[environmentId]/drive-credentials': agentHostException(['POST'], 'Device-signed issuance or renewal of drive credentials bound to the current run, session, execution and persisted scope.'),
  '/api/v1/agent-environments/[environmentId]/heartbeat': agentHostException(['POST'], 'Signed environment heartbeat.'),
  '/api/v1/agent-environments/[environmentId]/capabilities': agentHostException(['PUT'], 'Signed environment capability refresh.'),
  '/api/v1/agent-environments/[environmentId]/commands': agentHostException(['GET'], 'Signed, environment-scoped command polling.'),
  '/api/v1/agent-environments/[environmentId]/commands/[commandId]/ack': agentHostException(['POST'], 'Signed, environment-scoped command acknowledgement.'),
  '/api/v1/agent-environments/[environmentId]/events': agentHostException(['POST'], 'Signed, size-limited, sequenced event upload.'),
  '/api/v1/agent-environments/[environmentId]/artifacts': agentHostException(['POST'], 'Signed, scoped artifact upload-intent creation.'),
  '/api/v1/agent-environments/[environmentId]/artifacts/[artifactId]/complete': agentHostException(['POST'], 'Signed artifact completion with checksum and malware validation.'),
  '/api/v1/agent-profiles/upload': {
    methods: ['POST'],
    reason: 'A person\'s computer or browser uploads a cleaned agent config; the body is gzip, not a JSON envelope, and the caller has no session (the Agent Host runs on their machine).',
    controls: {
      authentication: 'single-use import code created from the signed-in agent page, hashed at rest, expires in 15 minutes',
      authorization: 'the code is bound to one agent, one workspace, one harness, and the person who created it',
      rateLimit: 'endpoint-specific IP and credential limits; compressed body capped at 4 MB, inflated at 24 MB',
      csrf: 'no browser cookie authority; the bearer code is the only credential',
      idempotency: 'the code redeems once; a second upload with it is refused',
      audit: 'the staged version and its later apply are written as agent_profile audit events',
    },
  },
  '/api/v1/agent-environments/artifacts/cleanup': internalServiceException(['POST'], 'Internal-secret authenticated artifact retention cleanup.'),
  '/api/v1/agent-environments/operations/reconcile': internalServiceException(['POST'], 'Internal-secret authenticated remote-run supervision and settlement reconciliation.'),
  '/api/v1/files/ingest-jobs/process': internalServiceException(['POST'], 'Internal-secret authenticated Convex file-ingestion worker bridge.'),
  '/api/v1/imports/slack/process': internalServiceException(['POST'], 'Internal-secret authenticated Slack import worker bridge.'),
  '/api/v1/automations/project-events': internalServiceException(['POST'], 'Internal-secret authenticated Workflow SDK event projection bridge.'),
  '/api/v1/harness/continuation': internalContinuationException(),
  '/api/v1/work/resume-assignment': internalServiceException(['POST'], 'Internal-secret authenticated dependency release; generation-fenced assignment claim and current permissions/budget are rechecked.'),
  '/api/v1/surfaces/slack/connect': {
    methods: ['GET'],
    reason: 'Browser navigation that must end in a redirect to Slack consent, not a JSON envelope.',
    controls: {
      authentication: 'Overlay session required; unauthenticated callers are redirected to sign-in',
      authorization: 'SurfaceService.requireBindableAgent: visible agent, no guests, personal agents only by their creator',
      rateLimit: 'endpoint-specific IP limit',
      csrf: 'read-only redirect; nothing is bound until the user approves on Slack and the callback succeeds',
      idempotency: 'not-applicable-redirect-only',
      audit: 'the successful callback writes surface.slack.connected',
    },
  },
  '/api/v1/surfaces/slack/callback': {
    methods: ['GET'],
    reason: 'Slack OAuth redirect target; the response must redirect back into the app.',
    controls: {
      authentication: 'HMAC-sealed state (10-minute TTL) plus a live Overlay session for the same user',
      authorization: 'state binds user, workspace, and agent; bind permission is re-checked before the token exchange',
      rateLimit: 'endpoint-specific IP limit',
      csrf: 'sealed OAuth state must match the completing session user',
      idempotency: 'connections upsert by Slack team id',
      audit: 'surface.slack.connected workspace audit event',
    },
  },
  '/api/v1/webhooks/slack': {
    methods: ['POST'],
    reason: 'Slack Events API ingress; Slack calls it without an Overlay session.',
    controls: {
      authentication: "Slack v0 request signature (Chat SDK adapter; verified explicitly for lifecycle events)",
      authorization: 'team and channel resolve to an active binding; unbound events are ignored',
      rateLimit: 'Slack-controlled delivery; acknowledged within Slack\'s 3s window',
      csrf: 'no browser cookie authority',
      idempotency: 'Chat SDK event dedupe in Convex state; lifecycle transitions are idempotent',
      audit: 'lifecycle transitions are logged; turns persist to the surface conversation transcript',
    },
  },
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

function slackIdentityException(methods: readonly string[]) {
  return {
    methods,
    reason: 'Browser OIDC linking and session-authorized unlinking use standalone responses rather than a JSON BFF.',
    controls: {
      authentication: 'Overlay session; callback must match the signed initiating user and verified Slack ID token',
      authorization: 'active workspace membership and installation for linking; self or current workspace admin for unlinking',
      rateLimit: 'endpoint IP and user limits before OAuth exchange or mutation',
      csrf: 'HMAC-bound state and atomic one-use nonce at callback; exact same-origin POST required for unlinking',
      idempotency: 'nonce is consumed atomically with link/conflict; unlink only revokes a scoped link',
      audit: 'durable scoped link, nonce consumption, creation/update and revocation timestamps; no user tokens retained',
    },
  }
}

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

function internalContinuationException() {
  return {
    methods: ['POST'],
    reason: 'Internal-secret authenticated continuation launch callback.',
    controls: {
      authentication: 'deployment-scoped internal service secret',
      authorization: 'the persisted checkpoint token binds the run and generation; launch identity is revalidated before workflow start',
      rateLimit: 'durable continuation outbox backoff and bounded dispatch batches',
      csrf: 'no browser cookie authority',
      idempotency: 'generation and checkpoint-token fencing plus successor claim make retry launches safe',
      audit: 'checkpoint and continuation outbox rows preserve the handoff and attempt history',
    },
  } as const
}
