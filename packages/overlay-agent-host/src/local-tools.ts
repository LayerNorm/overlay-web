import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  LOCAL_TOOLS_VERSION,
  MAX_LOCAL_TOOL_RESULT_BYTES,
  OVERLAY_AGENT_PROTOCOL_VERSION,
  localToolResultSchema,
  type FilesystemGrant,
  type LocalToolCall,
  type LocalToolFeature,
  type LocalToolOutcome,
  type LocalToolPollResponse,
  type LocalToolResult,
  type LocalToolsCapability,
} from '@layernorm/overlay-agent-bridge-protocol'
import { LocalBrowser } from './local-tools-browser.js'
import { LocalToolFailure } from './local-tools-errors.js'
import { listLocalFiles, readLocalFile, runLocalExec, writeLocalFile } from './local-tools-exec.js'
import { macDesktopCapabilities, macInput, macScreenshot } from './local-tools-macos.js'
import { LocalTerminals } from './local-tools-terminal.js'
import type { StructuredLogger } from './logger.js'
import { nextReconnectDelay } from './transport.js'

const run = promisify(execFile)
const MAX_CONCURRENT_CALLS = 4
/** A refused path asks Overlay for the current folders at most this often. */
const GRANT_REFRESH_INTERVAL_MS = 30_000

export type LocalToolsOptions = {
  stateDirectory: string
  /** Read on every call so a changed folder approval applies immediately. */
  grant: () => FilesystemGrant
  /** Asks Overlay for the folders approved now. A folder the person just added works without waiting for renewal. */
  refreshGrant?: () => Promise<void>
  platform?: NodeJS.Platform
  browser?: LocalBrowser
}

/** Executes Overlay tool calls on this machine. It needs no ACP adapter or third-party harness. */
export class LocalToolExecutor {
  private readonly platform: NodeJS.Platform
  readonly terminals: LocalTerminals
  private readonly browser: LocalBrowser

  private lastGrantRefresh = 0

  constructor(private readonly options: LocalToolsOptions) {
    this.platform = options.platform ?? process.platform
    this.terminals = new LocalTerminals(join(options.stateDirectory, 'local-tools', 'terminals'))
    this.browser = options.browser ?? new LocalBrowser(join(options.stateDirectory, 'local-tools', 'browser-profile'))
  }

  async capability(): Promise<LocalToolsCapability> {
    const features: LocalToolFeature[] = ['exec', 'files', 'terminal']
    if (this.platform === 'darwin') features.push('screenshot', 'input')
    if (await LocalBrowser.findBinary()) features.push('browser')
    return {
      version: LOCAL_TOOLS_VERSION,
      os: this.platform === 'darwin' || this.platform === 'win32' ? this.platform : 'linux',
      features,
      homeDirectory: homedir(),
    }
  }

  async execute(call: LocalToolCall, signal?: AbortSignal): Promise<LocalToolOutcome> {
    try {
      const result = await this.dispatchWithCurrentGrant(call, signal)
      const size = Buffer.byteLength(JSON.stringify(result))
      if (size > MAX_LOCAL_TOOL_RESULT_BYTES) {
        return failure(new LocalToolFailure('result_too_large', 'The result is too large to send back. Read a smaller part, for example with a byte limit or a narrower command.'))
      }
      return { ok: true, result }
    } catch (error) {
      return failure(error)
    }
  }

  /** A path outside the approved folders may be a folder approved a moment ago: fetch the grant once and try again. */
  private async dispatchWithCurrentGrant(call: LocalToolCall, signal?: AbortSignal): Promise<Record<string, unknown>> {
    try {
      return await this.dispatch(call, signal)
    } catch (error) {
      const refresh = this.options.refreshGrant
      if (!refresh || !(error instanceof LocalToolFailure) || error.code !== 'outside_approved_folders'
        || Date.now() - this.lastGrantRefresh < GRANT_REFRESH_INTERVAL_MS) throw error
      this.lastGrantRefresh = Date.now()
      try { await refresh() } catch { throw error }
      return await this.dispatch(call, signal)
    }
  }

  private async dispatch(call: LocalToolCall, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const request = call.request
    const grant = this.options.grant()
    switch (request.kind) {
      case 'exec': return await runLocalExec(grant, request, signal)
      case 'read_file': return await readLocalFile(grant, request)
      case 'write_file': return await writeLocalFile(grant, request)
      case 'list_files': return await listLocalFiles(grant, request)
      case 'driver': return await this.driver(request.command, request.args, grant)
    }
  }

  private requireMac(): void {
    if (this.platform !== 'darwin') throw new LocalToolFailure('desktop_unsupported', 'Screen control is available on macOS only.')
  }

  private async driver(command: string, args: Record<string, unknown>, grant: FilesystemGrant): Promise<Record<string, unknown>> {
    switch (command) {
      case 'capabilities': this.requireMac(); return await macDesktopCapabilities()
      case 'screenshot': this.requireMac(); return await macScreenshot()
      case 'wait': {
        const ms = typeof args.ms === 'number' ? Math.min(Math.max(0, args.ms), 10_000) : 0
        await new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
        return { success: true }
      }
      case 'click': case 'move': case 'drag': case 'type': case 'key': case 'scroll':
        this.requireMac()
        return await macInput(command, args)
      case 'browser_ensure': return await this.browser.ensure()
      case 'browser': return await this.browser.run(args)
      case 'open_url': return await this.openUrl(args.url)
      case 'terminal_start': return await this.terminals.start(grant, args)
      case 'terminal_read': return await this.terminals.read(args)
      case 'terminal_cancel': return await this.terminals.cancel(args)
      case 'terminal_list': return await this.terminals.list()
      default: throw new LocalToolFailure('invalid_input', 'Unsupported local tool command.')
    }
  }

  private async openUrl(value: unknown): Promise<Record<string, unknown>> {
    let url: URL
    try { url = new URL(String(value)) } catch (_error) { throw new LocalToolFailure('invalid_input', 'url must be an HTTP or HTTPS URL.') }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new LocalToolFailure('invalid_input', 'url must be an HTTP or HTTPS URL.')
    try {
      await this.browser.run({ action: 'navigate', url: url.toString() })
      return { openedWith: 'browser' }
    } catch (error) {
      if (!(error instanceof LocalToolFailure) || error.code !== 'desktop_unsupported' || this.platform !== 'darwin') throw error
      await run('/usr/bin/open', [url.toString()], { timeout: 15_000 })
      return { openedWith: 'default_browser' }
    }
  }

  async shutdown(): Promise<void> {
    await this.terminals.stopAll()
  }
}

function failure(error: unknown): LocalToolOutcome {
  if (error instanceof LocalToolFailure) {
    return { ok: false, error: {
      code: error.code.slice(0, 100), message: error.message.slice(0, 2_000),
      ...(error.missing.length ? { missing: error.missing.slice(0, 20) } : {}),
      ...(error.detail ? { detail: error.detail } : {}),
    } }
  }
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'EACCES' || code === 'EPERM') return { ok: false, error: { code: 'permission_denied', message: 'macOS denied access to that path.' } }
  if (code === 'ENOENT') return { ok: false, error: { code: 'not_found', message: 'That path does not exist.' } }
  return { ok: false, error: { code: 'local_tool_failed', message: 'The action failed on this computer.' } }
}

export interface LocalToolClient {
  pollLocalToolCalls(args: { waitMs: number; signal?: AbortSignal }): Promise<Omit<LocalToolPollResponse, 'protocolVersion'>>
  submitLocalToolResult(result: LocalToolResult): Promise<void>
}

/**
 * Long-polls for tool calls and posts results. Calls are at most once: a call
 * past its deadline is reported as expired instead of being started.
 */
export class LocalToolLoop {
  private active = 0
  private readonly running = new Set<Promise<void>>()

  constructor(private readonly client: LocalToolClient, private readonly executor: LocalToolExecutor, private readonly logger?: StructuredLogger) {}

  async run(signal: AbortSignal): Promise<void> {
    let attempt = 0
    while (!signal.aborted) {
      try {
        while (this.active >= MAX_CONCURRENT_CALLS && !signal.aborted) await Promise.race(this.running)
        const { calls } = await this.client.pollLocalToolCalls({ waitMs: 20_000, signal })
        attempt = 0
        for (const call of calls) this.start(call, signal)
      } catch (error) {
        if (signal.aborted) break
        const delay = nextReconnectDelay(attempt++)
        this.logger?.warn('local tool poll failed', { error: error instanceof Error ? error.message : String(error), delay })
        await new Promise((resolvePromise) => setTimeout(resolvePromise, delay))
      }
    }
    await Promise.allSettled(this.running)
    await this.executor.shutdown()
  }

  private start(call: LocalToolCall, signal: AbortSignal): void {
    this.active++
    const work = (async () => {
      const outcome: LocalToolOutcome = Date.now() > call.deadlineAt
        ? { ok: false, error: { code: 'expired', message: 'The tool call expired before this computer received it.' } }
        : await this.executor.execute(call, AbortSignal.any([signal, AbortSignal.timeout(Math.max(1_000, call.deadlineAt - Date.now()))]))
      const result = localToolResultSchema.parse({ protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, callId: call.callId, outcome })
      for (let attempt = 0; attempt < 4; attempt++) {
        try { await this.client.submitLocalToolResult(result); return } catch (error) {
          this.logger?.warn('local tool result upload failed', { callId: call.callId, error: error instanceof Error ? error.message : String(error) })
          await new Promise((resolvePromise) => setTimeout(resolvePromise, nextReconnectDelay(attempt)))
        }
      }
    })().finally(() => { this.active--; this.running.delete(work) })
    this.running.add(work)
  }
}
