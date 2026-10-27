import 'server-only'

import type { CodexTokenSet } from '@/server/agents/provider-accounts/codex-subscription'
import type { SubscriptionModel } from './types'

export const CODEX_MODELS_URL =
  'https://chatgpt.com/backend-api/codex/models?client_version=0.154.0'

type ModelInfo = Record<string, unknown>

async function readBoundedJson(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('Codex model discovery response is too large')
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

function supportedModel(value: unknown): value is ModelInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const model = value as ModelInfo
  return model.is_hidden !== true &&
    model.hidden !== true &&
    model.visibility !== 'hidden' &&
    model.supported !== false &&
    model.supported_in_api !== false &&
    model.supported_in_codex !== false
}

export function parseCodexModels(value: unknown): SubscriptionModel[] {
  if (!value || typeof value !== 'object' || !('models' in value) ||
      !Array.isArray(value.models)) return []
  const seen = new Set<string>()
  return value.models.flatMap((item) => {
    if (!supportedModel(item)) return []
    const id = typeof item.slug === 'string' ? item.slug.trim() : ''
    if (!/^[A-Za-z0-9._~:/@+-]{1,100}$/.test(id) || seen.has(id)) return []
    seen.add(id)
    const displayName = typeof item.display_name === 'string' && item.display_name.trim()
      ? item.display_name.trim().slice(0, 200)
      : id
    return [{ id, name: displayName }]
  }).slice(0, 400)
}

export async function discoverCodexModels(
  tokens: CodexTokenSet,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<SubscriptionModel[]> {
  const headers = new Headers({
    accept: 'application/json',
    authorization: `Bearer ${tokens.accessToken}`,
  })
  if (tokens.accountId) headers.set('ChatGPT-Account-Id', tokens.accountId)
  const response = await (options.fetch ?? fetch)(CODEX_MODELS_URL, {
    method: 'GET',
    headers,
    redirect: 'error',
    cache: 'no-store',
    signal: options.signal ?? AbortSignal.timeout(20_000),
  })
  const body = await readBoundedJson(response, 1_000_000)
  if (!response.ok) throw new Error('Codex model discovery is unavailable')
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (_error) {
    throw new Error('Codex model discovery returned an invalid response')
  }
  const models = parseCodexModels(parsed)
  if (models.length === 0) throw new Error('Codex account has no supported models')
  return models
}
