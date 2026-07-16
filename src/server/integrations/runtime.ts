import 'server-only'

import { getOverlayRuntimeConfigSync } from '@/server/config'
import { hashOperationalIdentifier } from '@/server/security/operational-key-hash'
import { ComposioIntegrationProvider } from './ComposioIntegrationProvider'
import { ExecutorIntegrationProvider } from './ExecutorIntegrationProvider'
import type { IntegrationProvider } from './contracts'
import { filterComposioToolSet, filterComposioToolSetForPaidOnlyFeatures } from '@/server/tools/tools/composio-filter'
import type { ToolSet } from 'ai'

let cached: { key: string; provider: IntegrationProvider } | null = null

export function getSelectedIntegrationProviderId(): 'composio' | 'executor' | 'none' {
  const config = getOverlayRuntimeConfigSync()
  const selected = config.providers.integrations?.provider ??
    (config.features.integrations === false ? 'none' : 'composio')
  return selected === 'executor' || selected === 'composio' ? selected : 'none'
}

export function getIntegrationProvider(): IntegrationProvider {
  const config = getOverlayRuntimeConfigSync()
  const selected = getSelectedIntegrationProviderId()
  if (selected === 'none') throw new Error('Integrations are disabled')
  const executor = config.integrations.executor
  const key = selected === 'executor'
    ? [
        selected,
        executor.apiBaseUrl,
        executor.webBaseUrl,
        executor.connectionOwner,
        hashOperationalIdentifier('executor-provider-cache:v1', executor.apiKey ?? ''),
      ].join(':')
    : selected
  if (cached?.key === key) return cached.provider

  const provider: IntegrationProvider = selected === 'executor'
    ? new ExecutorIntegrationProvider({
        apiBaseUrl: executor.apiBaseUrl!,
        webBaseUrl: executor.webBaseUrl!,
        apiKey: executor.apiKey!,
        connectionOwner: executor.connectionOwner,
        requestTimeoutMs: executor.requestTimeoutMs,
      })
    : new ComposioIntegrationProvider()
  cached = { key, provider }
  return provider
}

export async function createIntegrationToolSet(args: {
  accessToken?: string
  userId: string
  conversationId?: string
  turnId?: string
}) {
  return await getIntegrationProvider().createToolSet(args)
}

export function filterIntegrationToolSet(
  tools: ToolSet,
  paid: boolean,
  provider: 'composio' | 'executor' | 'none' = 'composio',
): ToolSet {
  if (provider !== 'composio') return tools
  return filterComposioToolSetForPaidOnlyFeatures(filterComposioToolSet(tools), paid)
}

export function clearIntegrationProviderCache(): void {
  cached = null
}
