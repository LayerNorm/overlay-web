import { lstat, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { FilesystemGrant } from '@layernorm/overlay-agent-bridge-protocol'
import { LocalToolFailure } from './local-tools-errors.js'

/** The directory relative paths resolve against: the first approved root, or home for an all-files grant. */
export function localToolsBaseDirectory(grant: FilesystemGrant): string {
  return grant.mode === 'all_user_files' ? homedir() : resolve(expandHome(grant.roots[0]!))
}

export function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2))
  return path
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

async function realRoots(grant: Extract<FilesystemGrant, { mode: 'selected_roots' }>): Promise<string[]> {
  const roots: string[] = []
  for (const root of grant.roots) {
    try { roots.push(await realpath(resolve(expandHome(root)))) } catch (_error) { /* a removed root grants nothing */ }
  }
  return roots
}

/**
 * Real location of a path that may not exist yet: the nearest existing
 * ancestor is resolved through symlinks and the missing tail is appended, so a
 * write into a new folder is checked against where it will actually land.
 */
async function realLocation(path: string): Promise<string> {
  let current = path
  for (;;) {
    try { return resolve(await realpath(current), relative(current, path)) } catch (error) {
      const parent = dirname(current)
      if (parent === current || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      current = parent
    }
  }
}

/**
 * Resolves a model-supplied path and enforces the approved roots. Symlinks are
 * followed before the check, so a link inside a root cannot reach outside it.
 * Approved roots are a scope, not an operating-system sandbox.
 */
export async function resolveLocalToolPath(grant: FilesystemGrant, input: string, mode: 'read' | 'write'): Promise<string> {
  const absolute = resolve(localToolsBaseDirectory(grant), expandHome(input))
  if (grant.mode === 'all_user_files') return absolute
  const roots = await realRoots(grant)
  void mode
  const real = await realLocation(absolute)
  if (!roots.some((root) => isWithin(root, real))) throw outside(input)
  return real
}

function outside(path: string) {
  return new LocalToolFailure('outside_approved_folders',
    `${path} is outside the folders approved for Overlay on this computer. Use a path inside an approved folder, or ask the user to add this folder in Settings → Desktop.`)
}

/** A working directory must exist and be a directory inside the grant. */
export async function resolveLocalWorkingDirectory(grant: FilesystemGrant, input: string | undefined): Promise<string> {
  const path = await resolveLocalToolPath(grant, input ?? localToolsBaseDirectory(grant), 'read')
  const stats = await lstat(path).catch(() => null)
  if (!stats?.isDirectory()) throw new LocalToolFailure('invalid_input', `${input ?? path} is not a folder on this computer.`)
  return path
}
