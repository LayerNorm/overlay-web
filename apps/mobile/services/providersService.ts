import { appJson } from './appApi'
import { readProviders } from './settingsNativeService'

/**
 * BYOK provider connections (`/api/v1/providers/connections*`).
 *
 * The preset list mirrors `BYOK_PROVIDER_PRESETS` in
 * `packages/overlay-llm-gateway/src/adapters/byok-presets.ts`. The mobile app
 * does not link that package (it carries server-side dependencies), so the
 * static UI fields are duplicated here — keep the two in sync when presets
 * change. Only fields the mobile UI needs are mirrored.
 */

export interface ByokProviderPreset {
  id: string
  label: string
  defaultBaseURL: string
  allowsCustomEndpoint: boolean
  requiresApiKey: boolean
  docsURL: string
}

export interface ProviderConnection {
  _id: string
  providerId: string
  endpoint: string
  displayName: string
  enabledModelIds: string[]
  discoveredModelsJson?: string
  discoveredAt?: number
  status: 'active' | 'error' | 'untested'
  lastError?: string
  lastTestedAt?: number
  isDefault: boolean
  isDeletable: boolean
  createdAt?: number
  updatedAt?: number
}

export interface DiscoveredProviderModel {
  id: string
  name: string
}

export interface ProviderConnectionTestResult {
  ok: boolean
  models: DiscoveredProviderModel[]
  error?: string
}

export const BYOK_PROVIDER_PRESETS: readonly ByokProviderPreset[] = [
  {
    id: 'user-vercel-ai-gateway',
    label: 'Vercel AI Gateway',
    defaultBaseURL: 'https://ai-gateway.vercel.sh/v1',
    allowsCustomEndpoint: false,
    requiresApiKey: true,
    docsURL: 'https://vercel.com/docs/ai-gateway',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultBaseURL: 'https://openrouter.ai/api/v1',
    allowsCustomEndpoint: false,
    requiresApiKey: true,
    docsURL: 'https://openrouter.ai',
  },
  {
    id: 'groq',
    label: 'Groq',
    defaultBaseURL: 'https://api.groq.com/openai/v1',
    allowsCustomEndpoint: false,
    requiresApiKey: true,
    docsURL: 'https://console.groq.com',
  },
  {
    id: 'nvidia-nim',
    label: 'NVIDIA NIM',
    defaultBaseURL: 'https://integrate.api.nvidia.com/v1',
    allowsCustomEndpoint: false,
    requiresApiKey: true,
    docsURL: 'https://build.nvidia.com',
  },
  {
    id: 'together',
    label: 'Together AI',
    defaultBaseURL: 'https://api.together.xyz/v1',
    allowsCustomEndpoint: false,
    requiresApiKey: true,
    docsURL: 'https://docs.together.ai',
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    defaultBaseURL: 'https://api.fireworks.ai/inference/v1',
    allowsCustomEndpoint: false,
    requiresApiKey: true,
    docsURL: 'https://docs.fireworks.ai',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultBaseURL: 'https://api.deepseek.com/v1',
    allowsCustomEndpoint: false,
    requiresApiKey: true,
    docsURL: 'https://api-docs.deepseek.com',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    defaultBaseURL: 'https://api.x.ai/v1',
    allowsCustomEndpoint: false,
    requiresApiKey: true,
    docsURL: 'https://docs.x.ai',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    defaultBaseURL: 'https://api.mistral.ai/v1',
    allowsCustomEndpoint: false,
    requiresApiKey: true,
    docsURL: 'https://docs.mistral.ai',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    defaultBaseURL: 'https://api.cerebras.ai/v1',
    allowsCustomEndpoint: false,
    requiresApiKey: true,
    docsURL: 'https://cerebras.ai',
  },
  {
    id: 'deepinfra',
    label: 'DeepInfra',
    defaultBaseURL: 'https://api.deepinfra.com/v1/openai',
    allowsCustomEndpoint: false,
    requiresApiKey: true,
    docsURL: 'https://deepinfra.com',
  },
  {
    id: 'custom-openai-compatible',
    label: 'Custom OpenAI-compatible',
    defaultBaseURL: '',
    allowsCustomEndpoint: true,
    requiresApiKey: false,
    docsURL: 'https://platform.openai.com/docs/api-reference',
  },
]

export function getByokPreset(providerId: string): ByokProviderPreset | undefined {
  return BYOK_PROVIDER_PRESETS.find((preset) => preset.id === providerId)
}

export function discoveredModelsOf(connection: ProviderConnection): DiscoveredProviderModel[] {
  if (!connection.discoveredModelsJson) return []
  try {
    const parsed = JSON.parse(connection.discoveredModelsJson) as { data?: unknown }
    if (!parsed || !Array.isArray(parsed.data)) return []
    return parsed.data
      .filter(
        (model): model is { id: string; name?: string } =>
          !!model && typeof model === 'object' && typeof (model as { id?: unknown }).id === 'string',
      )
      .map((model) => ({ id: model.id, name: typeof model.name === 'string' ? model.name : model.id }))
  } catch {
    return []
  }
}

export async function listProviderConnections(): Promise<ProviderConnection[]> {
  const rows = await readProviders()
  if (!rows) throw new Error('Provider connections are unavailable in this workspace.')
  return rows.filter(row => row.authKind !== 'subscription').map(row => ({ ...row, status: row.status === 'pending' ? 'untested' as const : row.status }))
}

export async function createProviderConnection(input: {
  providerId: string
  displayName: string
  apiKey?: string
  endpoint?: string
  enabledModelIds?: string[]
}): Promise<string> {
  const response = await appJson<{ id: string }>('/api/v1/providers/connections', {
    method: 'POST',
    json: {
      providerId: input.providerId,
      displayName: input.displayName,
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      ...(input.endpoint ? { endpoint: input.endpoint } : {}),
      ...(input.enabledModelIds ? { enabledModelIds: input.enabledModelIds } : {}),
    },
    // The server rejects connection creation without an Idempotency-Key (428).
    headers: { 'Idempotency-Key': `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 12)}` },
  })
  return response.id
}

export async function updateProviderConnection(input: {
  connectionId: string
  displayName?: string
  endpoint?: string
  apiKey?: string
  enabledModelIds?: string[]
  status?: 'active' | 'error' | 'untested'
  lastError?: string
  lastTestedAt?: number
  discoveredModelsJson?: string
  discoveredAt?: number
}): Promise<void> {
  await appJson<{ success: boolean }>('/api/v1/providers/connections', {
    method: 'PATCH',
    json: {
      connectionId: input.connectionId,
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.endpoint !== undefined ? { endpoint: input.endpoint } : {}),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      ...(input.enabledModelIds !== undefined ? { enabledModelIds: input.enabledModelIds } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
      ...(input.lastTestedAt !== undefined ? { lastTestedAt: input.lastTestedAt } : {}),
      ...(input.discoveredModelsJson !== undefined
        ? { discoveredModelsJson: input.discoveredModelsJson }
        : {}),
      ...(input.discoveredAt !== undefined ? { discoveredAt: input.discoveredAt } : {}),
    },
  })
}

export async function deleteProviderConnection(connectionId: string): Promise<void> {
  await appJson<{ success: boolean }>('/api/v1/providers/connections', {
    method: 'DELETE',
    query: { connectionId },
  })
}

/**
 * Tests a provider's model-discovery endpoint. With `connectionId` the server
 * tests the stored connection (using its saved API key); without it the
 * providerId/endpoint/apiKey triple is tested ad hoc — the same two modes the
 * web `ProviderDialog` uses before and after saving.
 */
export async function testProviderConnection(input: {
  connectionId?: string
  providerId?: string
  endpoint?: string
  apiKey?: string
}): Promise<ProviderConnectionTestResult> {
  return appJson<ProviderConnectionTestResult>('/api/v1/providers/connections/test', {
    method: 'POST',
    json: {
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.endpoint ? { endpoint: input.endpoint } : {}),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    },
    timeoutMs: 25_000,
  })
}
