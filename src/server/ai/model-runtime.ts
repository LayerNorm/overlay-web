import 'server-only'

import { getOverlayServerContext } from '@/server/bootstrap'
import {
  getGatewayImageModel,
  getGatewayModelId,
  getGatewayVideoModel,
  getOpenRouterLanguageModel,
} from '@/server/ai/gateway/ai-gateway'
import { userFacingOpenRouterError } from '@/server/ai/gateway/openrouter-service'
import type { LanguageModel } from '@/server/ai/provider-types'
import { ByokGateway, type ByokConnection } from '@overlay/llm-gateway'
import type { ProviderConnectionRecord } from '@/server/ai/provider-connections'
import { assertByokRuntimeConnectionAllowed } from '@/server/ai/gateway/byok-security'
import { createByokProviderFetch } from '@/server/ai/gateway/byok-provider-fetch'
import {
  isByokModelId,
  parseByokModelId,
  parseDiscoveredModels,
} from '@/shared/ai/gateway/byok-model-conversion'
import {
  isSubscriptionConnection,
  isSubscriptionProviderId,
} from '@/shared/ai/gateway/subscription-providers'
import { createSubscriptionLanguageModel } from '@/server/ai/gateway/subscription-broker'

async function getUserByokConnection(
  userId: string,
  connectionId: string,
): Promise<ProviderConnectionRecord | null> {
  return await getOverlayServerContext().appData.repositories.providerConnections.get({ connectionId, userId })
}

export async function assertUserCanUseByokModel(
  modelId: string,
  userId: string,
): Promise<{ connection: ProviderConnectionRecord; rawModelId: string }> {
  const parsed = parseByokModelId(modelId)
  if (!parsed) throw new Error('Invalid BYOK model id.')
  const connection = await getUserByokConnection(userId, parsed.connectionId)
  if (!connection) throw new Error('BYOK connection not found.')
  if (connection.authKind === 'subscription' || connection.providerId.startsWith('subscription:')) {
    if (!isSubscriptionConnection(connection) ||
        !isSubscriptionProviderId(connection.subscriptionProvider) ||
        connection.endpoint !== '' ||
        connection.status !== 'active' ||
        !connection.enabledModelIds.includes(parsed.rawModelId) ||
        !parseDiscoveredModels(connection.discoveredModelsJson).some((model) => model.id === parsed.rawModelId)) {
      throw new Error('Subscription connection is unavailable or this model is not enabled.')
    }
    return { connection, rawModelId: parsed.rawModelId }
  }
  assertByokRuntimeConnectionAllowed(connection, parsed.rawModelId)
  return { connection, rawModelId: parsed.rawModelId }
}

export async function getLanguageModel(
  modelId: string,
  accessToken?: string,
  userId?: string,
  options?: {
    allowLowBalanceFallback?: boolean
    sessionId?: string
  },
): Promise<LanguageModel> {
  const parsed = parseByokModelId(modelId)
  if (isByokModelId(modelId) && !parsed) throw new Error('Invalid BYOK model id.')
  if (parsed) {
    if (!userId) throw new Error('Authenticated user required for BYOK models.')
    const { connection, rawModelId } = await assertUserCanUseByokModel(modelId, userId)
    if (isSubscriptionConnection(connection) && isSubscriptionProviderId(connection.subscriptionProvider)) {
      return createSubscriptionLanguageModel({
        ownerId: userId,
        connectionId: connection._id,
        providerId: connection.subscriptionProvider,
        modelId: rawModelId,
      })
    }
    const apiKey = connection.credentialRef
      ? await getOverlayServerContext().byokCredentialStore.read(connection.credentialRef)
      : null
    const byokConnection: ByokConnection = {
      providerId: connection.providerId,
      endpoint: connection.endpoint,
    }
    const gateway = new ByokGateway({
      connection: byokConnection,
      apiKey,
      fetch: createByokProviderFetch(connection.endpoint),
    })
    const model = await gateway.createLanguageModel(rawModelId, {
      accessToken,
      sessionId: options?.sessionId,
    })
    return model.implementation as LanguageModel
  }

  const model = await getOverlayServerContext().llmGateway.createLanguageModel(
    modelId,
    {
      accessToken,
      allowLowBalanceFallback: options?.allowLowBalanceFallback,
    },
  )
  return model.implementation as LanguageModel
}

export {
  getGatewayImageModel,
  getGatewayModelId,
  getGatewayVideoModel,
  getOpenRouterLanguageModel,
  userFacingOpenRouterError,
}
