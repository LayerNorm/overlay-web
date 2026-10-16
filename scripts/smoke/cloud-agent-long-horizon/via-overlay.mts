/**
 * `harness.mts --via overlay`: the same long-horizon task, but through the real Overlay product path on a PR preview
 * (or a local dev server): Overlay provisions a cloud agent machine, the Agent Host on it runs Claude Code, and this
 * script only uses the public app API, exactly as the web app does. It measures what a person would see:
 *
 *   - visible progress: how the assistant message's text and tool rows grew over time, and any visible stall
 *     (the run is active but nothing on screen changed for 90 s);
 *   - transport counters from the server (`streamSummary` on GET /api/v1/conversations/run): batches, events, bytes,
 *     text snapshot amplification, message rewrites, refused batches, host lag, quiet gaps, longest tool;
 *   - with --cancel-after-s N, whether text written before a Stop survives it.
 *
 * Usage (from overlay-landing/):
 *   npx tsx scripts/smoke/cloud-agent-long-horizon/harness.mts --via overlay --preview-url https://pr-<n>.preview.getoverlay.io
 *     [--model haiku] [--size small] [--agent-id <id>] [--keep-agent] [--prompt-file path]
 *     [--cancel-after-s <seconds>] [--hard-limit-min 45]
 * Env:
 *   PREVIEW_LOGIN_SECRET            signs in as the preview's seeded QA user (POST /api/auth/preview-login)
 *   OVERLAY_SESSION_COOKIE          alternative: an existing `overlay_session` value (e.g. local dev)
 *   CLAUDE_SETUP_TOKEN              connects the Claude subscription when the QA user has none yet
 *   VERCEL_AUTOMATION_BYPASS_SECRET optional; sent only to the exact preview origin
 * The report goes to artifacts/smoke/cloud-agent-long-horizon/overlay-<run>/ (gitignored) and contains no secrets.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mcpToolGrantFor } from '../../../src/shared/mcp/access'

const here = dirname(fileURLToPath(import.meta.url))
const VISIBLE_STALL_MS = 90_000
const POLL_MS = 2_000

type Json = Record<string, unknown>
export type Message = { id: string; role: string; status?: string; content?: string; parts?: Json[]; authorPrincipalId?: string; createdAt: number; updatedAt: number }

function option(args: string[], name: string, fallback?: string) {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}

const log = (...parts: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...parts)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class OverlayClient {
  private readonly cookies = new Map<string, string>()
  constructor(readonly origin: string, private readonly bypass?: string) {}

  setCookie(name: string, value: string) { this.cookies.set(name, value) }

  async request<T = Json>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; body: T }> {
    const url = new URL(path, this.origin)
    if (url.origin !== this.origin) throw new Error('refusing to send credentials to another origin')
    const headers: Record<string, string> = { accept: 'application/json', ...extra }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
    if (this.bypass) headers['x-vercel-protection-bypass'] = this.bypass
    const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' })
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(';')
      const at = pair!.indexOf('=')
      if (at > 0) this.cookies.set(pair!.slice(0, at).trim(), pair!.slice(at + 1).trim())
    }
    const text = await response.text()
    let parsed: unknown = text
    try { parsed = text ? JSON.parse(text) : {} } catch { /* keep text */ }
    return { status: response.status, body: parsed as T }
  }

  async ok<T = Json>(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<T> {
    let result = await this.request<T>(method, path, body, extra)
    if (result.status === 401 && !path.startsWith('/api/auth/')) {
      // Match the browser: refresh the signed session before retrying an unauthenticated request once.
      const refreshed = await this.request('GET', '/api/auth/session')
      if (refreshed.status === 200) result = await this.request<T>(method, path, body, extra)
    }
    if (result.status < 200 || result.status >= 300) {
      const detail = typeof result.body === 'object' ? JSON.stringify(result.body).slice(0, 400) : String(result.body).slice(0, 200)
      throw new Error(`${method} ${path} → ${result.status} ${detail}`)
    }
    return result.body
  }
}

async function signIn(client: OverlayClient) {
  const sessionCookie = process.env.OVERLAY_SESSION_COOKIE?.trim()
  if (sessionCookie) {
    client.setCookie('overlay_session', sessionCookie)
  } else {
    const secret = process.env.PREVIEW_LOGIN_SECRET?.trim()
    if (!secret) throw new Error('set PREVIEW_LOGIN_SECRET (preview) or OVERLAY_SESSION_COOKIE (local)')
    await client.ok('POST', '/api/auth/preview-login', undefined, { 'x-overlay-preview-secret': secret })
  }
  const token = await client.request('GET', '/api/auth/convex-token')
  if (token.status !== 200) throw new Error(`sign-in did not produce a usable session (${token.status})`)
}

async function claudeAccount(client: OverlayClient): Promise<string> {
  const listed = await client.ok<{ data: Array<{ id: string; provider: string; method: string; status: string }> }>('GET', '/api/v1/provider-accounts')
  const usable = listed.data.find((account) => account.provider === 'claude-code' && account.method === 'subscription' && account.status === 'active')
  if (usable) return usable.id
  const secret = process.env.CLAUDE_SETUP_TOKEN?.trim()
  if (!secret) throw new Error('no active Claude subscription account and CLAUDE_SETUP_TOKEN is not set')
  const created = await client.ok<{ account: { id: string; status: string } }>('POST', '/api/v1/provider-accounts', {
    provider: 'claude-code', method: 'subscription', secret, label: 'Smoke (long horizon)',
  })
  if (created.account.status !== 'active') throw new Error(`Claude account is ${created.account.status}`)
  return created.account.id
}

async function cloudAgent(client: OverlayClient, args: { model: string; size: string; providerAccountId: string; runLabel: string; agentId?: string }) {
  if (args.agentId) {
    const existing = await client.ok<{ agent: { id: string; principalId: string } }>('GET', `/api/v1/agents/${encodeURIComponent(args.agentId)}`)
    return { agent: existing.agent, created: false }
  }
  const { agent } = await client.ok<{ agent: { id: string; principalId: string } }>('POST', '/api/v1/agents', {
    name: `Smoke ${args.runLabel}`.slice(0, 60),
    instructions: 'Run delegated work through Claude Code in the connected environment.',
    harness: 'claude-code', modelId: `byo/claude-code#${args.model}`,
    allowedToolIds: mcpToolGrantFor('full'), visibility: 'creator', teamIds: [],
  })
  await client.ok('POST', '/api/v1/agent-environments/cloud', {
    agentId: agent.id, adapterId: 'claude-code', providerAccountId: args.providerAccountId, size: args.size,
  })
  const deadline = Date.now() + 10 * 60_000
  for (;;) {
    const machine = await client.ok<{ state?: string; provision?: { phase?: string; error?: unknown } }>('GET', `/api/v1/agents/${agent.id}/machine`)
    if (machine.state === 'ready') break
    if (machine.provision?.error) throw new Error(`machine provisioning failed: ${JSON.stringify(machine.provision.error).slice(0, 300)}`)
    if (Date.now() > deadline) throw new Error(`machine not ready after 10 min (state ${machine.state}, phase ${machine.provision?.phase})`)
    await sleep(5_000)
  }
  return { agent, created: true }
}

export function messageText(message: Message | undefined): string {
  if (typeof message?.content === 'string') return message.content
  return (message?.parts ?? []).flatMap(part => part.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('')
}

export function visibleShape(message: Message | undefined) {
  const parts = message?.parts ?? []
  const text = messageText(message).length
  const tools = parts.filter((part) => part.type === 'tool-invocation').length
  const status = parts.find((part) => part.type === 'data-remote-agent-status')?.data as Json | undefined
  return { text, tools, state: typeof status?.state === 'string' ? status.state : message?.status ?? 'none', signature: `${text}:${tools}:${message?.updatedAt ?? 0}` }
}

export async function runViaOverlay(argv: string[]): Promise<number> {
  const previewUrl = option(argv, 'preview-url')
  if (!previewUrl) throw new Error('--preview-url is required with --via overlay')
  const origin = new URL(previewUrl).origin
  if (!/^https:\/\/pr-[1-9]\d*\.preview\.getoverlay\.io$/.test(origin) && !/^http:\/\/localhost:\d+$/.test(origin)) {
    throw new Error('--preview-url must be a canonical PR preview origin or http://localhost:<port>')
  }
  const model = option(argv, 'model', 'haiku')!
  const size = option(argv, 'size', 'small')!
  const cancelAfterS = option(argv, 'cancel-after-s') ? Number(option(argv, 'cancel-after-s')) : undefined
  const hardLimitMs = Number(option(argv, 'hard-limit-min', '45')) * 60_000
  const prompt = readFileSync(option(argv, 'prompt-file', join(here, 'PROMPT.overlay.md'))!, 'utf8').trim()
  const runLabel = new Date().toISOString().replace(/[:.]/g, '-')
  const out = join(here, '../../../artifacts/smoke/cloud-agent-long-horizon', `overlay-${runLabel}`)
  mkdirSync(out, { recursive: true })

  const bypass = origin.startsWith('https://') ? process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || undefined : undefined
  const client = new OverlayClient(origin, bypass)
  const startedAt = Date.now()
  await signIn(client)
  log('signed in to', origin)
  const providerAccountId = await claudeAccount(client)
  log('Claude subscription account ready')
  const { agent, created } = await cloudAgent(client, { model, size, providerAccountId, runLabel, agentId: option(argv, 'agent-id') })
  log(created ? 'cloud agent created and machine ready' : 'reusing cloud agent', agent.id)
  const machineReadyAt = Date.now()

  const { directMessage } = await client.ok<{ directMessage: { conversationId: string } }>('POST', '/api/v1/conversations/direct-messages', {
    principalIds: [agent.principalId], title: `Smoke ${runLabel}`,
  })
  const conversationId = directMessage.conversationId
  const sentAt = Date.now()
  await client.ok('POST', '/api/v1/conversations/message', { conversationId, turnId: randomUUID(), role: 'user', content: prompt, clientNonce: randomUUID() })
  log('task sent in conversation', conversationId)

  const timeline: Array<{ t: number; text: number; tools: number; state: string; quietMs?: number }> = []
  const visibleStalls: Array<{ fromS: number; toS?: number; state: string }> = []
  let lastSignature = ''
  let lastChangeAt = Date.now()
  let stallOpen: (typeof visibleStalls)[number] | undefined
  let runSnapshot: Json | undefined
  let streamSummary: Json | undefined
  let reply: Message | undefined
  let textBeforeCancel = ''
  let cancelled: { atS: number; textBefore: number; textAfter?: number } | undefined
  let pollFailures = 0

  for (;;) {
    if (Date.now() - sentAt > hardLimitMs) { log('hard limit reached'); break }
    await sleep(POLL_MS)
    let run: { run?: Json | null; streamSummary?: Json }
    let messages: { messages: Message[] }
    try {
      run = await client.ok('GET', `/api/v1/conversations/run?conversationId=${conversationId}`)
      messages = await client.ok('GET', `/api/v1/conversations?conversationId=${conversationId}&messages=true&limit=50`)
      pollFailures = 0
    } catch (error) {
      pollFailures += 1
      log('poll failed', String(error).slice(0, 200))
      if (pollFailures > 10) throw error
      continue
    }
    runSnapshot = run.run ?? undefined
    streamSummary = run.streamSummary ?? streamSummary
    reply = messages.messages.filter((message) => message.role === 'assistant' && message.authorPrincipalId === agent.principalId)
      .sort((left, right) => right.createdAt - left.createdAt)[0]
    const shape = visibleShape(reply)
    const now = Date.now()
    timeline.push({ t: Math.round((now - sentAt) / 1000), text: shape.text, tools: shape.tools, state: shape.state,
      quietMs: typeof streamSummary?.currentQuietMs === 'number' ? streamSummary.currentQuietMs : undefined })
    const runStatus = String(runSnapshot?.status ?? 'unknown')
    const active = !['completed', 'failed', 'cancelled'].includes(runStatus)
    if (shape.signature !== lastSignature) {
      if (stallOpen) { stallOpen.toS = Math.round((now - sentAt) / 1000); stallOpen = undefined }
      lastSignature = shape.signature
      lastChangeAt = now
      log(`visible: ${shape.text} chars, ${shape.tools} tool rows, ${shape.state}`)
    } else if (active && !stallOpen && now - lastChangeAt >= VISIBLE_STALL_MS) {
      stallOpen = { fromS: Math.round((lastChangeAt - sentAt) / 1000), state: shape.state }
      visibleStalls.push(stallOpen)
      log(`VISIBLE STALL: nothing changed for ${Math.round((now - lastChangeAt) / 1000)}s (server quiet ${streamSummary?.currentQuietMs}ms)`)
    }
    if (cancelAfterS !== undefined && !cancelled && active && now - sentAt >= cancelAfterS * 1000) {
      const runId = (reply?.parts?.find((part) => part.type === 'data-remote-agent-status')?.data as Json | undefined)?.runId
      if (typeof runId === 'string') {
        textBeforeCancel = messageText(reply)
        cancelled = { atS: Math.round((now - sentAt) / 1000), textBefore: shape.text }
        log(`cancelling at ${cancelled.atS}s with ${shape.text} visible chars`)
        await client.ok('POST', '/api/v1/conversations/run/remote', { action: 'cancel', conversationId, runId })
      }
    }
    if (!active && runSnapshot) {
      if (cancelled) cancelled.textAfter = shape.text
      break
    }
  }

  const finished = Date.now()
  const finalShape = visibleShape(reply)
  const textChars = finalShape.text
  const amplification = typeof streamSummary?.textCheckpointChars === 'number' && textChars > 0
    ? Math.round((streamSummary.textCheckpointChars / textChars) * 10) / 10 : null
  const report = {
    via: 'overlay',
    origin,
    run: {
      status: runSnapshot?.status ?? 'unknown',
      terminalCode: (runSnapshot?.terminalError as Json | undefined)?.code ?? null,
      messageStatus: reply?.status ?? null,
    },
    model: `byo/claude-code#${model}`,
    seconds: {
      total: Math.round((finished - startedAt) / 1000),
      machineReady: Math.round((machineReadyAt - startedAt) / 1000),
      run: Math.round((finished - sentAt) / 1000),
    },
    visible: { finalTextChars: textChars, toolRows: finalShape.tools, stalls: visibleStalls },
    transport: { ...streamSummary, snapshotAmplification: amplification },
    cancel: cancelled ? { ...cancelled, textPreserved: textBeforeCancel.length > 0 && messageText(reply).startsWith(textBeforeCancel) } : null,
    timeline,
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  writeFileSync(join(out, 'reply.md'), messageText(reply))
  log('report →', join(out, 'report.json'))
  console.log(JSON.stringify({ ...report, timeline: `${timeline.length} samples` }, null, 2))

  if (created && !argv.includes('--keep-agent')) {
    await client.request('DELETE', `/api/v1/agents/${agent.id}/machine`).catch(() => undefined)
    await client.request('DELETE', `/api/v1/agents/${agent.id}`).catch(() => undefined)
    log('deleted the smoke agent and its machine')
  }
  const passed = cancelled
    ? report.run.status === 'cancelled' && report.cancel?.textPreserved === true
    : report.run.status === 'completed' && visibleStalls.length === 0
  return passed ? 0 : 1
}
