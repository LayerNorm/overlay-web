import * as pty from 'node-pty'
import { homedir, platform } from 'node:os'
import { existsSync } from 'node:fs'
import { auditLogger } from '../security/security-service'

export interface TerminalSession {
  id: string
  pty: pty.IPty
  outputBuffer: string[]
  maxBufferLines: number
  cwd: string
  createdAt: number
  lastActiveAt: number
}

export interface TerminalRunResult {
  success: boolean
  exitCode?: number
  stdout: string
  stderr: string
  timedOut?: boolean
  error?: string
}

const DANGEROUS_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\s+).*\//i,
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f/i,
  /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b>\s*\/dev\/sd/i,
  /\bchmod\s+-R\s+777\s+\//i,
  /\bsudo\s+rm\b/i,
  /\bsudo\s+mkfs\b/i,
  /\bsudo\s+dd\b/i,
  /:(){ :|:& };:/,
  /\bfork\s*bomb/i
]

const DEFAULT_MAX_BUFFER_LINES = 2000
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000
const MAX_COMMAND_TIMEOUT_MS = 300_000
const MAX_SESSIONS = 10

class TerminalService {
  private sessions = new Map<string, TerminalSession>()

  private getDefaultShell(): string {
    if (platform() === 'win32') {
      return process.env.COMSPEC || 'powershell.exe'
    }
    return process.env.SHELL || '/bin/zsh'
  }

  private generateId(): string {
    return `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  }

  isDangerous(command: string): { dangerous: boolean; reason?: string } {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return { dangerous: true, reason: `Matches blocked pattern: ${pattern.source}` }
      }
    }
    return { dangerous: false }
  }

  createSession(cwd?: string): TerminalSession {
    if (this.sessions.size >= MAX_SESSIONS) {
      // Kill oldest session
      let oldest: TerminalSession | null = null
      for (const session of this.sessions.values()) {
        if (!oldest || session.lastActiveAt < oldest.lastActiveAt) {
          oldest = session
        }
      }
      if (oldest) {
        this.killSession(oldest.id)
      }
    }

    const id = this.generateId()
    const shell = this.getDefaultShell()
    const workingDir = cwd && existsSync(cwd) ? cwd : homedir()

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: workingDir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        PAGER: 'cat',
        GIT_PAGER: 'cat'
      } as Record<string, string>
    })

    const session: TerminalSession = {
      id,
      pty: ptyProcess,
      outputBuffer: [],
      maxBufferLines: DEFAULT_MAX_BUFFER_LINES,
      cwd: workingDir,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    }

    ptyProcess.onData((data: string) => {
      const lines = data.split('\n')
      session.outputBuffer.push(...lines)
      // Trim buffer if too large
      if (session.outputBuffer.length > session.maxBufferLines) {
        session.outputBuffer = session.outputBuffer.slice(-session.maxBufferLines)
      }
      session.lastActiveAt = Date.now()
    })

    ptyProcess.onExit(() => {
      this.sessions.delete(id)
    })

    this.sessions.set(id, session)

    auditLogger.log({
      type: 'ipc:sensitive_call',
      action: 'terminal:session_created',
      details: { sessionId: id, shell, cwd: workingDir },
      success: true
    })

    return session
  }

  getSession(id: string): TerminalSession | undefined {
    return this.sessions.get(id)
  }

  listSessions(): Array<{ id: string; cwd: string; createdAt: number; lastActiveAt: number }> {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      cwd: s.cwd,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt
    }))
  }

  writeToSession(id: string, data: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.pty.write(data)
    session.lastActiveAt = Date.now()
    return true
  }

  readSessionOutput(id: string, lastN?: number): string | null {
    const session = this.sessions.get(id)
    if (!session) return null
    const lines = lastN ? session.outputBuffer.slice(-lastN) : session.outputBuffer
    return lines.join('\n')
  }

  resizeSession(id: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.pty.resize(Math.max(40, Math.min(cols, 300)), Math.max(10, Math.min(rows, 100)))
    return true
  }

  killSession(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    try {
      session.pty.kill()
    } catch {
      // already dead
    }
    this.sessions.delete(id)

    auditLogger.log({
      type: 'ipc:sensitive_call',
      action: 'terminal:session_killed',
      details: { sessionId: id },
      success: true
    })

    return true
  }

  /**
   * Run a single command and return the result. Does NOT use a persistent session —
   * spawns a shell, runs the command, collects output, and exits.
   */
  async runCommand(
    command: string,
    options?: { cwd?: string; timeoutMs?: number }
  ): Promise<TerminalRunResult> {
    const dangerCheck = this.isDangerous(command)
    if (dangerCheck.dangerous) {
      auditLogger.log({
        type: 'ipc:sensitive_call',
        action: 'terminal:command_blocked',
        details: { command: command.slice(0, 200), reason: dangerCheck.reason },
        success: false
      })
      return {
        success: false,
        stdout: '',
        stderr: '',
        error: `Command blocked: ${dangerCheck.reason}`
      }
    }

    const cwd = options?.cwd && existsSync(options.cwd) ? options.cwd : homedir()
    const timeoutMs = Math.min(
      Math.max(options?.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS, 1000),
      MAX_COMMAND_TIMEOUT_MS
    )

    auditLogger.log({
      type: 'ipc:sensitive_call',
      action: 'terminal:command_run',
      details: { command: command.slice(0, 200), cwd, timeoutMs },
      success: true
    })

    return new Promise<TerminalRunResult>((resolve) => {
      const shell = this.getDefaultShell()
      const output: string[] = []
      let timedOut = false
      let exited = false

      const ptyProcess = pty.spawn(shell, ['-c', command], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          PAGER: 'cat',
          GIT_PAGER: 'cat'
        } as Record<string, string>
      })

      const timer = setTimeout(() => {
        timedOut = true
        try {
          ptyProcess.kill()
        } catch {
          // ignore
        }
      }, timeoutMs)

      ptyProcess.onData((data: string) => {
        output.push(data)
        // Cap collected output at ~1MB
        const totalLen = output.reduce((acc, s) => acc + s.length, 0)
        if (totalLen > 1024 * 1024) {
          try {
            ptyProcess.kill()
          } catch {
            // ignore
          }
        }
      })

      ptyProcess.onExit(({ exitCode }) => {
        if (exited) return
        exited = true
        clearTimeout(timer)

        // Strip ANSI escape codes for cleaner output
        const raw = output.join('')
        const clean = raw.replace(
          // eslint-disable-next-line no-control-regex
          /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
          ''
        )

        resolve({
          success: !timedOut && exitCode === 0,
          exitCode: exitCode ?? undefined,
          stdout: clean.slice(0, 50_000),
          stderr: '',
          timedOut
        })
      })
    })
  }

  destroyAll(): void {
    for (const session of this.sessions.values()) {
      try {
        session.pty.kill()
      } catch {
        // ignore
      }
    }
    this.sessions.clear()
  }
}

export const terminalService = new TerminalService()
