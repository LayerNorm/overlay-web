import 'server-only'

/**
 * The default public v1 route is `handleBffRoute`, which supplies authentication,
 * capability/authorization boundaries, origin checks for cookie mutations, rate
 * limits, idempotency support, and a payload-free mutation audit. A route may opt
 * out only when its protocol makes that impossible; each exception must state its
 * replacement controls here.
 */
export const PUBLIC_V1_ROUTE_SECURITY_EXCEPTIONS = {
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
