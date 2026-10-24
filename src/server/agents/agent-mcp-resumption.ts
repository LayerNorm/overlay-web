import 'server-only'

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod/v3'
import { createMcpApprovalBridge } from '../../../packages/overlay-agent-bridge-protocol/src/mcp-approval-bridge'
import { readBoundedStorageBody } from '@/server/storage/read-bounded-storage-body'
import { McpDeferredCall } from '@/server/mcp/mcp-deferred-call'
import { executeMcpTool, rpcError, rpcResult } from '@/server/mcp/mcp-jsonrpc'
import type { McpToolSource } from '@/server/mcp/mcp-jsonrpc'
import type { McpCallJournal, McpCallRecord, McpToolResult } from './McpCallJournal'
import type { adaptToolsForMcp } from './agent-mcp-tools'

const sessionHeader = 'Mcp-Session-Id'
const eventIdSchema = z.string().regex(/^[a-f0-9-]{36}:[012]$/)
const rpcId = z.union([z.string().min(1).max(200), z.number().finite()])
const messageSchema = z.object({ jsonrpc: z.literal('2.0'), id: rpcId.optional(), method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(), result: z.unknown().optional(), error: z.unknown().optional() })
export type DurableMcpToolHooks = Required<Pick<Parameters<typeof adaptToolsForMcp>[0], 'requestApproval' | 'beforeExecute'>>
type Journal = Pick<McpCallJournal, 'register' | 'read' | 'claim' | 'saveResult' | 'result' | 'acknowledgeElicitation'>

export type DurableMcpOptions = {
  token: string
  journal: Journal
  authorize: () => Promise<boolean>
  tools: (hooks: DurableMcpToolHooks) => ReturnType<McpToolSource>
  requestApproval: (call: McpCallRecord, tool: string, input: unknown) => Promise<{ allowed: true } | { allowed: false; message: string }>
  /** Initialization/listing use the shared MCP implementation. */
  ordinary: (request: Request) => Promise<Response>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  pollWindowMs?: number
}

function signature(token: string, nonce: string) {
  return createHmac('sha256', token).update(`overlay-mcp-session:v1:${nonce}`).digest()
}
function newSession(token: string) {
  const nonce = randomUUID()
  return `${nonce}.${signature(token, nonce).toString('base64url')}`
}
function validSession(token: string, value: string | null): value is string {
  if (!value || value.length > 100) return false
  const [nonce, encoded, extra] = value.split('.')
  if (extra !== undefined || !nonce || !encoded || !z.string().uuid().safeParse(nonce).success) return false
  const actual = Buffer.from(encoded, 'base64url')
  const expected = signature(token, nonce)
  return encoded === actual.toString('base64url') && actual.length === expected.length && timingSafeEqual(actual, expected)
}

function sse(events: Array<{ id: string; data: unknown }>, session: string) {
  // Empty priming data records a resumable cursor before any server request.
  const body = 'retry: 1000\n' + events.map(event => `id: ${event.id}\ndata: ${event.data === '' ? '' : JSON.stringify(event.data)}\n\n`).join('')
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store',
    [sessionHeader]: session, 'X-Accel-Buffering': 'no' } })
}

async function pendingResponse(options: DurableMcpOptions, call: McpCallRecord, session: string, reason: McpDeferredCall['reason'], sendForm: boolean) {
  const events: Array<{ id: string; data: unknown }> = [{ id: `${call.callId}:${sendForm ? 0 : 1}`, data: '' }]
  if (reason === 'approval' && sendForm) {
    const proof = await createMcpApprovalBridge(options.token, { callId: call.callId, requestKey: call.requestKey })
    events.push({ id: `${call.callId}:1`, data: { jsonrpc: '2.0', id: `overlay-approval:${call.callId}`, method: 'elicitation/create',
      params: { mode: 'form', message: 'Respond to this tool approval in the Overlay conversation.', requestedSchema: {
        type: 'object', properties: { confirm: { type: 'boolean', title: 'Approved in Overlay' },
          overlay_request: { type: 'string', enum: [proof] } }, required: ['confirm'],
      } } } })
  }
  return sse(events, session)
}

/** A reconnect rebuilds tools, checks the current fence, and reads the same durable call. */
async function advance(options: DurableMcpOptions, call: McpCallRecord): Promise<McpToolResult> {
  if (!(await options.authorize())) throw Error('This agent execution is no longer authorized.')
  if (call.state.kind === 'completed') return options.journal.result(call)
  if (call.state.kind === 'executing') {
    if (call.state.deadlineAt <= (options.now ?? Date.now)()) return { isError: true, content: [{ type: 'text',
      text: 'The tool did not report a result before its execution deadline. Its outcome is unknown; this call will not be run again. Check the workspace before requesting another action.' }] }
    throw new McpDeferredCall('executing')
  }
  const executionId = randomUUID()
  let claimed = false
  const beforeExecute = async (approvalRequired: boolean) => {
    if (!(await options.authorize())) throw Error('This agent execution is no longer authorized.')
    claimed = await options.journal.claim(call.callId, executionId, approvalRequired)
    if (!claimed) throw new McpDeferredCall('executing')
  }
  const { tools } = await options.tools({ beforeExecute,
    requestApproval: async (name, input) => {
      const outcome = await options.requestApproval(call, name, input)
      // Keep the native form unfinished until its actual client response arrives,
      // even when a human decision beats delivery of that form to the host.
      if (call.elicitationAnsweredAt === undefined) throw new McpDeferredCall('approval')
      return outcome
    } })
  const result = await executeMcpTool(tools, { name: call.toolName, arguments: JSON.parse(call.argumentsJson) }, {}, call.callId)
  // Invalid arguments, unknown tools and policy refusals have no side effect,
  // but still need one immutable result for this exact request identity.
  if (!claimed) await beforeExecute(false)
  await options.journal.saveResult(call.callId, executionId, result)
  return result
}

async function respond(options: DurableMcpOptions, initial: McpCallRecord, session: string, sendForm: boolean) {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const deadline = now() + (sendForm ? 0 : Math.min(options.pollWindowMs ?? 20_000, 20_000))
  let call = initial
  for (;;) {
    try {
      const result = await advance(options, call)
      return sse([{ id: `${call.callId}:2`, data: rpcResult(JSON.parse(call.rpcId), result) }], session)
    } catch (error) {
      if (!(error instanceof McpDeferredCall)) throw error
      if (now() >= deadline) return pendingResponse(options, call, session, error.reason, sendForm)
      await sleep(Math.min(2_000, Math.max(0, deadline - now())))
      call = await options.journal.read(call.callId)
    }
  }
}

async function resumeRequest(request: Request, options: DurableMcpOptions, session: string | null): Promise<Response> {
  if (!validSession(options.token, session)) return Response.json(rpcError(null, -32001, 'Invalid MCP session'), { status: 404 })
  const cursor = eventIdSchema.safeParse(request.headers.get('last-event-id'))
  if (!cursor.success) return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  const [callId, stage] = cursor.data.split(':')
  const call = await options.journal.read(callId)
  if (call.clientSessionId !== session) return Response.json(rpcError(null, -32001, 'MCP call belongs to another session'), { status: 404 })
  return await respond(options, call, session, stage === '0')
}

async function postRequest(request: Request, options: DurableMcpOptions, session: string | null): Promise<Response> {
  const bytes = request.body ? await readBoundedStorageBody(request.body, 300 * 1024) : new Uint8Array()
  const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  const parsed = messageSchema.safeParse(raw)
  if (!parsed.success) return Response.json(rpcError(null, -32600, 'Invalid MCP request'), { status: 400 })
  const message = parsed.data
  if (message.method === 'initialize') {
    const form = z.object({ capabilities: z.object({ elicitation: z.object({ form: z.object({}) }) }) }).safeParse(message.params)
    if (!form.success) return Response.json(rpcError(message.id ?? null, -32602, 'This agent runtime must support MCP form elicitation'), { status: 400 })
    const response = await options.ordinary(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(raw) }))
    response.headers.set(sessionHeader, newSession(options.token))
    return response
  }
  if (!validSession(options.token, session)) return Response.json(rpcError(message.id ?? null, -32001, 'Invalid MCP session'), { status: 404 })
  if (!message.method) {
    // Client form answers acknowledge delivery. Only the human's persisted
    // Overlay decision can authorize a tool, never this client-supplied body.
    const prefix = 'overlay-approval:'
    if (typeof message.id !== 'string' || !message.id.startsWith(prefix)) return Response.json(rpcError(message.id ?? null, -32600, 'Unknown server request'), { status: 400 })
    const call = await options.journal.read(message.id.slice(prefix.length))
    if (call.clientSessionId !== session) return new Response(null, { status: 404 })
    await options.journal.acknowledgeElicitation(call.callId)
    return new Response(null, { status: 202 })
  }
  if (message.method !== 'tools/call') return options.ordinary(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(raw) }))
  if (message.id === undefined || typeof message.params?.name !== 'string') return Response.json(rpcError(message.id ?? null, -32600, 'Tool calls require an id and name'), { status: 400 })
  const call = await options.journal.register(session, message.id, message.params.name, message.params.arguments ?? {})
  return await respond(options, call, session, true)
}

/** Opt-in transport for a host that can bridge form elicitation to Overlay's one card. */
export async function serveDurableAgentMcp(request: Request, options: DurableMcpOptions): Promise<Response> {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) return Response.json(rpcError(null, -32001, 'Invalid Origin'), { status: 403 })
  try {
    const session = request.headers.get(sessionHeader)
    if (request.method === 'GET') return await resumeRequest(request, options, session)
    if (request.method === 'POST') return await postRequest(request, options, session)
    return new Response(null, { status: 405, headers: { Allow: 'POST, GET' } })
  } catch (error) {
    // Failed journal operations never release an execution claim or replay a write.
    void error
    return Response.json(rpcError(null, -32000, 'The MCP call could not be resumed. Check this run in Overlay.'), { status: 409 })
  }
}
