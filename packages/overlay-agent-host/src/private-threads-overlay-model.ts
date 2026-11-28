import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider'
import {
  decodeRelayJson,
  encodeRelayJson,
  PRIVATE_MODEL_RELAY_VERSION,
  type PrivateModelRelayRequest,
} from '@layernorm/overlay-agent-bridge-protocol'

/**
 * An Overlay-billed model in a private thread (internal/develop/private-threads.md). The loop stays on this computer;
 * each call is sent to Overlay's metered relay with a short-lived token Overlay Desktop got for this person, workspace
 * and agent. Overlay runs the call, charges the workspace, and keeps nothing of it.
 */
export type OverlayRelayAccess = { url: string; token: string }

export class OverlayRelayError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
    this.name = 'OverlayRelayError'
  }
}

export function createOverlayRelayModel(
  modelId: string,
  access: OverlayRelayAccess,
  fetchImpl: typeof fetch = fetch,
): LanguageModelV4 {
  const call = async (mode: PrivateModelRelayRequest['mode'], options: LanguageModelV4CallOptions): Promise<Response> => {
    const { abortSignal, headers: _headers, ...rest } = options
    void _headers
    const request: PrivateModelRelayRequest = { version: PRIVATE_MODEL_RELAY_VERSION, modelId, mode, options: rest as Record<string, unknown> }
    const response = await fetchImpl(access.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${access.token}`, 'content-type': 'application/json' },
      body: encodeRelayJson(request),
      // The token goes only to the server the desktop named.
      redirect: 'error',
      ...(abortSignal ? { signal: abortSignal } : {}),
    })
    if (!response.ok) throw await relayError(response)
    return response
  }
  return {
    specificationVersion: 'v4',
    provider: 'overlay',
    modelId,
    // Overlay's server fetches nothing on the computer's behalf: the AI SDK downloads URLs here first.
    supportedUrls: {},
    async doGenerate(options) {
      const response = await call('generate', options)
      return decodeRelayJson<LanguageModelV4GenerateResult>(await response.text())
    },
    async doStream(options) {
      const response = await call('stream', options)
      if (!response.body) throw new OverlayRelayError('Overlay sent no reply.', 502)
      return { stream: response.body.pipeThrough(new TextDecoderStream()).pipeThrough(ndjsonParts()) }
    },
  }
}

async function relayError(response: Response): Promise<OverlayRelayError> {
  let message = `Overlay's models answered ${response.status}.`
  let code: string | undefined
  try {
    const body = await response.json() as { error?: unknown; code?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) message = body.error.trim().slice(0, 500)
    if (typeof body.code === 'string') code = body.code
  } catch {
    /* Not JSON; keep the status. */
  }
  return new OverlayRelayError(message, response.status, code)
}

/** One JSON stream part per line; a line the relay could not finish becomes an error part. */
function ndjsonParts(): TransformStream<string, LanguageModelV4StreamPart> {
  let buffer = ''
  const emit = (line: string, controller: TransformStreamDefaultController<LanguageModelV4StreamPart>) => {
    if (!line.trim()) return
    try {
      controller.enqueue(decodeRelayJson<LanguageModelV4StreamPart>(line))
    } catch {
      controller.enqueue({ type: 'error', error: new OverlayRelayError('Overlay sent a reply that could not be read.', 502) })
    }
  }
  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        emit(buffer.slice(0, newline), controller)
        buffer = buffer.slice(newline + 1)
      }
    },
    flush(controller) {
      emit(buffer, controller)
    },
  })
}
