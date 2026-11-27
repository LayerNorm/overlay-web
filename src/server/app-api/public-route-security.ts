import 'server-only'

/**
 * The default public v1 route is `handleBffRoute`, which supplies authentication,
 * capability/authorization boundaries, origin checks for cookie mutations, rate
 * limits, idempotency support, and a payload-free mutation audit. A route may opt
 * out only when its protocol makes that impossible; each exception must state its
 * replacement controls here.
 */
export const PUBLIC_V1_ROUTE_SECURITY_EXCEPTIONS = {
  '/api/v1/workspace-invitations/[invitationId]': {
    methods: ['GET'],
    reason: 'Invitation landing page must work before account creation or sign-in.',
    controls: {
      authentication: 'unguessable UUID v4 invitation bearer in the URL; no session required',
      authorization: 'redacted invitation preview only; no workspace or principal IDs; acceptance still requires the invited account',
      rateLimit: '60 requests per IP per minute',
      csrf: 'read-only GET; no cookie authority or mutations',
      idempotency: 'read-only; no-store response',
      audit: 'read-only; no state changes or credentials issued',
    },
  },
  '/api/v1/agent-environments/enroll': agentHostException(['POST'], 'Single-use enrollment code redemption plus device public-key registration.'),
  '/api/v1/agent-environments/[environmentId]/credentials': agentHostException(['POST'], 'One-time challenge and Ed25519 proof-of-possession credential issuance.'),
  '/api/v1/agent-environments/[environmentId]/credentials/refresh': agentHostException(['POST'], 'Signed environment credential rotation.'),
  '/api/v1/agent-environments/[environmentId]/heartbeat': agentHostException(['POST'], 'Signed environment heartbeat.'),
  '/api/v1/agent-environments/[environmentId]/capabilities': agentHostException(['PUT'], 'Signed environment capability refresh.'),
  '/api/v1/agent-environments/[environmentId]/local-tool-calls': agentHostException(['GET'], 'Signed long-poll for This Mac local tool calls addressed to this environment.'),
  '/api/v1/agent-environments/[environmentId]/local-tool-calls/[callId]/result': agentHostException(['POST'], 'Signed, size-limited answer to one claimed local tool call.'),
  '/api/v1/agent-environments/operations/reconcile': internalServiceException(['POST'], 'Internal-secret authenticated machine lease metering, idle checks and retired cloud cleanup.'),
  '/api/v1/files/ingest-jobs/process': internalServiceException(['POST'], 'Internal-secret authenticated Convex file-ingestion worker bridge.'),
  '/api/v1/harness/continuation': internalContinuationException(),
  '/api/v1/harness/stalled': internalServiceException(['POST'], 'Internal-secret authenticated stalled-run sweep: reports harness runs whose workflow ended while the run did not.'),
  '/api/v1/work/resume-assignment': internalServiceException(['POST'], 'Internal-secret authenticated dependency release; generation-fenced assignment claim and current permissions/budget are rechecked.'),
  '/api/v1/github/connect': {
    methods: ['GET'],
    reason: 'Browser navigation that must end in a redirect to GitHub sign-in (or, with install=1, the GitHub App install page), not a JSON envelope.',
    controls: {
      authentication: 'Overlay session required; unauthenticated callers are redirected to sign-in',
      authorization: 'resolveActiveWorkspace: the caller must be an active member of the workspace the install is for',
      rateLimit: 'endpoint-specific IP limit',
      csrf: 'read-only redirect; nothing is saved until GitHub returns to the callback with a matching sealed state',
      idempotency: 'not-applicable-redirect-only',
      audit: 'the successful callback writes integration.github.connected',
    },
  },
  '/api/v1/github/callback': {
    methods: ['GET'],
    reason: 'GitHub sign-in redirect target; the response must redirect back into the app.',
    controls: {
      authentication: 'HMAC-sealed state (10-minute TTL) plus a live Overlay session for the same user',
      authorization: 'only installations GitHub lists for the signed-in GitHub user (GET /user/installations) are connected',
      rateLimit: 'endpoint-specific IP limit',
      csrf: 'sealed state must match the completing session user',
      idempotency: 'installations upsert by workspace and installation id',
      audit: 'integration.github.connected workspace audit event',
    },
  },
  '/api/v1/integrations/slack/install': {
    methods: ['GET'],
    reason: 'Browser navigation that must end in a redirect to the Slack app install page, not a JSON envelope.',
    controls: {
      authentication: 'Overlay session required; unauthenticated callers are redirected to sign-in',
      authorization: 'resolveActiveWorkspace: the caller must be an active member; only owners and admins can complete the install',
      rateLimit: 'endpoint-specific IP limit',
      csrf: 'read-only redirect; nothing is saved until Slack returns to the callback with a matching sealed state',
      idempotency: 'not-applicable-redirect-only',
      audit: 'the successful callback writes integration.slack.installed',
    },
  },
  '/api/v1/integrations/slack/oauth': {
    methods: ['GET'],
    reason: 'Slack install redirect target; the response must redirect back into the app.',
    controls: {
      authentication: 'HMAC-sealed state (10-minute TTL) plus a live Overlay session for the same user',
      authorization: 'Convex binds the Slack workspace only for an active owner or admin, and only when neither side is bound elsewhere',
      rateLimit: 'endpoint-specific IP limit',
      csrf: 'sealed state must match the completing session user',
      idempotency: 'installation upserts by Overlay workspace and Slack team',
      audit: 'integration.slack.installed workspace audit event',
    },
  },
  '/api/v1/integrations/slack/link': {
    methods: ['GET'],
    reason: 'Browser navigation that must end in a redirect to Sign in with Slack, not a JSON envelope.',
    controls: {
      authentication: 'Overlay session required; unauthenticated callers are redirected to sign-in',
      authorization: 'resolveActiveWorkspace: the caller must be an active member of a workspace with Slack installed',
      rateLimit: 'endpoint-specific IP limit',
      csrf: 'read-only redirect; nothing is saved until Slack returns to the callback with a matching sealed state',
      idempotency: 'not-applicable-redirect-only',
      audit: 'the successful callback writes integration.slack.linked',
    },
  },
  '/api/v1/integrations/slack/link/callback': {
    methods: ['GET'],
    reason: 'Sign in with Slack redirect target; the response must redirect back into the app.',
    controls: {
      authentication: 'HMAC-sealed state (10-minute TTL), a live Overlay session for the same user, and a Slack-issued OpenID token',
      authorization: 'the link is saved only when the signed-in Slack workspace is the one installed for the member workspace',
      rateLimit: 'endpoint-specific IP limit',
      csrf: 'sealed state must match the completing session user',
      idempotency: 'a new link replaces earlier links for the same member or Slack account',
      audit: 'integration.slack.linked workspace audit event',
    },
  },
  '/api/v1/integrations/slack/events': {
    methods: ['POST'],
    reason: 'Slack Events API delivery; Slack authenticates with its request signature, not an Overlay session or API key.',
    controls: {
      authentication: 'Slack signing-secret HMAC over the raw body with a five-minute timestamp window',
      authorization: 'each message runs only for a linked, active member of the Overlay workspace bound to that Slack team',
      rateLimit: 'Slack delivery cadence; each admitted turn passes workspace governance limits',
      csrf: 'no browser cookie authority',
      idempotency: 'Chat SDK webhook dedupe in Convex state; turn nonces dedupe retried starts',
      audit: 'each admitted request is an ordinary message and agent run in the member thread',
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
