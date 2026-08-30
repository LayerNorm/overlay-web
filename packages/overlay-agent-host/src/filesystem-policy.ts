import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { FilesystemGrant } from '@layernorm/agent-bridge-protocol'

export type ResolvedFilesystemScope = {
  workingDirectory: string
  additionalDirectories: string[]
}

export async function resolveFilesystemScope(grant: FilesystemGrant, requestedDirectory: string): Promise<ResolvedFilesystemScope> {
  if (!isAbsolute(requestedDirectory)) throw new Error('working directory must be an absolute path')
  const workingDirectory = await realpath(requestedDirectory)
  if (grant.mode === 'all_user_files') return { workingDirectory, additionalDirectories: [] }

  const roots = await Promise.all(grant.roots.map(async (root) => {
    if (!isAbsolute(root)) throw new Error(`filesystem root must be absolute: ${root}`)
    return realpath(resolve(root))
  }))
  if (!roots.some((root) => isWithin(root, workingDirectory))) {
    throw new Error('working directory is outside the environment filesystem grant')
  }
  return { workingDirectory, additionalDirectories: roots.filter((root) => root !== workingDirectory) }
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}
