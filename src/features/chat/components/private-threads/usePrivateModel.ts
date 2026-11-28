'use client'

import { useEffect, useMemo, useState } from 'react'
import type { DesktopBridge, LocalModelKeys, LocalPlans } from '@overlay/desktop-bridge'
import { useLiveWorkspaceBilling } from '@/hooks/use-billing'
import { getModel } from '@/shared/ai/gateway/model-data'
import { resolvePrivateModel, type ProviderModelList } from '@/shared/agents/private-model'
import {
  PRIVATE_MODEL_PROVIDERS,
  PRIVATE_PLAN_CATALOG_PROVIDER,
  PRIVATE_PLAN_NAMES,
  PRIVATE_PLAN_PROVIDERS,
  PRIVATE_PROVIDER_NAMES,
  type PrivateModelProvider,
  type PrivatePlanProvider,
} from '@/shared/agents/private-threads'

type ListedSource = PrivateModelProvider | PrivatePlanProvider
const cache = new Map<ListedSource, Promise<{ id: string; name: string }[]>>()

/**
 * The agent's own model, run from the first source that has it (src/shared/agents/private-model.ts): a signed-in
 * plan, a key on this computer, or Overlay's models in a paid workspace. `resolved` is null when none can run it.
 */
export function usePrivateModel(
  bridge: DesktopBridge,
  keys: LocalModelKeys | null,
  plans: LocalPlans | null,
  agentModelId: string,
  workspaceId: string,
) {
  const [lists, setLists] = useState<ProviderModelList[] | null>(null)
  const billing = useLiveWorkspaceBilling(workspaceId)
  const sources = useMemo<ListedSource[] | null>(() => keys && plans ? [
    ...(plans.available ? PRIVATE_PLAN_PROVIDERS.filter((plan) => plans[plan].signedIn) : []),
    ...PRIVATE_MODEL_PROVIDERS.filter((provider) => keys[provider]),
  ] : null, [keys, plans])
  useEffect(() => {
    if (!sources) return
    let live = true
    void Promise.all(sources.map(async (provider) => {
      let models = cache.get(provider)
      if (!models) {
        models = bridge.call('localThreads.models', { provider }).then((result) => result.models)
        cache.set(provider, models)
        models.catch(() => cache.delete(provider))
      }
      return { provider, models: await models.catch(() => []) }
    })).then((result) => { if (live) setLists(result) })
    return () => { live = false }
  }, [bridge, sources])

  const catalog = getModel(agentModelId)
  const provider = catalog?.provider ?? (agentModelId.includes('/') ? agentModelId.split('/')[0] : undefined)
  // Overlay's models need a paid workspace and a desktop app that can call them.
  const overlay = { available: Boolean(plans?.overlayModels && catalog && billing?.executionAccess?.canExecute) }
  const plan = PRIVATE_PLAN_PROVIDERS.find((candidate) => PRIVATE_PLAN_CATALOG_PROVIDER[candidate] === provider)
  const direct = provider && provider in PRIVATE_PROVIDER_NAMES && provider !== 'openrouter'
    ? PRIVATE_PROVIDER_NAMES[provider as PrivateModelProvider] : null
  return {
    loading: !sources || (sources.length > 0 && lists === null) || billing === undefined,
    resolved: lists || sources?.length === 0
      ? resolvePrivateModel(agentModelId, catalog?.provider, lists ?? [], overlay)
      : null,
    modelName: catalog?.name ?? agentModelId,
    /** What could run this model, for the notice: a plan, a key, or (unpaid workspaces) upgrading for Overlay's. */
    notice: [
      `To run it on this computer, ${plan && plans?.available ? `sign in to ${PRIVATE_PLAN_NAMES[plan]} or ` : ''}` +
        `add ${direct ? `${article(direct)} ${direct} or OpenRouter` : 'an OpenRouter'} key.`,
      plans?.overlayModels && catalog && billing?.executionAccess?.canExecute === false
        ? 'A paid workspace can also use Overlay’s models.' : '',
    ].filter(Boolean).join(' '),
  }
}

const article = (word: string) => /^[AEIOU]/i.test(word) ? 'an' : 'a'
