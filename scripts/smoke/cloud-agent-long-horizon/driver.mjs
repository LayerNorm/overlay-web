#!/usr/bin/env node
// In-box ACP driver for the cloud-agent long-horizon smoke.
//
// Runs next to the agent on the machine and speaks ACP (newline-delimited JSON-RPC over stdio) to
// `claude-agent-acp`. It demonstrates the transport contract we want the Agent Host to follow:
//   - an append-only, sequenced event log on local disk (the durable outbox), read by cursor;
//   - text as coalesced DELTAS, never the cumulative message (no O(n^2) payloads, no batch overflow);
//   - the session's mode (permissions) and model chosen explicitly from what the agent advertises;
//   - heartbeats while work is outstanding, and a stall signal naming the tool that is not finishing;
//   - permission requests answered by a stated policy instead of waiting forever.
//
// Usage: node driver.mjs <config.json>
// config: { adapterBin, cwd, runDir, model, mode, prompt, permissionPolicy: 'allow' | 'deny', stallMs }

import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'))
mkdirSync(config.runDir, { recursive: true })
const eventsPath = join(config.runDir, 'events.ndjson')
const controlPath = join(config.runDir, 'control.json')
const stallMs = config.stallMs ?? 90_000

let seq = 0
function event(type, data = {}) {
  appendFileSync(eventsPath, `${JSON.stringify({ seq: ++seq, t: Date.now(), type, ...data })}\n`)
}

// ---- text coalescing: deltas, flushed on a short timer or size threshold ----
let pendingText = ''
let textTimer
function pushText(chunk) {
  pendingText += chunk
  if (pendingText.length >= 2_048) flushText()
  else textTimer ??= setTimeout(flushText, 300)
}
function flushText() {
  clearTimeout(textTimer)
  textTimer = undefined
  if (!pendingText) return
  event('text', { delta: pendingText })
  pendingText = ''
}

// ---- ACP over stdio ----
const child = spawn(config.adapterBin, [], {
  cwd: config.cwd,
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
})
child.stderr.on('data', (chunk) => appendFileSync(join(config.runDir, 'adapter-stderr.log'), chunk))
child.on('exit', (code, signal) => { flushText(); event('adapter_exit', { code, signal }) })

let nextId = 1
const waiting = new Map()
let buffer = ''
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  let newline
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line) onMessage(JSON.parse(line))
  }
})
function send(message) { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`) }
function request(method, params) {
  const id = nextId++
  send({ id, method, params })
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject, method }))
}

// ---- liveness bookkeeping ----
let lastUpdateAt = Date.now()
const openTools = new Map() // toolCallId -> { title, kind, startedAt }
let stallReported = false

function onMessage(message) {
  if (message.id !== undefined && !message.method) {
    const pending = waiting.get(message.id)
    if (!pending) return
    waiting.delete(message.id)
    if (message.error) pending.reject(Object.assign(new Error(`${pending.method}: ${message.error.message}`), { data: message.error }))
    else pending.resolve(message.result)
    return
  }
  lastUpdateAt = Date.now()
  stallReported = false
  if (message.method === 'session/update') return onUpdate(message.params.update)
  if (message.method === 'session/request_permission') return onPermission(message)
  // We advertise no client fs/terminal capabilities, so the agent uses its own tools.
  if (message.id !== undefined) send({ id: message.id, error: { code: -32601, message: `unsupported: ${message.method}` } })
}

function onUpdate(update) {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      if (update.content?.type === 'text') pushText(update.content.text)
      return
    case 'agent_thought_chunk':
      return // private reasoning stays private
    case 'tool_call': {
      flushText()
      openTools.set(update.toolCallId, { title: update.title, kind: update.kind, startedAt: Date.now() })
      event('tool', { id: update.toolCallId, title: update.title, kind: update.kind, status: update.status ?? 'pending',
        locations: update.locations?.map((location) => location.path) })
      return
    }
    case 'tool_call_update': {
      const open = openTools.get(update.toolCallId)
      if (update.status === 'completed' || update.status === 'failed') {
        openTools.delete(update.toolCallId)
        event('tool', { id: update.toolCallId, title: update.title ?? open?.title, kind: update.kind ?? open?.kind,
          status: update.status, ms: open ? Date.now() - open.startedAt : undefined,
          locations: update.locations?.map((location) => location.path) })
      }
      return
    }
    case 'plan':
      flushText()
      event('plan', { entries: update.entries.map((entry) => ({ title: entry.content, status: entry.status })) })
      return
    case 'usage_update':
      event('usage', { used: update.used, size: update.size, cost: update.cost })
      return
    default:
      return
  }
}

function onPermission(message) {
  flushText()
  const { toolCall, options } = message.params
  const preferred = config.permissionPolicy === 'deny'
    ? options.find((option) => option.kind === 'reject_once')
    : options.find((option) => option.kind === 'allow_always') ?? options.find((option) => option.kind === 'allow_once')
  event('permission', { title: toolCall?.title, decision: preferred?.kind ?? 'cancelled', policy: config.permissionPolicy })
  send({ id: message.id, result: { outcome: preferred ? { outcome: 'selected', optionId: preferred.optionId } : { outcome: 'cancelled' } } })
}

// ---- heartbeat + stall watchdog + cooperative cancel ----
let sessionId
let cancelled = false
const heartbeat = setInterval(() => {
  const quietMs = Date.now() - lastUpdateAt
  const tools = [...openTools.values()].map((tool) => ({ title: tool.title, kind: tool.kind, ms: Date.now() - tool.startedAt }))
  event('heartbeat', { quietMs, openTools: tools })
  if (quietMs > stallMs && !stallReported) {
    stallReported = true
    event('stall', { quietMs, openTools: tools })
  }
  if (!cancelled && existsSync(controlPath)) {
    const control = JSON.parse(readFileSync(controlPath, 'utf8'))
    if (control.cancel && sessionId) {
      cancelled = true
      flushText()
      event('cancel_requested', {})
      send({ method: 'session/cancel', params: { sessionId } })
    }
  }
}, 10_000)

async function main() {
  const initialized = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: 'overlay-smoke-driver', version: '0.1.0' },
  })
  event('initialized', { agent: initialized.agentInfo, protocolVersion: initialized.protocolVersion,
    loadSession: initialized.agentCapabilities?.loadSession })

  const session = await request('session/new', { cwd: config.cwd, mcpServers: [] })
  sessionId = session.sessionId
  // Newer adapters expose models as a `model` config option (aliases with labels); older ones as `models`.
  const modelOption = session.configOptions?.find((option) => option.id === 'model' || option.category === 'model')
  const availableModels = modelOption
    ? flattenOptions(modelOption.options).map((value) => ({ id: value.value, name: value.name, description: value.description }))
    : session.models?.availableModels?.map((model) => ({ id: model.modelId, name: model.name, description: model.description }))
  const availableModes = session.modes?.availableModes?.map((mode) => ({ id: mode.id, name: mode.name }))
  event('session', {
    sessionId,
    currentModel: session.models?.currentModelId,
    currentMode: session.modes?.currentModeId,
    availableModels,
    availableModes,
    configOptions: session.configOptions?.map((option) => ({ id: option.id, name: option.name, current: option.currentValue,
      values: flattenOptions(option.options).map((value) => value.value) })),
  })

  if (config.mode) {
    if (!availableModes?.some((mode) => mode.id === config.mode)) throw new Error(`mode ${config.mode} not offered`)
    await request('session/set_mode', { sessionId, modeId: config.mode })
    event('mode_set', { mode: config.mode })
  }
  if (config.model) {
    // Accept an exact alias, or a full model id (`claude-haiku-5-5`) matched against the alias and its label.
    const wanted = config.model.toLowerCase()
    const family = wanted.replace(/^claude-/, '').split('-')[0]
    const match = availableModels?.find((model) => model.id === config.model)
      ?? availableModels?.find((model) => `${model.id} ${model.name} ${model.description ?? ''}`.toLowerCase().includes(wanted))
      ?? availableModels?.find((model) => model.id === family)
    if (!match) throw new Error(`model ${config.model} not offered; available: ${availableModels?.map((model) => model.id).join(', ')}`)
    if (modelOption) await request('session/set_config_option', { sessionId, configId: modelOption.id, value: match.id })
    else await request('session/set_model', { sessionId, modelId: match.id })
    event('model_set', { model: match.id, name: match.name })
  }

  event('prompt_sent', { chars: config.prompt.length })
  const result = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text: config.prompt }] })
  flushText()
  event('done', { stopReason: result.stopReason, usage: result.usage })
}

function flattenOptions(options = []) {
  return options.flatMap((option) => option.options ? flattenOptions(option.options) : [option])
}

main()
  .catch((error) => { flushText(); event('error', { message: String(error?.message ?? error), data: error?.data }) })
  .finally(() => {
    clearInterval(heartbeat)
    writeFileSync(join(config.runDir, 'finished'), String(Date.now()))
    child.kill('SIGTERM')
    setTimeout(() => process.exit(0), 1_000)
  })
