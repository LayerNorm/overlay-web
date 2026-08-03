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
import { ByokGateway, type ByokConnection } from '@overlay/llm-gateway'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { readByokVaultKey } from '@/server/ai/gateway/byok-vault'
import { assertByokRuntimeConnectionAllowed } from '@/server/ai/gateway/byok-security'
import { isByokModelId, parseByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import type { LanguageModelV3 } from '@/server/ai/provider-types'

type ByokConnectionRow = {
  _id: string
  userId: string
  providerId: string
  endpoint: string
  vaultObjectId?: string
  enabledModelIds: string[]
  isDefault: boolean
  status: string
}

async function getUserByokConnection(
  userId: string,
  connectionId: string,
): Promise<ByokConnectionRow | null> {
  const row = await convex.query<ByokConnectionRow>(
    'providers/connections:getByServer',
    { serverSecret: getInternalApiSecret(), connectionId },
    { throwOnError: true },
  )
  return row?.userId === userId ? row : null
}

export async function assertUserCanUseByokModel(
  modelId: string,
  userId: string,
): Promise<{ connection: ByokConnectionRow; rawModelId: string }> {
  const parsed = parseByokModelId(modelId)
  if (!parsed) throw new Error('Invalid BYOK model id.')
  const connection = await getUserByokConnection(userId, parsed.connectionId)
  if (!connection) throw new Error('BYOK connection not found.')
  assertByokRuntimeConnectionAllowed(connection, parsed.rawModelId)
  return { connection, rawModelId: parsed.rawModelId }
}

const noRedirectFetch: typeof fetch = async (input, init) => {
  return await fetch(input, { ...init, redirect: 'error' })
}

export async function getLanguageModel(
  modelId: string,
  accessToken?: string,
  userId?: string,
): Promise<LanguageModelV3> {
  const parsed = parseByokModelId(modelId)
  if (isByokModelId(modelId) && !parsed) throw new Error('Invalid BYOK model id.')
  if (parsed) {
    if (!userId) throw new Error('Authenticated user required for BYOK models.')
    const { connection, rawModelId } = await assertUserCanUseByokModel(modelId, userId)
    const apiKey = connection.vaultObjectId
      ? await readByokVaultKey(connection.vaultObjectId)
      : null
    const byokConnection: ByokConnection = {
      providerId: connection.providerId,
      endpoint: connection.endpoint,
    }
    const gateway = new ByokGateway({
      connection: byokConnection,
      apiKey,
      fetch: noRedirectFetch,
    })
    const model = await gateway.createLanguageModel(rawModelId, { accessToken })
    return model.implementation as LanguageModelV3
  }

  const model = await getOverlayServerContext().llmGateway.createLanguageModel(
    modelId,
    { accessToken },
  )
  return model.implementation as LanguageModelV3
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
