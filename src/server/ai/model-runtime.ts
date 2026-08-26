import 'server-only'

import { getOverlayServerContext } from '@/server/bootstrap'
import {
  getGatewayImageModel,
  getGatewayModelId,
  getGatewayParallelSearchTool,
  getGatewayPerplexitySearchTool,
  getGatewayVideoModel,
  getOpenRouterLanguageModel,
  getOpenRouterLanguageModelCapturingRoutedModel,
  parallelSearchInputSchema,
  perplexitySearchInputSchema,
} from '@/server/ai/gateway/ai-gateway'
import { userFacingOpenRouterError } from '@/server/ai/gateway/openrouter-service'
import {
  createNvidiaNimChatLanguageModel,
  resolveNvidiaApiKey,
} from '@/server/ai/gateway/nvidia-nim-openai'
import type { LanguageModel } from '@/server/ai/provider-types'
import { ByokGateway, type ByokConnection } from '@overlay/llm-gateway'
import type { ProviderConnectionRecord } from '@/server/ai/provider-connections'
import { assertByokRuntimeConnectionAllowed } from '@/server/ai/gateway/byok-security'
import { createByokProviderFetch } from '@/server/ai/gateway/byok-provider-fetch'
import { isByokModelId, parseByokModelId } from '@/shared/ai/gateway/byok-model-conversion'

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
  assertByokRuntimeConnectionAllowed(connection, parsed.rawModelId)
  return { connection, rawModelId: parsed.rawModelId }
}

export async function getLanguageModel(
  modelId: string,
  accessToken?: string,
  userId?: string,
): Promise<LanguageModel> {
  const parsed = parseByokModelId(modelId)
  if (isByokModelId(modelId) && !parsed) throw new Error('Invalid BYOK model id.')
  if (parsed) {
    if (!userId) throw new Error('Authenticated user required for BYOK models.')
    const { connection, rawModelId } = await assertUserCanUseByokModel(modelId, userId)
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
    const model = await gateway.createLanguageModel(rawModelId, { accessToken })
    return model.implementation as LanguageModel
  }

  const model = await getOverlayServerContext().llmGateway.createLanguageModel(
    modelId,
    { accessToken },
  )
  return model.implementation as LanguageModel
}

export {
  getGatewayImageModel,
  getGatewayModelId,
  getGatewayParallelSearchTool,
  getGatewayPerplexitySearchTool,
  getGatewayVideoModel,
  getOpenRouterLanguageModel,
  getOpenRouterLanguageModelCapturingRoutedModel,
  parallelSearchInputSchema,
  perplexitySearchInputSchema,
  userFacingOpenRouterError,
  createNvidiaNimChatLanguageModel,
  resolveNvidiaApiKey,
}
