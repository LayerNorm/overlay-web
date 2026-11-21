import type { PrivateModelProvider } from './private-threads-protocol.js'

export type PrivateModelInfo = { id: string; name: string }

/**
 * Lists the chat models a key can use, straight from the provider. Used to check
 * a key when the person adds it and to fill the model picker; nothing is cached.
 */
export async function listProviderModels(
  provider: PrivateModelProvider,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PrivateModelInfo[]> {
  const get = async (url: string, headers: Record<string, string>) => {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15_000) })
    if (response.status === 401 || response.status === 403) throw new Error('The provider did not accept this key.')
    if (!response.ok) throw new Error(`The provider answered ${response.status}.`)
    return await response.json() as Record<string, unknown>
  }
  switch (provider) {
    case 'anthropic': {
      const body = await get('https://api.anthropic.com/v1/models?limit=1000', { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' })
      return rows(body.data).map(row => ({ id: String(row.id), name: String(row.display_name ?? row.id) }))
    }
    case 'openai': {
      const body = await get('https://api.openai.com/v1/models', { authorization: `Bearer ${apiKey}` })
      return rows(body.data)
        .map(row => String(row.id))
        .filter(id => /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|transcribe|tts|image|search|instruct|embedding)/.test(id))
        .sort((a, b) => b.localeCompare(a))
        .map(id => ({ id, name: id }))
    }
    case 'google': {
      const body = await get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { 'x-goog-api-key': apiKey })
      return rows(body.models)
        .filter(row => Array.isArray(row.supportedGenerationMethods) && row.supportedGenerationMethods.includes('generateContent'))
        .filter(row => /gemini/.test(String(row.name)) && !/(embedding|tts|image|audio|live)/.test(String(row.name)))
        .map(row => ({ id: String(row.name).replace(/^models\//, ''), name: String(row.displayName ?? row.name) }))
    }
    case 'openrouter': {
      await get('https://openrouter.ai/api/v1/key', { authorization: `Bearer ${apiKey}` })
      const body = await get('https://openrouter.ai/api/v1/models?supported_parameters=tools', { authorization: `Bearer ${apiKey}` })
      return rows(body.data).map(row => ({ id: String(row.id), name: String(row.name ?? row.id) }))
    }
  }
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object')) : []
}
