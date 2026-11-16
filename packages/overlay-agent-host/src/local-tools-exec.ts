import { spawn } from 'node:child_process'
import { mkdir, readdir, lstat, open, rename, writeFile } from 'node:fs/promises'
import { dirname, join, basename } from 'node:path'
import type { FilesystemGrant, LocalExecResult, LocalListFilesResult, LocalReadFileResult } from '@layernorm/overlay-agent-bridge-protocol'
import { LocalToolFailure } from './local-tools-errors.js'
import { resolveLocalToolPath, resolveLocalWorkingDirectory } from './local-tools-paths.js'

export const LOCAL_EXEC_MAX_OUTPUT_BYTES = 256 * 1024
const LIST_LIMIT = 500

/** The user's login shell, so commands see the same PATH (Homebrew, nvm, …) as their terminal. */
export function localShell(): { command: string; args: (script: string) => string[] } {
  if (process.platform === 'win32') return { command: 'cmd.exe', args: (script) => ['/d', '/s', '/c', script] }
  const shell = process.env.SHELL && /^\/[\w/.-]+$/.test(process.env.SHELL) ? process.env.SHELL : process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh'
  return { command: shell, args: (script) => ['-l', '-c', script] }
}

function collect(limit: number) {
  const chunks: Buffer[] = []
  let size = 0
  let truncated = false
  return {
    push(chunk: Buffer) {
      if (size >= limit) { truncated = true; return }
      const slice = chunk.subarray(0, limit - size)
      if (slice.length < chunk.length) truncated = true
      chunks.push(slice)
      size += slice.length
    },
    text: () => Buffer.concat(chunks).toString('utf8'),
    get truncated() { return truncated },
  }
}

export async function runLocalExec(grant: FilesystemGrant, input: { command: string; cwd?: string; timeoutMs: number }, signal?: AbortSignal): Promise<LocalExecResult> {
  const cwd = await resolveLocalWorkingDirectory(grant, input.cwd)
  const shell = localShell()
  const startedAt = Date.now()
  const stdout = collect(LOCAL_EXEC_MAX_OUTPUT_BYTES)
  const stderr = collect(LOCAL_EXEC_MAX_OUTPUT_BYTES)
  const child = spawn(shell.command, shell.args(input.command), {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: process.env,
  })
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
  const kill = () => {
    if (child.exitCode !== null || child.pid === undefined) return
    try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL') } catch (_error) { /* already gone */ }
  }
  const timer = setTimeout(kill, input.timeoutMs)
  signal?.addEventListener('abort', kill, { once: true })
  try {
    const exitCode = await new Promise<number>((resolvePromise, reject) => {
      child.once('error', reject)
      child.once('close', (code, killedBy) => resolvePromise(code ?? (killedBy ? 128 + signalNumber(killedBy) : 1)))
    })
    const timedOut = Date.now() - startedAt >= input.timeoutMs
    return {
      stdout: stdout.text(),
      stderr: timedOut ? `${stderr.text()}\nCommand timed out after ${input.timeoutMs} ms.` : stderr.text(),
      exitCode,
      startedAt,
      endedAt: Date.now(),
      truncated: stdout.truncated || stderr.truncated,
    }
  } catch (_error) {
    throw new LocalToolFailure('exec_failed', 'The command could not be started on this Mac.')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', kill)
  }
}

function signalNumber(name: NodeJS.Signals): number {
  return ({ SIGINT: 2, SIGKILL: 9, SIGTERM: 15 } as Record<string, number>)[name] ?? 1
}

export async function readLocalFile(grant: FilesystemGrant, input: { path: string; maxBytes: number }): Promise<LocalReadFileResult> {
  const path = await resolveLocalToolPath(grant, input.path, 'read')
  const stats = await lstat(path).catch(() => null)
  if (!stats) return { found: false }
  if (!stats.isFile()) throw new LocalToolFailure('invalid_input', `${input.path} is not a file.`)
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(stats.size, input.maxBytes))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return { found: true, contentsBase64: buffer.subarray(0, bytesRead).toString('base64'), bytes: stats.size, truncated: stats.size > bytesRead }
  } finally { await handle.close() }
}

export async function writeLocalFile(grant: FilesystemGrant, input: { path: string; contentsBase64: string }): Promise<{ path: string; bytes: number }> {
  const path = await resolveLocalToolPath(grant, input.path, 'write')
  const existing = await lstat(path).catch(() => null)
  if (existing && !existing.isFile()) throw new LocalToolFailure('invalid_input', `${input.path} is not a file.`)
  const bytes = Buffer.from(input.contentsBase64, 'base64')
  await mkdir(dirname(path), { recursive: true })
  // Write beside the target and rename, so a failed write never leaves a half-written file.
  const temporary = join(dirname(path), `.${basename(path)}.overlay-${process.pid}-${Date.now()}.tmp`)
  await writeFile(temporary, bytes, { mode: existing ? existing.mode & 0o777 : 0o644 })
  await rename(temporary, path)
  return { path, bytes: bytes.length }
}

export async function listLocalFiles(grant: FilesystemGrant, input: { path: string }): Promise<LocalListFilesResult> {
  const path = await resolveLocalToolPath(grant, input.path, 'read')
  const stats = await lstat(path).catch(() => null)
  if (!stats) throw new LocalToolFailure('not_found', `No folder at ${input.path}.`)
  if (!stats.isDirectory()) throw new LocalToolFailure('invalid_input', `${input.path} is not a folder.`)
  const names = (await readdir(path)).sort().slice(0, LIST_LIMIT)
  const entries = await Promise.all(names.map(async (name) => {
    const child = join(path, name)
    const entry = await lstat(child).catch(() => null)
    const kind = !entry ? 'other' as const : entry.isDirectory() ? 'directory' as const : entry.isFile() ? 'file' as const : entry.isSymbolicLink() ? 'symlink' as const : 'other' as const
    return { path: child, kind, ...(entry?.isFile() ? { size: entry.size } : {}) }
  }))
  return { entries }
}
