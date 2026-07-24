import type { LLMGateway as CoreLLMGateway } from '@overlay/llm-gateway'
import type { AuthProvider } from '@overlay/auth-contracts'
import type { ObjectStore, VectorStore } from '@overlay/storage-contracts'
import type { BillingProvider } from '@overlay/billing'
import type { EventBus, RateLimiter } from './server-runtime'

export interface OverlayServerContext {
  auth: AuthProvider
  billing: BillingProvider
  objectStore: ObjectStore
  vectorStore: VectorStore
  llmGateway: CoreLLMGateway
  rateLimiter: RateLimiter
  eventBus: EventBus
}
