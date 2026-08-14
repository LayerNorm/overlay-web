import 'server-only'

import type { RateLimitSpec } from '@overlay/app-core'
import { getOwnerFundedOperation } from '@/server/billing/owner-funded-operations'

const TEN_MINUTES = 10 * 60_000
const ONE_HOUR = 60 * 60_000

export const CHAT_RATE_LIMITS: RateLimitSpec[] = [
  { bucket: 'chat/conversations:act:ip', limit: 120, windowMs: TEN_MINUTES },
  { bucket: 'chat/conversations:act:user', limit: 60, windowMs: TEN_MINUTES },
]

const ENDPOINT_RATE_LIMITS: Record<string, RateLimitSpec[]> = {
  // Bootstrap read routes fire on every app-shell load. Without dedicated
  // specs they fall through to the shared `api:default:user` bucket
  // (300/10min), so a burst from one route (e.g. the model-catalog hook's
  // old 429-retry loop) could lock out the others and prevent the workspace
  // from opening. Each gets its own per-user bucket so they cannot starve
  // each other; the limits are generous because these are cheap reads.
  'GET /api/v1/model-catalog': [
    { bucket: 'model-catalog:ip', limit: 600, windowMs: TEN_MINUTES },
    { bucket: 'model-catalog:user', limit: 300, windowMs: TEN_MINUTES },
  ],
  'GET /api/v1/settings': [
    { bucket: 'settings:ip', limit: 600, windowMs: TEN_MINUTES },
    { bucket: 'settings:user', limit: 300, windowMs: TEN_MINUTES },
  ],
  'GET /api/v1/workspaces': [
    { bucket: 'workspaces:list:ip', limit: 600, windowMs: TEN_MINUTES },
    { bucket: 'workspaces:list:user', limit: 300, windowMs: TEN_MINUTES },
  ],
  'GET /api/v1/conversations': [
    { bucket: 'conversations:list:ip', limit: 600, windowMs: TEN_MINUTES },
    { bucket: 'conversations:list:user', limit: 300, windowMs: TEN_MINUTES },
  ],
  // One long-poll is held for up to 15 seconds per open app tab. Keep this
  // traffic out of the shared API bucket so realtime sync cannot starve room
  // history, presence, or other app reads.
  'GET /api/v1/conversations/events': [
    { bucket: 'conversations:events:ip', limit: 1_200, windowMs: TEN_MINUTES },
    { bucket: 'conversations:events:user', limit: 600, windowMs: TEN_MINUTES },
  ],
  'GET /api/v1/conversations/run': [
    { bucket: 'conversations:run:ip', limit: 1_200, windowMs: TEN_MINUTES },
    { bucket: 'conversations:run:user', limit: 600, windowMs: TEN_MINUTES },
  ],
  'GET /api/v1/chat-suggestions': [
    { bucket: 'helper:chat-suggestions:ip', limit: 120, windowMs: TEN_MINUTES },
    { bucket: 'helper:chat-suggestions:user', limit: 30, windowMs: TEN_MINUTES },
  ],
  'POST /api/v1/browser-task': [
    { bucket: 'browser-task:ip', limit: 20, windowMs: TEN_MINUTES },
    { bucket: 'browser-task:user', limit: 10, windowMs: TEN_MINUTES },
    { bucket: 'browser-task:workspace', limit: 20, windowMs: TEN_MINUTES },
  ],
  'POST /api/v1/knowledge/search': [
    { bucket: 'knowledge/knowledge:search:ip', limit: 120, windowMs: TEN_MINUTES },
    { bucket: 'knowledge/knowledge:search:user', limit: 60, windowMs: TEN_MINUTES },
  ],
  'POST /api/v1/memory': [
    { bucket: 'memory:write:ip', limit: 60, windowMs: TEN_MINUTES },
    { bucket: 'memory:write:user', limit: 30, windowMs: TEN_MINUTES },
  ],
  'POST /api/v1/generate-tab-group-label': [
    { bucket: 'helper:tab-label:ip', limit: 120, windowMs: TEN_MINUTES },
    { bucket: 'helper:tab-label:user', limit: 60, windowMs: TEN_MINUTES },
  ],
  'POST /api/v1/transcribe': [
    { bucket: 'transcribe:ip', limit: 30, windowMs: TEN_MINUTES },
    { bucket: 'transcribe:user', limit: 15, windowMs: TEN_MINUTES },
  ],
  'POST /api/v1/generate-image': [
    { bucket: 'generation:image:ip', limit: 30, windowMs: TEN_MINUTES },
    { bucket: 'generation:image:user', limit: 15, windowMs: TEN_MINUTES },
    { bucket: 'generation:image:workspace', limit: 30, windowMs: TEN_MINUTES },
  ],
  'POST /api/v1/daytona/run': [
    { bucket: 'sandbox:daytona:ip', limit: 20, windowMs: TEN_MINUTES },
    { bucket: 'sandbox:daytona:user', limit: 10, windowMs: TEN_MINUTES },
    { bucket: 'sandbox:daytona:workspace', limit: 20, windowMs: TEN_MINUTES },
  ],
  'POST /api/v1/generate-title': [
    { bucket: 'helper:title:ip', limit: 120, windowMs: TEN_MINUTES },
    { bucket: 'helper:title:user', limit: 60, windowMs: TEN_MINUTES },
  ],
  'POST /api/v1/automations': [
    { bucket: 'automations/automations:write:ip', limit: 30, windowMs: TEN_MINUTES },
    { bucket: 'automations/automations:write:user', limit: 15, windowMs: TEN_MINUTES },
  ],
  'PATCH /api/v1/automations': [
    { bucket: 'automations/automations:update:ip', limit: 60, windowMs: TEN_MINUTES },
    { bucket: 'automations/automations:update:user', limit: 30, windowMs: TEN_MINUTES },
  ],
  'POST /api/v1/notebook-agent': [
    { bucket: 'notebook-agent:ip', limit: 60, windowMs: TEN_MINUTES },
    { bucket: 'notebook-agent:user', limit: 30, windowMs: TEN_MINUTES },
  ],
  'POST /api/v1/conversations/act': CHAT_RATE_LIMITS,
  'GET /api/v1/files/presign': [
    { bucket: 'files/files:presign:ip', limit: 60, windowMs: ONE_HOUR },
    { bucket: 'files/files:presign:user', limit: 30, windowMs: ONE_HOUR },
  ],
  'POST /api/v1/generate-video': [
    { bucket: 'generation:video:ip', limit: 20, windowMs: TEN_MINUTES },
    { bucket: 'generation:video:user', limit: 10, windowMs: TEN_MINUTES },
    { bucket: 'generation:video:workspace', limit: 20, windowMs: TEN_MINUTES },
  ],
  'POST /api/v1/files/ingest-document': [
    { bucket: 'files/files:ingest-document:ip', limit: 40, windowMs: ONE_HOUR },
    { bucket: 'files/files:ingest-document:user', limit: 20, windowMs: ONE_HOUR },
  ],
  'POST /api/v1/conversations/act/extension-plan': [
    { bucket: 'extension-plan:ip', limit: 120, windowMs: TEN_MINUTES },
    { bucket: 'extension-plan:user', limit: 60, windowMs: TEN_MINUTES },
  ],
  'POST /api/v1/conversations/message': [
    { bucket: 'conversation-message:ip', limit: 240, windowMs: TEN_MINUTES },
    { bucket: 'conversation-message:user', limit: 120, windowMs: TEN_MINUTES },
  ],
  'POST /api/v1/files/upload-url': [
    { bucket: 'files/files:upload-url:ip', limit: 60, windowMs: ONE_HOUR },
    { bucket: 'files/files:upload-url:user', limit: 30, windowMs: ONE_HOUR },
  ],
  'POST /api/v1/files/search-text': [
    { bucket: 'files/files:search-text:ip', limit: 120, windowMs: TEN_MINUTES },
    { bucket: 'files/files:search-text:user', limit: 60, windowMs: TEN_MINUTES },
  ],
  // Each Connect performs discovery and possibly dynamic client registration against a
  // user-supplied host, so it is deliberately cheap to rate limit and expensive to abuse.
  'POST /api/v1/mcps/oauth': [
    { bucket: 'mcps/oauth:start:ip', limit: 30, windowMs: TEN_MINUTES },
    { bucket: 'mcps/oauth:start:user', limit: 15, windowMs: TEN_MINUTES },
  ],
  'DELETE /api/v1/mcps/oauth': [
    { bucket: 'mcps/oauth:disconnect:ip', limit: 60, windowMs: TEN_MINUTES },
    { bucket: 'mcps/oauth:disconnect:user', limit: 30, windowMs: TEN_MINUTES },
  ],
  // The callback is reachable without an Overlay session (the desktop browser may not have one),
  // so it is limited by IP only — there is no authenticated user to key on.
  'GET /api/v1/mcps/oauth/callback': [
    { bucket: 'mcps/oauth:callback:ip', limit: 60, windowMs: TEN_MINUTES },
  ],
}

type DynamicEndpointRateLimit = {
  method: string
  pattern: RegExp
  limits: RateLimitSpec[]
}

const DYNAMIC_ENDPOINT_RATE_LIMITS: DynamicEndpointRateLimit[] = [
  {
    method: 'GET',
    pattern: /^\/api\/v1\/conversations\/[^/]+\/presence$/,
    limits: [
      { bucket: 'conversations:presence-read:ip', limit: 600, windowMs: TEN_MINUTES },
      { bucket: 'conversations:presence-read:user', limit: 300, windowMs: TEN_MINUTES },
    ],
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/v1\/conversations\/[^/]+\/presence$/,
    limits: [
      { bucket: 'conversations:presence-write:ip', limit: 600, windowMs: TEN_MINUTES },
      { bucket: 'conversations:presence-write:user', limit: 300, windowMs: TEN_MINUTES },
    ],
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/outputs\/[^/]+\/content$/,
    limits: [
      { bucket: 'r2-download:output:ip', limit: 600, windowMs: TEN_MINUTES },
      { bucket: 'r2-download:output:user', limit: 300, windowMs: TEN_MINUTES },
    ],
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/files\/[^/]+\/content$/,
    limits: [
      { bucket: 'r2-download:file:ip', limit: 600, windowMs: TEN_MINUTES },
      { bucket: 'r2-download:file:user', limit: 300, windowMs: TEN_MINUTES },
    ],
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/knowledge-bases\/[^/]+\/reindex$/,
    limits: [
      { bucket: 'knowledge-reindex:ip', limit: 20, windowMs: ONE_HOUR },
      { bucket: 'knowledge-reindex:user', limit: 10, windowMs: ONE_HOUR },
    ],
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/v1\/webhooks$/,
    limits: [
      { bucket: 'webhook-redrive:ip', limit: 30, windowMs: TEN_MINUTES },
      { bucket: 'webhook-redrive:user', limit: 15, windowMs: TEN_MINUTES },
    ],
  },
]

function keyForBucket(bucket: string, userId: string, ip: string, workspaceId?: string): string {
  if (bucket.endsWith(':ip')) return ip
  if (bucket.endsWith(':user')) return userId
  if (bucket.endsWith(':workspace')) return workspaceId ?? userId
  if (bucket.endsWith(':global')) return 'global'
  return userId
}

export function getEndpointRateLimitSpecs(args: {
  deviceRiskKey?: string
  ip: string
  method: string
  organizationId?: string
  pathname: string
  userId: string
  workspaceId?: string
}): RateLimitSpec[] {
  const method = args.method.toUpperCase()
  const pathname = args.pathname.replace(/\/+$/, '') || '/'
  const exact = ENDPOINT_RATE_LIMITS[`${method} ${pathname}`]
  const templates = exact ?? DYNAMIC_ENDPOINT_RATE_LIMITS.find((entry) => {
    return entry.method === method && entry.pattern.test(pathname)
  })?.limits

  const ownerFundedLimits: RateLimitSpec[] = getOwnerFundedOperation(method, pathname)
    ? [
        { bucket: 'owner-funded:global', key: 'global', limit: 1_000, windowMs: TEN_MINUTES },
        { bucket: 'owner-funded:user', key: args.userId, limit: 120, windowMs: TEN_MINUTES },
        ...(args.organizationId
          ? [{
              bucket: 'owner-funded:organization',
              key: args.organizationId,
              limit: 400,
              windowMs: TEN_MINUTES,
            }]
          : []),
        ...(args.deviceRiskKey
          ? [{
              bucket: 'owner-funded:device-risk',
              key: args.deviceRiskKey,
              limit: 90,
              windowMs: TEN_MINUTES,
            }]
          : []),
      ]
    : []
  return [...(templates ?? []), ...ownerFundedLimits].map((template: RateLimitSpec) => ({
    ...template,
    key: template.key ?? keyForBucket(template.bucket, args.userId, args.ip, args.workspaceId),
  }))
}
