import { getByokModelProtocol, getByokPreset } from '@overlay/llm-gateway'

type ProbeModel = { id: string }

export const OPENCODE_PROVIDER_IDS = ['opencode-go', 'opencode-zen'] as const
export type OpenCodeProviderId = (typeof OPENCODE_PROVIDER_IDS)[number]

export function isOpenCodeProviderId(value: string): value is OpenCodeProviderId {
  return (OPENCODE_PROVIDER_IDS as readonly string[]).includes(value)
}

// OpenCode's catalog also lists embeddings, images, realtime, video and
// routing ("decision") models. Only chat models served through chat
// completions, Responses or Messages can back an Overlay chat model.
const OPENCODE_CHAT_APIS = new Set(['chat-completions', 'responses', 'messages', 'interactions', 'generate-content'])

export function isOpenCodeChatModel(entry: Record<string, unknown>): boolean {
  if (entry.type !== undefined && entry.type !== 'chat') return false
  const recommended = entry.recommended_api
  return recommended === undefined || (typeof recommended === 'string' && OPENCODE_CHAT_APIS.has(recommended))
}

export function selectOpenCodeGoProbeModel(models: readonly ProbeModel[]): ProbeModel | null {
  const chatModels = models.filter(({ id }) => (
    getByokModelProtocol('opencode-go', id) === 'chat'
  ))
  return chatModels.find(({ id }) => id.endsWith('-free')) ?? chatModels[0] ?? null
}

/**
 * Zen is billed per request, so the key check must not spend credits. A
 * request for a model that does not exist is authenticated first: a valid key
 * gets a model error, an invalid key gets 401. The model list itself is
 * public, so it cannot prove the key.
 */
export const OPENCODE_ZEN_KEY_CHECK_MODEL = 'overlay-key-check'

export async function checkOpenCodeZenKey({ endpoint, apiKey, fetch: providerFetch, sessionId }: {
  endpoint: string
  apiKey: string
  fetch: typeof fetch
  sessionId: string
}): Promise<string | null> {
  const preset = getByokPreset('opencode-zen')
  const response = await providerFetch(`${endpoint.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...preset?.headers,
      'x-opencode-session': sessionId,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENCODE_ZEN_KEY_CHECK_MODEL,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ok' }],
    }),
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  await response.body?.cancel().catch((_error) => undefined)
  if (response.status === 401 || response.status === 403) {
    return 'OpenCode Zen rejected the API key or account access.'
  }
  if (response.status >= 500) {
    return `OpenCode Zen key check failed with HTTP ${response.status}.`
  }
  return null
}

export function sanitizeOpenCodeGoProbeError(error: unknown, apiKey: string): string {
  const record = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : {}
  const status = typeof record.statusCode === 'number'
    ? record.statusCode
    : typeof record.status === 'number'
      ? record.status
      : null
  const responseBody = typeof record.responseBody === 'string' ? record.responseBody : ''
  const message = error instanceof Error ? error.message : ''
  const text = `${message} ${responseBody}`.replaceAll(apiKey, '[REDACTED]').toLowerCase()

  if (text.includes('missingsessionid')) {
    return 'OpenCode Go reported MissingSessionID. The provider requires a session header.'
  }
  if (
    status === 401 ||
    status === 403 ||
    /unauthori[sz]ed|invalid.*(?:api|access).*key|authentication|forbidden/.test(text)
  ) {
    return 'OpenCode Go rejected the API key or account access.'
  }
  if (
    status === 402 ||
    /subscription|billing|quota|payment|entitlement|plan/.test(text)
  ) {
    return 'OpenCode Go reported a subscription or billing issue.'
  }
  if (status !== null) {
    return `OpenCode Go inference check failed with HTTP ${status}.`
  }
  return 'OpenCode Go inference check failed. Verify the API key and model access.'
}
