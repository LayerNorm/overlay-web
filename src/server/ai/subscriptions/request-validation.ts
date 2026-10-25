import 'server-only'

const nonTextTypes = new Set([
  'input_image', 'image', 'audio', 'input_audio', 'output_audio', 'video',
  'input_video', 'file', 'input_file', 'computer', 'browser', 'file_search',
  'web_search', 'code_interpreter', 'image_generation', 'mcp',
])

export function assertSupportedCodexRequest(body: Record<string, unknown>, modelId: string) {
  if (body.model !== modelId) throw new Error('Subscription model mismatch')
  if (body.zero_data_retention === true || body.zeroDataRetention === true || body.zdr === true) {
    throw new Error('This subscription service does not guarantee zero data retention')
  }
  inspectTextOnly(body)
  validateTools(body)
  for (const option of [
    'temperature', 'top_p', 'max_output_tokens', 'max_completion_tokens',
    'truncation', 'user', 'previous_response_id', 'prompt_cache_retention',
  ]) {
    if (body[option] !== undefined && body[option] !== null) {
      throw new Error(`Codex subscription requests do not support ${option}`)
    }
  }
  if (body.instructions !== undefined && typeof body.instructions !== 'string') {
    throw new Error('Invalid Codex instructions')
  }
}

function inspectTextOnly(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) inspectTextOnly(item)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value)) {
    if (['image_url', 'input_image', 'input_audio', 'audio_url', 'video_url', 'input_file'].includes(key)) {
      throw new Error('This subscription service supports text-only requests')
    }
    if (key === 'modalities' && Array.isArray(nested) && nested.some((item) => item !== 'text')) {
      throw new Error('This subscription service supports text-only requests')
    }
    if (key === 'type' && typeof nested === 'string' && nonTextTypes.has(nested)) {
      throw new Error('This subscription service supports text-only requests')
    }
    inspectTextOnly(nested)
  }
}

function toolName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateTools(body: Record<string, unknown>): void {
  if (!Array.isArray(body.tools)) return
  for (const tool of body.tools) {
    if (!isRecord(tool)) throw new Error('Hosted subscription tools are not supported')
    if (tool.type === 'function') {
      if (!toolName(tool.name) || !isRecord(tool.parameters) ||
          Object.keys(tool).some((key) =>
            !['type', 'name', 'description', 'parameters', 'strict'].includes(key)
          )) {
        throw new Error('Invalid Codex function tool')
      }
    } else if (tool.type === 'custom') {
      if (!toolName(tool.name) ||
          Object.keys(tool).some((key) =>
            !['type', 'name', 'description', 'format'].includes(key)
          )) {
        throw new Error('Invalid Codex custom text tool')
      }
    } else {
      throw new Error('Hosted subscription tools are not supported')
    }
  }
  if (typeof body.tool_choice === 'string' &&
      !['auto', 'none', 'required'].includes(body.tool_choice)) {
    throw new Error('Hosted subscription tools are not supported')
  }
}

export function normalizeCodexResponsesBody(
  body: Record<string, unknown>,
  modelId: string,
): Record<string, unknown> {
  assertSupportedCodexRequest(body, modelId)
  const input = Array.isArray(body.input)
    ? body.input.map((item) => {
        if (!isRecord(item) || item.role !== 'system') return item
        return { ...item, role: 'developer' }
      })
    : body.input
  const instructions = typeof body.instructions === 'string' ? body.instructions : ''
  const include = Array.isArray(body.include) ? body.include : []
  return {
    ...body,
    input,
    instructions,
    include: [...new Set([...include, 'reasoning.encrypted_content'])],
    stream: true,
    store: false,
  }
}
