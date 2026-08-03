/**
 * Provider presets for BYOK (bring-your-own-key) connections.
 *
 * Each preset describes a cloud AI provider that exposes an OpenAI-compatible
 * `/v1/chat/completions` endpoint. The preset supplies the default base URL,
 * model-discovery path, and any provider-specific headers. At runtime, a
 * {@link ByokGateway} is constructed per user connection with the user's API
 * key. Provider endpoints are fixed to vendor-owned HTTPS origins.
 *
 * The Overlay preset is special: it is pre-seeded for every user,
 * cannot be deleted, and uses Overlay's hosted gateway key through the hosted gateway
 * runtime path. Users who want to bring their own Vercel AI Gateway key use
 * the separate `user-vercel-ai-gateway` preset below.
 *
 * Local Ollama support is postponed to a future phase — only cloud providers
 * are included here.
 */

export type ByokDiscoveryShape = 'openai' | 'none'

export interface ByokProviderPreset {
  /** Unique preset id, stored on the user connection record. */
  id: string
  /** Human-readable label shown in the UI. */
  label: string
  /** Default base URL for the provider's OpenAI-compatible API. */
  defaultBaseURL: string
  /** Path appended to the base URL to list available models (e.g. `/models`). */
  discoveryPath: string
  /** Shape of the model-discovery response. `openai` = `{ data: [{ id }] }`. */
  discoveryShape: ByokDiscoveryShape
  /** Whether an API key is required to use this provider. */
  requiresApiKey: boolean
  /** Whether this connection is pre-seeded for every user and cannot be deleted. */
  isDefault: boolean
  /** Whether the user can delete this connection. `false` for the Vercel AI Gateway. */
  isDeletable: boolean
  /** Provider-specific headers to send with every request. */
  headers?: Record<string, string>
  /** Link to provider docs, shown in the UI. */
  docsURL: string
}

export const BYOK_PROVIDER_PRESETS: readonly ByokProviderPreset[] = [
  {
    id: 'vercel-ai-gateway',
    label: 'Overlay',
    defaultBaseURL: 'https://ai-gateway.vercel.sh/v1',
    discoveryPath: '/models',
    discoveryShape: 'openai',
    requiresApiKey: true,
    isDefault: true,
    isDeletable: false,
    docsURL: 'https://vercel.com/docs/ai-gateway',
  },
  {
    id: 'user-vercel-ai-gateway',
    label: 'Vercel AI Gateway',
    defaultBaseURL: 'https://ai-gateway.vercel.sh/v1',
    discoveryPath: '/models',
    discoveryShape: 'openai',
    requiresApiKey: true,
    isDefault: false,
    isDeletable: true,
    docsURL: 'https://vercel.com/docs/ai-gateway',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultBaseURL: 'https://openrouter.ai/api/v1',
    discoveryPath: '/models',
    discoveryShape: 'openai',
    requiresApiKey: true,
    isDefault: false,
    isDeletable: true,
    headers: {
      'HTTP-Referer': 'https://getoverlay.io',
      'X-Title': 'Overlay',
    },
    docsURL: 'https://openrouter.ai',
  },
  {
    id: 'groq',
    label: 'Groq',
    defaultBaseURL: 'https://api.groq.com/openai/v1',
    discoveryPath: '/models',
    discoveryShape: 'openai',
    requiresApiKey: true,
    isDefault: false,
    isDeletable: true,
    docsURL: 'https://console.groq.com',
  },
  {
    id: 'nvidia-nim',
    label: 'NVIDIA NIM',
    defaultBaseURL: 'https://integrate.api.nvidia.com/v1',
    discoveryPath: '/models',
    discoveryShape: 'openai',
    requiresApiKey: true,
    isDefault: false,
    isDeletable: true,
    docsURL: 'https://build.nvidia.com',
  },
  {
    id: 'together',
    label: 'Together AI',
    defaultBaseURL: 'https://api.together.xyz/v1',
    discoveryPath: '/models',
    discoveryShape: 'openai',
    requiresApiKey: true,
    isDefault: false,
    isDeletable: true,
    docsURL: 'https://docs.together.ai',
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    defaultBaseURL: 'https://api.fireworks.ai/inference/v1',
    discoveryPath: '/models',
    discoveryShape: 'openai',
    requiresApiKey: true,
    isDefault: false,
    isDeletable: true,
    docsURL: 'https://docs.fireworks.ai',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultBaseURL: 'https://api.deepseek.com/v1',
    discoveryPath: '/models',
    discoveryShape: 'openai',
    requiresApiKey: true,
    isDefault: false,
    isDeletable: true,
    docsURL: 'https://api-docs.deepseek.com',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    defaultBaseURL: 'https://api.x.ai/v1',
    discoveryPath: '/models',
    discoveryShape: 'openai',
    requiresApiKey: true,
    isDefault: false,
    isDeletable: true,
    docsURL: 'https://docs.x.ai',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    defaultBaseURL: 'https://api.mistral.ai/v1',
    discoveryPath: '/models',
    discoveryShape: 'openai',
    requiresApiKey: true,
    isDefault: false,
    isDeletable: true,
    docsURL: 'https://docs.mistral.ai',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    defaultBaseURL: 'https://api.cerebras.ai/v1',
    discoveryPath: '/models',
    discoveryShape: 'openai',
    requiresApiKey: true,
    isDefault: false,
    isDeletable: true,
    docsURL: 'https://cerebras.ai',
  },
  {
    id: 'deepinfra',
    label: 'DeepInfra',
    defaultBaseURL: 'https://api.deepinfra.com/v1/openai',
    discoveryPath: '/models',
    discoveryShape: 'openai',
    requiresApiKey: true,
    isDefault: false,
    isDeletable: true,
    docsURL: 'https://deepinfra.com',
  },
]

const PRESET_BY_ID = new Map<string, ByokProviderPreset>(
  BYOK_PROVIDER_PRESETS.map((preset) => [preset.id, preset]),
)

export function getByokPreset(providerId: string): ByokProviderPreset | undefined {
  return PRESET_BY_ID.get(providerId)
}

export function isDefaultByokPreset(providerId: string): boolean {
  return PRESET_BY_ID.get(providerId)?.isDefault ?? false
}
