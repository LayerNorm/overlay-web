import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  createAcpRuntime,
  createAgentRegistry,
  createFileSessionStore,
  type AcpAgentRegistry,
  type AcpPermissionDecision,
  type AcpPermissionRequest,
  type AcpElicitationResponse,
  type AcpRuntime,
  type AcpRuntimeEvent,
  type AcpRuntimeHandle,
  type AcpRuntimeTurn,
  type AcpRuntimeTurnResult,
} from 'acpx/runtime'
import type { McpServer } from '@agentclientprotocol/sdk'
import { emitToolContent, overlayMcpServers } from './acp-adapter.js'
import type { AgentAdapter, AgentAdapterSession, EmitAgentEvent, StartAdapterSessionInput } from './adapter.js'

/**
 * Overlay adapter ids → acpx agent names. acpx resolves each name to a pinned
 * ACP adapter launch (an installed binary first, `npx` otherwise).
 */
export const ACPX_AGENT_NAMES: Record<string, string> = {
  'claude-code': 'claude',
  codex: 'codex',
}

/**
 * Experimental agents whose own CLI is on the machine (Overlay Cloud's system layer) instead of being bundled and
 * pinned in the Overlay image, so `image-check` does not require them. Bring-your-own-key only.
 */
export const ACPX_SYSTEM_AGENT_NAMES: Record<string, string> = {
  opencode: 'opencode',
  cursor: 'cursor',
  hermes: 'hermes',
}

/** Agents acpx has no built-in launch for: how to start them speaking ACP. */
export const ACPX_AGENT_LAUNCH_OVERRIDES: Record<string, string[]> = {
  hermes: ['hermes', 'acp'],
}

export const ACPX_AGENT_DISPLAY_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  hermes: 'Hermes',
}

/** The acpx agent name for an Overlay adapter id, or undefined when acpx does not run it. */
export function acpxAgentNameFor(adapterId: string): string | undefined {
  return ACPX_AGENT_NAMES[adapterId] ?? ACPX_SYSTEM_AGENT_NAMES[adapterId]
}

export type AcpxAdapterOptions = {
  id: string
  displayName: string
  /** acpx agent name (`claude`, `codex`, …) or a key of `registryOverrides`. */
  agent: string
  /** Where acpx keeps session records so a later run can resume the session. */
  stateDirectory: string
  /** Child-only environment for the agent process (never persisted by acpx). */
  env?: Record<string, string>
  /** Extra or replacement agent launch commands, e.g. a test fixture. */
  registryOverrides?: Record<string, string | string[]>
}

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void }

type PendingPermission = { options: Map<string, string>; response: Deferred<AcpPermissionDecision> }
type PendingElicitation = { response: Deferred<AcpElicitationResponse> }

/**
 * ACP sessions run through acpx's runtime (`acpx/runtime`): process lifecycle,
 * session persistence and resume, queueing, permission and elicitation
 * plumbing. This adapter only maps acpx's events to Overlay's bridge events.
 *
 * Overlay issues a fresh MCP token for every run, and acpx keeps a connection's
 * MCP servers fixed, so the connection is closed after each turn (the session
 * record stays) and the next turn reconnects with that run's servers.
 */
export class AcpxAgentAdapter implements AgentAdapter {
  readonly capability
  private readonly registry: AcpAgentRegistry
  private readonly mcpBySession = new Map<string, McpServer[]>()

  constructor(private readonly options: AcpxAdapterOptions) {
    this.capability = {
      id: options.id, displayName: options.displayName, protocol: 'acp' as const,
      supports: { prompt: true, approval: true, cancel: true, resume: true },
    }
    this.registry = createAgentRegistry(options.registryOverrides ? { overrides: options.registryOverrides } : {})
  }

  async discover() {
    if (!this.registry.list().includes(this.options.agent)) {
      throw new Error(`acpx does not know the agent "${this.options.agent}"`)
    }
    return this.capability
  }

  /**
   * A runtime per session: the agent process environment is fixed when a
   * runtime is created, and each run brings its own credentials. Session
   * records live on disk, so a later run's runtime resumes the same session.
   */
  private runtimeFor(cwd: string, credentials?: Record<string, string>): AcpRuntime {
    const env = { ...this.options.env, ...credentials }
    return createAcpRuntime({
      cwd,
      sessionStore: createFileSessionStore({ stateDir: join(this.options.stateDirectory, 'acpx') }),
      agentRegistry: this.registry,
      ...(Object.keys(env).length > 0 ? { agentProcessEnv: env } : {}),
      mcpServers: (session) => this.mcpBySession.get(session.sessionKey) ?? [],
      // Overlay decides every permission request through the bridge.
      permissionMode: 'deny-all',
      nonInteractivePermissions: 'deny',
      elicitationModes: ['form'],
    })
  }

  async start(input: StartAdapterSessionInput, emit: EmitAgentEvent): Promise<AgentAdapterSession> {
    const runtime = this.runtimeFor(input.workingDirectory, input.credentials)
    const sessionKey = input.remoteSessionId ?? `overlay-${randomUUID()}`
    this.mcpBySession.set(sessionKey, overlayMcpServers(input.metadata, true))
    const ensure = () => runtime.ensureSession({
      sessionKey, agent: this.options.agent, mode: 'persistent', cwd: input.workingDirectory,
    })
    const requestedModel = typeof input.metadata?.model === 'string' && input.metadata.model.trim() ? input.metadata.model.trim() : null
    // The model an agent's owner chose, in the agent's own id (Claude Code `sonnet`, Codex `gpt-6-sol[high]`). A model the
    // agent does not offer fails the run with the agent's own message instead of silently running another model.
    const applyModel = async (target: AcpRuntimeHandle) => {
      if (requestedModel) await applyRequestedModel(runtime, target, requestedModel)
    }
    let handle: AcpRuntimeHandle = await ensure()
    await applyModel(handle)
    let activeTurn: AcpRuntimeTurn | undefined
    const permissions = new Map<string, PendingPermission>()
    const elicitations = new Map<string, PendingElicitation>()
    let textCheckpoint = ''
    let connected = true

    const onPermissionRequest = async (request: AcpPermissionRequest): Promise<AcpPermissionDecision> => {
      const raw = request.raw
      const requestKey = raw.toolCall.toolCallId || randomUUID()
      const response = deferred<AcpPermissionDecision>()
      permissions.set(requestKey, {
        options: new Map(raw.options.map((option) => [option.optionId, option.kind])),
        response,
      })
      await emit({
        type: 'approval_requested',
        payload: {
          requestKey,
          prompt: raw.toolCall.title ?? 'Agent permission request',
          options: raw.options.map((option) => ({ id: option.optionId, label: option.name })),
          context: { toolCallId: raw.toolCall.toolCallId },
        },
      })
      const decision = await response.promise
      permissions.delete(requestKey)
      return decision
    }

    const onElicitation = async (request: { mode?: string; message: string; requestedSchema?: unknown }) => {
      if (request.mode !== 'form') return { action: 'decline' as const }
      const requestKey = randomUUID()
      const response = deferred<AcpElicitationResponse>()
      elicitations.set(requestKey, { response })
      await emit({ type: 'elicitation_requested', payload: {
        requestKey, prompt: request.message, requestedSchema: (request.requestedSchema ?? {}) as Record<string, unknown>, context: {},
      } })
      const result = await response.promise
      elicitations.delete(requestKey)
      return result
    }

    const disconnect = async (reason: string) => {
      if (!connected) return
      connected = false
      await runtime.close({ handle, reason }).catch(() => undefined)
    }

    return {
      remoteSessionId: sessionKey,
      prompt: async (prompt) => {
        if (!connected) {
          handle = await ensure()
          await applyModel(handle)
          connected = true
        }
        textCheckpoint = ''
        const turn = runtime.startTurn({
          handle, text: prompt, mode: 'prompt', requestId: randomUUID(),
          onPermissionRequest, onElicitation: onElicitation as never,
        })
        activeTurn = turn
        try {
          for await (const event of turn.events) {
            await normalizeAcpxEvent(event, emit, {
              appendText(chunk) {
                textCheckpoint += chunk
                return textCheckpoint
              },
            })
          }
          await emitTurnResult(await turn.result, emit, this.options.id)
        } finally {
          activeTurn = undefined
          await disconnect('overlay turn finished')
        }
      },
      approve: async (requestKey, optionId) => {
        const pending = permissions.get(requestKey)
        if (!pending) throw new Error(`ACP approval request is not pending: ${requestKey}`)
        const kind = pending.options.get(optionId)
        if (!kind) throw new Error(`ACP approval option is invalid: ${optionId}`)
        pending.response.resolve(permissionDecision(kind))
      },
      elicit: async (requestKey, action, content) => {
        const pending = elicitations.get(requestKey)
        if (!pending) throw new Error(`ACP elicitation request is not pending: ${requestKey}`)
        pending.response.resolve(action === 'accept'
          ? { action, content: content as Record<string, string | number | boolean | string[]> }
          : { action })
      },
      cancel: async (reason) => {
        if (activeTurn) await activeTurn.cancel({ reason: reason ?? 'cancelled from Overlay' })
        else await runtime.cancel({ handle, reason: reason ?? 'cancelled from Overlay' })
      },
      resume: async () => undefined,
      stop: async (reason) => {
        for (const pending of permissions.values()) pending.response.resolve({ outcome: 'cancel' })
        for (const pending of elicitations.values()) pending.response.resolve({ action: 'cancel' })
        await disconnect(reason ?? 'overlay session stopped')
        this.mcpBySession.delete(sessionKey)
      },
    }
  }
}

function permissionDecision(kind: string): AcpPermissionDecision {
  if (kind === 'allow_always') return { outcome: 'allow_always' }
  if (kind === 'reject_once') return { outcome: 'reject_once' }
  if (kind === 'reject_always') return { outcome: 'reject_always' }
  return { outcome: 'allow_once' }
}

/** Failure code for an agent that rejected its credentials; the control plane flags the account for reconnecting. */
export const AGENT_AUTH_FAILURE_CODE = 'auth_required'

const AUTH_FAILURE_PATTERN = /auth(entication)? (required|failed)|not logged in|invalid (api[- ]?key|x-api-key|token|credentials?)|unauthori[sz]ed|\b401\b|oauth token.*(expired|revoked|invalid)|please run \/login/i

const REAUTH_MESSAGE: Record<string, string> = {
  'claude-code': 'Claude Code could not sign in. Reconnect your Claude account in Settings → Agent accounts.',
  codex: 'Codex could not sign in. Reconnect your OpenAI account in Settings → Agent accounts.',
}

export function isAuthFailureMessage(message: string): boolean {
  return AUTH_FAILURE_PATTERN.test(message)
}

async function emitTurnResult(result: AcpRuntimeTurnResult, emit: EmitAgentEvent, adapterId: string) {
  if (result.status === 'completed') {
    await emit({ type: 'completed', payload: { summary: `ACP turn stopped: ${result.stopReason ?? 'end_turn'}`, usage: {} } })
  } else if (result.status === 'cancelled') {
    await emit({ type: 'cancelled', payload: {} })
  } else if (isAuthFailureMessage(result.error.message)) {
    await emit({ type: 'failed', payload: {
      code: AGENT_AUTH_FAILURE_CODE,
      message: REAUTH_MESSAGE[adapterId] ?? 'The agent could not sign in. Reconnect its account in Settings → Agent accounts.',
      retryable: false,
    } })
  } else {
    await emit({ type: 'failed', payload: {
      code: result.error.code ?? 'acp_turn_failed',
      message: result.error.message.slice(0, 2_000),
      retryable: result.error.retryable ?? false,
    } })
  }
}

type ModelControls = Pick<AcpRuntime, 'setModel' | 'setConfigOption'>

/**
 * Applies the model an agent's owner chose. The id is tried as given. Codex on a ChatGPT sign-in advertises plain model
 * names (`gpt-6-sol`) while an API key advertises `gpt-6-sol[high]`; so when a `name[level]` id is not offered, the
 * name is applied and the level is set as the reasoning effort (best effort: an agent without that setting keeps its
 * own). A model the agent does not offer at all still fails the run, with the agent's own message.
 */
export async function applyRequestedModel(runtime: ModelControls, handle: AcpRuntimeHandle, model: string): Promise<void> {
  if (!runtime.setModel) return
  try {
    await runtime.setModel({ handle, model })
    return
  } catch (error) {
    const split = /^(.+)\[([^\]]+)\]$/.exec(model)
    if (!split) throw error
    await runtime.setModel({ handle, model: split[1]! })
    for (const key of ['reasoning_effort', 'effort']) {
      try {
        await runtime.setConfigOption?.({ handle, key, value: split[2]! })
        return
      } catch (_error) {
        // Try the next name; an agent with no such setting keeps its own level.
      }
    }
  }
}

/** Maps acpx runtime events to Overlay's normalized bridge events. */
export async function normalizeAcpxEvent(
  event: AcpRuntimeEvent,
  emit: EmitAgentEvent,
  checkpoint: { appendText(chunk: string): string },
): Promise<void> {
  if (event.type === 'text_delta') {
    if (event.stream === 'thought') return
    await emit({ type: 'text_checkpoint', payload: { text: checkpoint.appendText(event.text) } })
    return
  }
  if (event.type === 'tool_call') {
    const actionId = event.toolCallId ?? randomUUID()
    const title = event.title ?? event.text ?? 'Tool call'
    await emit({ type: 'action', payload: { actionId, title, status: normalizeStatus(event.status) } })
    await emitToolContent(actionId, title, event.content as never, emit)
    return
  }
  if (event.type === 'status') {
    if (event.entries) {
      await emit({ type: 'plan', payload: { entries: event.entries.map((entry, index) => ({
        id: `plan-${index}`, title: entry.content, status: entry.status,
      })) } })
    }
    if (event.availableCommands) {
      await emit({ type: 'commands_update', payload: { commands: event.availableCommands.slice(0, 100).map((command) => ({
        name: command.name,
        ...(command.description ? { description: command.description } : {}),
      })) } })
    }
  }
}

function normalizeStatus(status: string | undefined): 'started' | 'updated' | 'completed' | 'failed' {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'in_progress' || status === 'pending') return 'started'
  return 'updated'
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}
