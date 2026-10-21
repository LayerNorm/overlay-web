import { getByokModelProtocol } from '@overlay/llm-gateway'

type ProbeModel = { id: string }

export function selectOpenCodeGoProbeModel(models: readonly ProbeModel[]): ProbeModel | null {
  const chatModels = models.filter(({ id }) => (
    getByokModelProtocol('opencode-go', id) === 'chat'
  ))
  return chatModels.find(({ id }) => id.endsWith('-free')) ?? chatModels[0] ?? null
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
