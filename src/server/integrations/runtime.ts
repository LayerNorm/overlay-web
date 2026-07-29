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
  enabledConnectorSlugs?: readonly string[],
): ToolSet {
  const planFiltered = provider === 'composio'
    ? filterComposioToolSetForPaidOnlyFeatures(filterComposioToolSet(tools), paid)
    : tools
  return scopeIntegrationToolSet(planFiltered, enabledConnectorSlugs)
}

/**
 * Narrows dynamic connector meta-tools to the project's connector allowlist.
 *
 * Composio and Executor expose search/execute meta-tools rather than one static
 * tool per connector. Search and execution inputs must therefore name an
 * allowed connector. An explicit empty list disables the surface entirely.
 */
export function scopeIntegrationToolSet(
  tools: ToolSet,
  enabledConnectorSlugs?: readonly string[],
): ToolSet {
  if (enabledConnectorSlugs === undefined) return tools
  const allowed = [
    ...new Set(enabledConnectorSlugs.map((slug) => slug.trim().toLowerCase()).filter(Boolean)),
  ]
  if (allowed.length === 0) return {}

  const scoped: ToolSet = {}
  for (const [name, definition] of Object.entries(tools)) {
    if (!definition || typeof definition !== 'object') continue
    const execute = (definition as { execute?: unknown }).execute
    if (typeof execute !== 'function') {
      scoped[name] = definition
      continue
    }
    scoped[name] = {
      ...definition,
      execute: async (input: unknown, options: unknown) => {
        const serialized = JSON.stringify(input ?? {}).toLowerCase()
        if (!allowed.some((slug) => serialized.includes(slug))) {
          throw new Error(
            `This project only permits these connectors: ${allowed.join(', ')}. `
            + 'Name one explicitly when searching or executing a connector tool.',
          )
        }
        return await (execute as (input: unknown, options: unknown) => Promise<unknown>)(input, options)
      },
    }
  }
  return scoped
}

export function clearIntegrationProviderCache(): void {
  cached = null
}
