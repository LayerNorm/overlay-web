import 'server-only'

export const OWNER_FUNDED_OPERATIONS = [
  {
    id: 'conversation.act',
    method: 'POST',
    path: '/api/v1/conversations/act',
  },
  {
    id: 'conversation.extension-plan',
    method: 'POST',
    path: '/api/v1/conversations/act/extension-plan',
  },
  {
    id: 'chat.generate-title',
    method: 'POST',
    path: '/api/v1/generate-title',
  },
  {
    id: 'chat.generate-tab-group-label',
    method: 'POST',
    path: '/api/v1/generate-tab-group-label',
  },
  {
    id: 'chat.suggestions',
    method: 'GET',
    path: '/api/v1/chat-suggestions',
  },
  {
    id: 'media.generate-image',
    method: 'POST',
    path: '/api/v1/generate-image',
  },
  {
    id: 'media.generate-video',
    method: 'POST',
    path: '/api/v1/generate-video',
  },
  {
    id: 'agent.browser-task',
    method: 'POST',
    path: '/api/v1/browser-task',
  },
  {
    id: 'agent.notebook',
    method: 'POST',
    path: '/api/v1/notebook-agent',
  },
  {
    id: 'sandbox.daytona-run',
    method: 'POST',
    path: '/api/v1/daytona/run',
  },
  {
    id: 'audio.transcribe',
    method: 'POST',
    path: '/api/v1/transcribe',
  },
  {
    id: 'knowledge.hybrid-search',
    method: 'POST',
    path: '/api/v1/knowledge/search',
  },
] as const

export type OwnerFundedOperation = (typeof OWNER_FUNDED_OPERATIONS)[number]
export type OwnerFundedOperationId = OwnerFundedOperation['id']

const IDEMPOTENCY_REQUIRED_METHODS = new Set(['POST', 'PATCH', 'DELETE'])

const OWNER_FUNDED_OPERATION_BY_ROUTE = new Map<string, OwnerFundedOperation>(
  OWNER_FUNDED_OPERATIONS.map((operation) => [
    `${operation.method} ${operation.path}`,
    operation,
  ]),
)

export function getOwnerFundedOperation(
  method: string,
  pathname: string,
): OwnerFundedOperation | null {
  return OWNER_FUNDED_OPERATION_BY_ROUTE.get(
    `${method.toUpperCase()} ${pathname}`,
  ) ?? null
}

export function ownerFundedOperationRequiresIdempotencyKey(
  operation: OwnerFundedOperation | null,
): operation is OwnerFundedOperation {
  return Boolean(operation && IDEMPOTENCY_REQUIRED_METHODS.has(operation.method))
}
