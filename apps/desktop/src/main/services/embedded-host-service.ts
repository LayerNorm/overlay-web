import { spawn, type ChildProcess } from 'node:child_process'
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { emitDesktopEvent } from './desktop-events'
import { serverProfileService } from './security/server-profile-service'
import { createLocalHelperEnvironment } from './security/local-helper-process'
import {
  ENROLLMENT_CODE_PATTERN,
  buildEmbeddedHostArgs,
  buildEmbeddedHostRunArgs,
  embeddedHostPackageSpec,
  verificationPhraseFrom,
  isEmbeddedHostAdapter,
  isValidServerOrigin,
  resolveNpxPath,
  type EmbeddedHostAdapter
} from './embedded-host-config'

export type { EmbeddedHostAdapter }

export type EmbeddedHostState = 'idle' | 'starting' | 'running' | 'stopping' | 'error'

/**
 * Security posture (deliberate, review before widening):
 * - Every start is explicitly user-initiated from Settings; no auto-start, no
 *   background relaunch, and the child dies with the app (see beginShutdown).
 * - argv is built from validated fields only — never a shell string — and the
 *   host package spec is pinned, never `latest`.
 * - The child inherits a sanitized environment (see local-helper-process) and
 *   its own state directory under the app user data.
 * - Server-side root approval still gates all dispatched work: a running host
 *   alone grants nothing until its environment is approved in-app.
 */

export interface EmbeddedHostExit {
  code: number | null
  signal: string | null
  at: number
  error?: string
}

export interface EmbeddedHostStatus {
  state: EmbeddedHostState
  adapterId: EmbeddedHostAdapter | null
  /** The host serves Overlay's own tools on this Mac. */
  localTools: boolean
  /** Printed by a host waiting for approval; matched in-app against its enrollment. */
  verificationPhrase: string | null
  pid: number | null
  startedAt: number | null
  lastExit: EmbeddedHostExit | null
  logTail: string[]
}

const LOG_LINE_LIMIT = 200
const STOP_GRACE_MS = 5_000

class EmbeddedHostService {
  private child: ChildProcess | null = null
  private state: EmbeddedHostState = 'idle'
  private adapterId: EmbeddedHostAdapter | null = null
  private startedAt: number | null = null
  private lastExit: EmbeddedHostExit | null = null
  private logLines: string[] = []
  private enrollmentCode: string | null = null
  private stopTimer: NodeJS.Timeout | null = null
  private localTools = false
  private verificationPhrase: string | null = null

  stateDirectory(): string {
    return join(app.getPath('userData'), 'agent-host')
  }

  /** A host connected earlier with local tools can restart from its saved configuration. */
  savedLocalToolsConfig(): string | null {
    const path = join(this.stateDirectory(), 'config.json')
    try {
      return existsSync(path) && (JSON.parse(readFileSync(path, 'utf8')) as { localTools?: unknown }).localTools === true
        ? path
        : null
    } catch {
      return null
    }
  }

  getStatus(): EmbeddedHostStatus {
    return {
      state: this.state,
      adapterId: this.adapterId,
      localTools: this.localTools,
      verificationPhrase: this.verificationPhrase,
      pid: this.child?.pid ?? null,
      startedAt: this.startedAt,
      lastExit: this.lastExit,
      logTail: [...this.logLines]
    }
  }

  async start(input: { code: string; adapterId?: string; localTools?: boolean }): Promise<EmbeddedHostStatus> {
    const code = typeof input.code === 'string' ? input.code.trim() : ''
    if (!ENROLLMENT_CODE_PATTERN.test(code)) throw new Error('Invalid enrollment code.')
    if (input.adapterId !== undefined && !isEmbeddedHostAdapter(input.adapterId)) throw new Error('Unsupported harness.')
    if (input.adapterId === undefined && input.localTools !== true) throw new Error('Choose a harness or local tools.')
    const origin = serverProfileService.getActiveOrigin()
    if (!isValidServerOrigin(origin)) throw new Error('Invalid Overlay server origin.')
    const stateDir = this.stateDirectory()
    mkdirSync(stateDir, { recursive: true })
    return this.launch({
      argv: buildEmbeddedHostArgs({
        code,
        ...(input.adapterId ? { adapterId: input.adapterId as EmbeddedHostAdapter } : {}),
        ...(input.localTools ? { localTools: true } : {}),
        origin,
        stateDir,
        name: `${hostname()} (Desktop)`,
        packageSpec: embeddedHostPackageSpec(process.env, app.isPackaged),
        ...(process.env.OVERLAY_DESKTOP_HOSTING_AUTH_FILE
          ? { hostingAuthFile: process.env.OVERLAY_DESKTOP_HOSTING_AUTH_FILE }
          : {})
      }),
      code,
      adapterId: (input.adapterId as EmbeddedHostAdapter | undefined) ?? null,
      localTools: input.localTools === true
    })
  }

  /** Restarts the local-tools host from its saved connection; no-op when it is running or was never connected. */
  async resumeLocalTools(): Promise<EmbeddedHostStatus> {
    if (this.child) return this.getStatus()
    const configPath = this.savedLocalToolsConfig()
    if (!configPath) return this.getStatus()
    return this.launch({
      argv: buildEmbeddedHostRunArgs({ configPath, packageSpec: embeddedHostPackageSpec(process.env, app.isPackaged) }),
      code: null,
      adapterId: null,
      localTools: true
    })
  }

  private async launch(input: {
    argv: string[]
    code: string | null
    adapterId: EmbeddedHostAdapter | null
    localTools: boolean
  }): Promise<EmbeddedHostStatus> {
    if (this.child) this.stopImmediately()
    const npxPath = resolveNpxPath()
    if (!npxPath) {
      throw new Error(
        'Node.js (npx) was not found on this Mac. Install Node.js 22+ or run the connection command in a terminal instead.'
      )
    }
    this.enrollmentCode = input.code
    this.state = 'starting'
    this.adapterId = input.adapterId
    this.localTools = input.localTools
    this.verificationPhrase = null
    this.startedAt = Date.now()
    this.lastExit = null
    this.logLines = []
    this.broadcast()

    const child = spawn(
      npxPath,
      input.argv,
      {
        env: createLocalHelperEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      }
    )
    this.child = child
    this.appendLog(`Starting embedded agent host (${input.argv[4]})…`)

    child.stdout?.on('data', (chunk: Buffer) => this.appendLog(chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => this.appendLog(chunk.toString()))
    child.on('error', (error: Error) => {
      if (this.child !== child) return
      this.child = null
      this.state = 'error'
      this.lastExit = { code: null, signal: null, at: Date.now(), error: error.message }
      this.appendLog(`Host failed to start: ${error.message}`)
      this.broadcast()
    })
    child.on('exit', (exitCode, signal) => {
      if (this.child !== child) return
      this.child = null
      const wasStopping = this.state === 'stopping'
      this.state = wasStopping || exitCode === 0 ? 'idle' : 'error'
      this.lastExit = { code: exitCode, signal, at: Date.now() }
      this.appendLog(
        wasStopping || exitCode === 0
          ? 'Host stopped.'
          : `Host exited unexpectedly (code ${exitCode ?? 'unknown'}).`
      )
      this.broadcast()
    })

    // The host prints its first heartbeat once polling; mark running on spawn —
    // the environments list (3s poll while pending) is the real readiness gate.
    this.state = 'running'
    this.broadcast()
    return this.getStatus()
  }

  async stop(): Promise<EmbeddedHostStatus> {
    const child = this.child
    if (!child) {
      this.state = this.state === 'error' ? 'error' : 'idle'
      return this.getStatus()
    }
    this.state = 'stopping'
    this.broadcast()
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      this.stopTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // Already gone.
        }
        resolve()
      }, STOP_GRACE_MS)
      child.once('exit', () => {
        if (this.stopTimer) clearTimeout(this.stopTimer)
        this.stopTimer = null
        resolve()
      })
    })
    return this.getStatus()
  }

  /** Best-effort synchronous kill for app shutdown. */
  stopImmediately(): void {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
    const child = this.child
    this.child = null
    if (child && child.exitCode === null && !child.killed) {
      try {
        child.kill('SIGKILL')
      } catch {
        // Already gone.
      }
    }
    if (this.state === 'running' || this.state === 'starting' || this.state === 'stopping') {
      this.state = 'idle'
    }
  }

  private appendLog(chunk: string): void {
    // The enrollment code travels via argv only (same-user process list) and is
    // never written to these logs.
    for (const line of chunk.split(/\r?\n/)) {
      const trimmed = (
        this.enrollmentCode ? line.replaceAll(this.enrollmentCode, '[redacted]') : line
      ).trim()
      if (!trimmed) continue
      const phrase = verificationPhraseFrom(trimmed)
      if (phrase) this.verificationPhrase = phrase
      this.logLines.push(trimmed.slice(0, 500))
      if (this.logLines.length > LOG_LINE_LIMIT) {
        this.logLines.splice(0, this.logLines.length - LOG_LINE_LIMIT)
      }
    }
  }

  private broadcast(): void {
    emitDesktopEvent('agentHost.status', this.getStatus())
  }
}

export const embeddedHostService = new EmbeddedHostService()
