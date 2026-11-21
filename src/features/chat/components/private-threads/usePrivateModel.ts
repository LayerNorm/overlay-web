'use client'

import { useEffect, useState } from 'react'
import type { DesktopBridge, LocalModelKeys } from '@overlay/desktop-bridge'
import { getModel } from '@/shared/ai/gateway/model-data'
import { resolvePrivateModel, type ProviderModelList } from '@/shared/agents/private-model'
import { PRIVATE_MODEL_PROVIDERS, PRIVATE_PROVIDER_NAMES, type PrivateModelProvider } from '@/shared/agents/private-threads'

const cache = new Map<PrivateModelProvider, Promise<{ id: string; name: string }[]>>()

/** The agent's own model, run with a key on this computer; `resolved` is null when no key can run it. */
export function usePrivateModel(bridge: DesktopBridge, keys: LocalModelKeys | null, agentModelId: string) {
  const [lists, setLists] = useState<ProviderModelList[] | null>(null)
  useEffect(() => {
    if (!keys) return
    let live = true
    const providers = PRIVATE_MODEL_PROVIDERS.filter((provider) => keys[provider])
    void Promise.all(providers.map(async (provider) => {
      let models = cache.get(provider)
      if (!models) {
        models = bridge.call('localThreads.models', { provider }).then((result) => result.models)
        cache.set(provider, models)
        models.catch(() => cache.delete(provider))
      }
      return { provider, models: await models.catch(() => []) }
    })).then((result) => { if (live) setLists(result) })
    return () => { live = false }
  }, [bridge, keys])

  const catalog = getModel(agentModelId)
  const provider = catalog?.provider ?? (agentModelId.includes('/') ? agentModelId.split('/')[0] : undefined)
  const direct = provider && provider in PRIVATE_PROVIDER_NAMES ? PRIVATE_PROVIDER_NAMES[provider as PrivateModelProvider] : null
  return {
    loading: !keys || (Object.values(keys).some(Boolean) && lists === null),
    resolved: lists ? resolvePrivateModel(agentModelId, catalog?.provider, lists) : null,
    modelName: catalog?.name ?? agentModelId,
    /** The keys that could run this model, for the notice: its own provider and OpenRouter. */
    keyNames: direct && direct !== 'OpenRouter' ? `${direct} or OpenRouter` : 'OpenRouter',
  }
}
