import { PROVIDERS, subscriptionError } from './state.mjs'

const MAX_BODY_BYTES = 2_000_000

export function assertSupportedSubscriptionRequest(body) {
  if (body.zero_data_retention === true || body.zeroDataRetention === true || body.zdr === true) {
    throw subscriptionError(400, 'This subscription service does not guarantee zero data retention')
  }
  const inspect = (value) => {
    if (Array.isArray(value)) {
      value.forEach(inspect)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, nested] of Object.entries(value)) {
      if (['image_url', 'input_image', 'input_audio', 'audio_url', 'video_url', 'input_file'].includes(key)) {
        throw subscriptionError(400, 'This subscription service supports text-only requests')
      }
      if (key === 'modalities' && Array.isArray(nested) &&
          nested.some((modality) => modality !== 'text')) {
        throw subscriptionError(400, 'This subscription service supports text-only requests')
      }
      if (key === 'type' && typeof nested === 'string' &&
          /^(?:input_image|image|audio|input_audio|output_audio|video|input_video|file|input_file|computer|browser|file_search)$/.test(nested)) {
        throw subscriptionError(400, 'This subscription service supports text-only requests')
      }
      inspect(nested)
    }
  }
  inspect(body)
}

function toolName(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
}

function jsonSchema(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function assertFunctionTool(tool, pathname) {
  const responses = pathname === '/v1/responses'
  const definition = responses ? tool : tool.function
  if (!definition || typeof definition !== 'object' || Array.isArray(definition) ||
      (responses ? 'function' in tool : 'name' in tool) ||
      !toolName(definition.name) || !jsonSchema(definition.parameters) ||
      (definition.description !== undefined &&
        (typeof definition.description !== 'string' || definition.description.length > 1024)) ||
      (definition.strict !== undefined && typeof definition.strict !== 'boolean')) {
    throw subscriptionError(400, 'Invalid function tool')
  }
  if (!responses && (Object.keys(tool).some((key) => !['type', 'function'].includes(key)) ||
      Object.keys(definition).some((key) =>
        !['name', 'description', 'parameters', 'strict'].includes(key)))) {
    throw subscriptionError(400, 'Invalid function tool')
  }
  if (responses && Object.keys(tool).some((key) =>
    !['type', 'name', 'description', 'parameters', 'strict'].includes(key))) {
    throw subscriptionError(400, 'Invalid function tool')
  }
}

function assertCustomTextTool(tool, pathname) {
  if (pathname !== '/v1/responses' || tool.type !== 'custom' ||
      !toolName(tool.name) ||
      (tool.description !== undefined &&
        (typeof tool.description !== 'string' || tool.description.length > 1024)) ||
      (tool.format !== undefined && !jsonSchema(tool.format)) ||
      Object.keys(tool).some((key) => !['type', 'name', 'description', 'format'].includes(key))) {
    throw subscriptionError(400, 'Invalid custom text tool')
  }
}

function assertToolChoice(body, pathname) {
  if (typeof body.tool_choice === 'string' &&
      !['auto', 'none', 'required'].includes(body.tool_choice)) {
    throw subscriptionError(400, 'This subscription service does not support hosted provider tools')
  }
  const choice = body.tool_choice
  if (!choice || typeof choice !== 'object') return
  const responses = pathname === '/v1/responses'
  const functionChoice = choice.type === 'function' &&
    (responses
      ? toolName(choice.name) && !('function' in choice)
      : choice.function && typeof choice.function === 'object' &&
        !Array.isArray(choice.function) && toolName(choice.function.name) && !('name' in choice))
  const customChoice = responses && choice.type === 'custom' && toolName(choice.name)
  if ((!functionChoice && !customChoice) ||
      Object.keys(choice).some((key) =>
        responses
          ? !['type', 'name'].includes(key) && !(choice.type === 'function' && key === 'function')
          : !['type', 'function'].includes(key))) {
    throw subscriptionError(400, 'This subscription service does not support hosted provider tools')
  }
}

export function assertOverlayTools(body, pathname) {
  if (!Array.isArray(body.tools)) return
  for (const tool of body.tools) {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
      throw subscriptionError(400, 'This subscription service does not support hosted provider tools')
    }
    if (tool.type === 'function') assertFunctionTool(tool, pathname)
    else assertCustomTextTool(tool, pathname)
  }
  assertToolChoice(body, pathname)
}

export function validAuthorizationUrl(providerId, value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && PROVIDERS[providerId].domains.includes(url.hostname.toLowerCase())
      ? url.toString()
      : null
  } catch {
    return null
  }
}

export async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw subscriptionError(413, 'Request body too large')
    chunks.push(chunk)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value
  } catch {
    throw subscriptionError(400, 'Invalid request body')
  }
}
