import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FilesystemGrant } from '@layernorm/overlay-agent-bridge-protocol'
import { LocalToolFailure } from './local-tools-errors.js'
import { localShell } from './local-tools-exec.js'
import { resolveLocalWorkingDirectory } from './local-tools-paths.js'

/**
 * Machine-owned terminal sessions with the same ids, limits and result shapes
 * as the cloud Computer driver, so `computer_terminal` behaves identically.
 */
const ID_PATTERN = /^t-[0-9a-f]{12}$/
const LIMIT = 8
const DEFAULT_READ_BYTES = 32 * 1024
const MAX_READ_BYTES = 64 * 1024
const CANCEL_WAIT_MS = 1_000

export class LocalTerminals {
  private starting: Promise<unknown> = Promise.resolve()

  constructor(private readonly root: string) {}

  private directory(id: unknown): string {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new LocalToolFailure('invalid_input', 'The terminal session id is invalid.')
    return join(this.root, id)
  }

  private async load(id: unknown): Promise<{ directory: string; pid: number }> {
    const directory = this.directory(id)
    const pid = Number.parseInt(await readFile(join(directory, 'pid'), 'utf8').catch(() => ''), 10)
    if (!Number.isInteger(pid) || pid <= 0) throw new LocalToolFailure('terminal_not_found', 'The terminal session was not found.')
    return { directory, pid }
  }

  private async exitCode(directory: string): Promise<number | null> {
    const raw = await readFile(join(directory, 'exit'), 'utf8').catch(() => null)
    if (raw === null) return null
    const value = Number.parseInt(raw.trim(), 10)
    if (!Number.isInteger(value)) throw new LocalToolFailure('terminal_driver_failed', 'The terminal session exit status is invalid.')
    return value
  }

  private static groupRunning(pid: number): boolean {
    try { process.kill(-pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
  }

  private async running(directory: string, pid: number): Promise<boolean> {
    return await this.exitCode(directory) === null && LocalTerminals.groupRunning(pid)
  }

  private async ids(): Promise<string[]> {
    return (await readdir(this.root).catch(() => [])).filter((name) => ID_PATTERN.test(name))
  }

  async start(grant: FilesystemGrant, request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const command = request.command
    if (typeof command !== 'string' || !command.trim() || command.length > 100_000 || command.includes('\0')) {
      throw new LocalToolFailure('invalid_input', 'command must contain between 1 and 100000 characters.')
    }
    if (request.cwd !== undefined && typeof request.cwd !== 'string') throw new LocalToolFailure('invalid_input', 'cwd must be a valid path.')
    const cwd = await resolveLocalWorkingDirectory(grant, request.cwd as string | undefined)
    // Serialize starts so two calls cannot both pass the eight-session limit.
    const work = this.starting.then(async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      let running = 0
      for (const id of await this.ids()) {
        try { const session = await this.load(id); if (await this.running(session.directory, session.pid)) running++ } catch (_error) { /* skip */ }
      }
      if (running >= LIMIT) throw new LocalToolFailure('terminal_limit', `This Mac already has ${LIMIT} running terminal sessions.`)
      const id = `t-${randomBytes(6).toString('hex')}`
      const directory = join(this.root, id)
      await mkdir(directory, { mode: 0o700 })
      await writeFile(join(directory, 'started_at'), String(Date.now() / 1000), { mode: 0o600 })
      await writeFile(join(directory, 'command'), command, { mode: 0o600 })
      const output = await open(join(directory, 'out.log'), 'a', 0o600)
      const shell = localShell()
      const wrapper = `${shell.command} -l -c "$1"; status=$?; printf "%s\\n" "$status" > "$2/exit.tmp" && mv "$2/exit.tmp" "$2/exit"`
      try {
        const child = spawn('/bin/sh', ['-c', wrapper, 'overlay-terminal', command, directory], {
          cwd, detached: true, stdio: ['ignore', output.fd, output.fd], env: process.env,
        })
        const pid = await new Promise<number>((resolvePromise, reject) => {
          child.once('error', reject)
          child.once('spawn', () => resolvePromise(child.pid!))
        })
        child.unref()
        await writeFile(join(directory, 'pid'), String(pid), { mode: 0o600 })
        return { id, pid }
      } catch (_error) {
        await rm(directory, { recursive: true, force: true })
        throw new LocalToolFailure('terminal_start_failed', 'The terminal command could not be started.')
      } finally { await output.close() }
    })
    this.starting = work.catch(() => undefined)
    return await work
  }

  async read(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { directory, pid } = await this.load(request.id)
    const offset = integer(request.offset ?? 0, 'offset', 0, Number.MAX_SAFE_INTEGER)
    const maxBytes = Math.min(integer(request.maxBytes ?? DEFAULT_READ_BYTES, 'maxBytes', 1, 2 ** 31 - 1), MAX_READ_BYTES)
    const path = join(directory, 'out.log')
    const size = (await stat(path).catch(() => { throw new LocalToolFailure('terminal_not_found', 'The terminal session output was not found.') })).size
    const start = Math.min(offset, size)
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(maxBytes, size - start))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
      const next = start + bytesRead
      return {
        output: buffer.subarray(0, bytesRead).toString('utf8'),
        nextOffset: next,
        running: await this.running(directory, pid),
        exitCode: await this.exitCode(directory),
        truncated: next < size,
      }
    } finally { await handle.close() }
  }

  async cancel(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { directory, pid } = await this.load(request.id)
    const requested = request.signal ?? 'INT'
    const order = ['INT', 'TERM', 'KILL'] as const
    if (typeof requested !== 'string' || !(order as readonly string[]).includes(requested)) throw new LocalToolFailure('invalid_input', 'signal must be INT, TERM, or KILL.')
    let last = requested as (typeof order)[number]
    for (const name of order.slice(order.indexOf(last))) {
      if (!LocalTerminals.groupRunning(pid)) break
      last = name
      try { process.kill(-pid, `SIG${name}`) } catch (_error) { break }
      const deadline = Date.now() + CANCEL_WAIT_MS
      while (Date.now() < deadline && LocalTerminals.groupRunning(pid)) await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
    }
    const running = LocalTerminals.groupRunning(pid)
    let exitCode = await this.exitCode(directory)
    if (!running && exitCode === null) {
      exitCode = 128 + ({ INT: 2, TERM: 15, KILL: 9 } as const)[last]
      await writeFile(join(directory, 'exit.tmp'), `${exitCode}\n`, { mode: 0o600 })
      await rename(join(directory, 'exit.tmp'), join(directory, 'exit'))
    }
    return { id: request.id, running, exitCode }
  }

  async list(): Promise<Record<string, unknown>> {
    const sessions: Array<Record<string, unknown> & { started_at: number }> = []
    for (const id of await this.ids()) {
      try {
        const { directory, pid } = await this.load(id)
        const command = await readFile(join(directory, 'command'), 'utf8')
        const startedAt = Number.parseFloat(await readFile(join(directory, 'started_at'), 'utf8'))
        sessions.push({
          id, command: command.length > 500 ? `${command.slice(0, 500)}...` : command,
          running: await this.running(directory, pid), exitCode: await this.exitCode(directory), started_at: startedAt,
        })
      } catch (_error) { /* skip a damaged session */ }
    }
    sessions.sort((left, right) => right.started_at - left.started_at)
    return { sessions: sessions.slice(0, 20) }
  }

  /** Stop every running session, for host shutdown and sign-out. */
  async stopAll(): Promise<void> {
    for (const id of await this.ids()) {
      try { const { pid } = await this.load(id); if (LocalTerminals.groupRunning(pid)) process.kill(-pid, 'SIGTERM') } catch (_error) { /* gone */ }
    }
  }
}

function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new LocalToolFailure('invalid_input', `${name} must be an integer between ${min} and ${max}.`)
  }
  return value
}
