import {createServer} from 'node:http'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {z} from 'zod'
import type {AgentAdapter} from './adapter.js'

const mcpSchema = z.object({url: z.string().url(), token: z.string().regex(/^ovmcp_[A-Za-z0-9_.-]+$/)}).passthrough()
const requestHeaders = ['authorization', 'accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id']
const responseHeaders = ['content-type', 'cache-control', 'mcp-session-id', 'mcp-protocol-version', 'retry-after']

/** Keep hosting access in the host; providers receive only a loopback URL and their original run token. */
export async function createPreviewMcpRelay(origin: string, fetchImpl: typeof globalThis.fetch) {
  const target = new URL('/api/agent-mcp', origin)
  if (target.protocol !== 'https:') throw Error('Preview MCP relay requires HTTPS')
  const tokens = new Map<string, string>()
  const server = createServer({maxHeaderSize: 16_384}, async (request, response) => {
    if (request.url !== '/api/agent-mcp' || !['GET', 'POST', 'DELETE'].includes(request.method ?? '')) {
      response.writeHead(404); response.end(); return
    }
    const authorization = request.headers.authorization
    if (!authorization || ![...tokens.values()].some(token => authorization === `Bearer ${token}`)) {
      response.writeHead(401); response.end(); return
    }
    const controller = new AbortController()
    response.once('close', () => controller.abort())
    request.once('aborted', () => controller.abort())
    try {
      const chunks: Uint8Array[] = []
      let length = 0
      for await (const chunk of request) {
        length += chunk.length
        if (length > 2 * 1024 * 1024) {response.writeHead(413); response.end(); return}
        chunks.push(chunk)
      }
      const headers = new Headers()
      for (const name of requestHeaders) {
        const value = request.headers[name]
        if (typeof value === 'string') headers.set(name, value)
      }
      const upstream = await fetchImpl(target, {method: request.method, headers, redirect: 'error', signal: controller.signal,
        ...(request.method === 'POST' ? {body: new Uint8Array(Buffer.concat(chunks)).buffer} : {})})
      const outgoing: Record<string, string> = {}
      for (const name of responseHeaders) {const value = upstream.headers.get(name); if (value !== null) outgoing[name] = value}
      response.writeHead(upstream.status, outgoing)
      if (upstream.body) await pipeline(Readable.from(responseChunks(upstream)), response)
      else response.end()
    } catch {
      if (!response.headersSent) response.writeHead(502)
      if (!response.destroyed) response.end()
    }
  })
  server.requestTimeout = 0
  server.maxConnections = 64
  await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve)})
  server.unref()
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('Preview MCP relay did not bind a loopback port')
  const url = `http://127.0.0.1:${address.port}/api/agent-mcp`
  const prepare = (runId: string, metadata: Record<string, unknown>) => {
    const parsed = mcpSchema.safeParse(metadata.overlayMcp)
    if (!parsed.success || parsed.data.url !== target.toString()) return metadata
    tokens.set(runId, parsed.data.token)
    return {...metadata, overlayMcp: {...parsed.data, url}}
  }
  const wrapAdapter = (adapter: AgentAdapter): AgentAdapter => ({
    get capability() {return adapter.capability},
    discover: input => adapter.discover(input),
    async start(input, emit) {
      const metadata = prepare(input.runId, input.metadata)
      const ownedToken = metadata === input.metadata ? undefined : tokens.get(input.runId)
      const release = () => {if (ownedToken && tokens.get(input.runId) === ownedToken) tokens.delete(input.runId)}
      try {
        return await adapter.start({...input, metadata}, async event => {
          await emit(event)
          if (['completed', 'failed', 'cancelled'].includes(event.type)) release()
        })
      } catch (error) {release(); throw error}
    },
  })
  return {url, wrapAdapter, close: () => new Promise<void>((resolve, reject) => {
    tokens.clear()
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  })}
}

async function* responseChunks(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) return
  try {
    for (;;) {const next = await reader.read(); if (next.done) return; yield next.value}
  } finally {await reader.cancel().catch(() => undefined); reader.releaseLock()}
}
