import 'server-only'

import { randomUUID } from 'node:crypto'
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider'
import {
  decodeRelayJson,
  encodeRelayJson,
  MAX_PRIVATE_MODEL_RELAY_REQUEST_BYTES,
  PRIVATE_MODEL_RELAY_VERSION,
  type PrivateModelRelayRequest,
} from '@layernorm/overlay-agent-bridge-protocol'
import { openMcpValue, PRIVATE_MODEL_TOKEN_TTL_MS, sealMcpValue } from '@/server/mcp/mcp-tokens'

/**
 * Overlay-billed models in private threads (internal/develop/private-threads.md). The agent loop runs on the person's
 * computer; the Agent Host sends each model call here with a short-lived token Overlay Desktop asked for with its own
 * session. The call runs with Overlay's model provider exactly like a cloud agent's, is checked against the workspace
 * budget before it starts (under 2% left refuses it; nothing is estimated or held) and charged to the workspace from
 * the reported usage after it ends. Nothing about the call is stored or logged: no prompt, no reply, no thread.
 */

export type PrivateModelClaims = { userId: string; workspaceId: string; agentId: string }

export function issuePrivateModelToken(claims: PrivateModelClaims): { token: string; expiresAt: number } | null {
  const token = sealMcpValue('private_model', { uid: claims.userId, ws: claims.workspaceId, ag: claims.agentId }, PRIVATE_MODEL_TOKEN_TTL_MS)
  return token ? { token, expiresAt: Date.now() + PRIVATE_MODEL_TOKEN_TTL_MS } : null
}

export function openPrivateModelToken(bearer: string | null): PrivateModelClaims | null {
  const payload = openMcpValue('private_model', bearer)
  const { uid, ws, ag } = payload ?? {}
  return typeof uid === 'string' && typeof ws === 'string' && typeof ag === 'string'
    ? { userId: uid, workspaceId: ws, agentId: ag }
    : null
}

export type PrivateModelUsage = { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number }

export type PrivateModelRelayDependencies = {
  /** The person may have left the workspace since the desktop asked for the token. */
  isMember(userId: string, workspaceId: string): Promise<boolean>
  /** A known Overlay chat model, as cloud agents use it; null for anything else. */
  resolveModel(modelId: string): Promise<LanguageModelV4 | null>
  /** The same check as every paid call: a paid workspace with at least 2% of its budget left. */
  admit(claims: PrivateModelClaims, modelId: string): Promise<{ ok: true } | { ok: false; status: number; message: string; code: string }>
  /** Charges the call's reported usage to the workspace, under the agent like its cloud turns. */
  charge(claims: PrivateModelClaims, modelId: string, usage: PrivateModelUsage, providerCostUsd: number | null): Promise<void>
  /** Failures only, without content. */
  log?(message: string, details: Record<string, unknown>): void
}

const NO_STORE = { 'Cache-Control': 'no-store' }

function refusal(status: number, message: string, code: string): Response {
  return Response.json({ error: message, code }, { status, headers: NO_STORE })
}

function bearerFrom(request: Request): string | null {
  const header = request.headers.get('authorization')?.trim() ?? ''
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() || null : null
}

function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0
}

export function relayUsage(usage: LanguageModelV4Usage | undefined): PrivateModelUsage | null {
  if (!usage) return null
  const cacheReadTokens = count(usage.inputTokens.cacheRead)
  const cacheWriteTokens = count(usage.inputTokens.cacheWrite)
  const inputTokens = Math.max(count(usage.inputTokens.total), count(usage.inputTokens.noCache) + cacheReadTokens + cacheWriteTokens)
  const outputTokens = count(usage.outputTokens.total)
  return inputTokens + outputTokens > 0 ? { inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens } : null
}

/** Overlay's model provider reports its own cost for a call; used when the catalog has no rate for the model. */
function reportedCostUsd(providerMetadata: unknown): number | null {
  const gateway = (providerMetadata as { gateway?: { cost?: unknown } } | undefined)?.gateway
  const cost = typeof gateway?.cost === 'string' ? Number(gateway.cost) : typeof gateway?.cost === 'number' ? gateway.cost : NaN
  return Number.isFinite(cost) && cost >= 0 ? cost : null
}

function parseRequest(text: string): PrivateModelRelayRequest | null {
  try {
    const value = decodeRelayJson<Partial<PrivateModelRelayRequest>>(text)
    if (value?.version !== PRIVATE_MODEL_RELAY_VERSION) return null
    if (value.mode !== 'stream' && value.mode !== 'generate') return null
    if (typeof value.modelId !== 'string' || !value.modelId.trim() || value.modelId.length > 200) return null
    const options = value.options as Record<string, unknown> | undefined
    if (!options || typeof options !== 'object' || !Array.isArray(options.prompt)) return null
    return value as PrivateModelRelayRequest
  } catch (_error) {
    return null
  }
}

export async function handlePrivateModelRelay(request: Request, dependencies: PrivateModelRelayDependencies): Promise<Response> {
  const claims = openPrivateModelToken(bearerFrom(request))
  if (!claims) return refusal(401, 'This private thread’s access to Overlay’s models expired. Send the message again.', 'unauthorized')

  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_PRIVATE_MODEL_RELAY_REQUEST_BYTES) return refusal(413, 'This conversation is too large for one model call.', 'too_large')
  const text = await request.text()
  if (text.length > MAX_PRIVATE_MODEL_RELAY_REQUEST_BYTES) return refusal(413, 'This conversation is too large for one model call.', 'too_large')
  const body = parseRequest(text)
  if (!body) return refusal(400, 'The model call was not valid.', 'invalid_request')

  if (!await dependencies.isMember(claims.userId, claims.workspaceId).catch((_error) => false)) {
    return refusal(403, 'You no longer have access to this workspace.', 'forbidden')
  }
  const model = await dependencies.resolveModel(body.modelId).catch((_error) => null)
  if (!model) return refusal(404, 'This model isn’t available from Overlay.', 'model_not_found')
  const admission = await dependencies.admit(claims, body.modelId)
  if (!admission.ok) return refusal(admission.status, admission.message, admission.code)

  const options = { ...body.options, abortSignal: request.signal } as unknown as LanguageModelV4CallOptions
  const settle = async (usage: LanguageModelV4Usage | undefined, providerMetadata: unknown) => {
    const measured = relayUsage(usage)
    // A call that reported no usage charges nothing, like any harness call.
    if (!measured) return
    await dependencies.charge(claims, body.modelId, measured, reportedCostUsd(providerMetadata)).catch((error: unknown) => {
      dependencies.log?.('[private-thread-model] usage charge failed', { error: error instanceof Error ? error.name : 'unknown' })
    })
  }

  try {
    if (body.mode === 'generate') {
      const result = await model.doGenerate(options)
      await settle(result.usage, result.providerMetadata)
      // The provider's raw request and response bodies are not sent back: the computer already has the conversation.
      const { request: _request, response, ...rest } = result
      void _request
      const generated = { ...rest, ...(response ? { response: { id: response.id, modelId: response.modelId, timestamp: response.timestamp } } : {}) }
      return new Response(encodeRelayJson(generated), { headers: { ...NO_STORE, 'Content-Type': 'application/json' } })
    }

    const { stream } = await model.doStream(options)
    let finish: Extract<LanguageModelV4StreamPart, { type: 'finish' }> | undefined
    let settled = false
    const settleOnce = async () => {
      if (settled) return
      settled = true
      await settle(finish?.usage, finish?.providerMetadata)
    }
    const encoder = new TextEncoder()
    const lines = stream.pipeThrough(new TransformStream<LanguageModelV4StreamPart, Uint8Array>({
      transform(part, controller) {
        if (part.type === 'raw') return
        if (part.type === 'finish') finish = part
        const wire = part.type === 'error' ? { type: 'error', error: { message: publicMessage(part.error) } } : part
        controller.enqueue(encoder.encode(`${encodeRelayJson(wire)}\n`))
      },
      async flush() {
        await settleOnce()
      },
    }))
    // Stop on the computer cancels the call; whatever it used before that is still charged.
    const reader = lines.getReader()
    const reply = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read()
        if (done) controller.close()
        else controller.enqueue(value)
      },
      async cancel(reason) {
        await reader.cancel(reason).catch((_error) => undefined)
        await settleOnce()
      },
    })
    return new Response(reply, { headers: { ...NO_STORE, 'Content-Type': 'application/x-ndjson' } })
  } catch (error) {
    dependencies.log?.('[private-thread-model] model call failed', { error: error instanceof Error ? error.name : 'unknown' })
    return refusal(502, publicMessage(error), 'model_error')
  }
}

/** Provider errors can echo request details; keep a short message only. */
function publicMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'The model call failed.'
  return message.replace(/(sk|key|pk|AIza|vck)[-_A-Za-z0-9]{12,}/g, '[redacted]').slice(0, 500) || 'The model call failed.'
}

/** One charge per model call. */
export function newPrivateModelOperationId(): string {
  return `private-thread-model:${randomUUID()}`
}
