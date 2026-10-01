import 'server-only'

import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import type { SandboxInstance } from '@overlay/sandbox-runtime'

/**
 * Host-driven sync between an agent's sandbox and the Overlay workspace file
 * system. Before a turn the actor's workspace files are written into
 * `<workDir>/overlay` (the mirror is rebuilt each turn, so nothing from
 * another person's turn survives in it); after the turn, files the agent
 * changed or created there are saved back. Overlay stays the source of truth:
 * no storage credentials enter the sandbox, and deleting a mirrored file does
 * not delete it in Overlay.
 */

export const OVERLAY_MIRROR_DIRNAME = 'overlay'
const MANIFEST_NAME = '.overlay-sync.json'
const COMMAND_TIMEOUT_MS = 60_000
const WRITE_BATCH = 25
const READ_CONCURRENCY = 8

export const SANDBOX_SYNC_LIMITS = {
  maxFiles: 2_000,
  maxTotalBytes: 100 * 1024 * 1024,
  maxFileBytes: 25 * 1024 * 1024,
  maxPushFiles: 500,
  /** New files up to this size that decode as UTF-8 are saved as text files (large text lives in object storage). */
  maxTextFileBytes: 10 * 1024 * 1024,
}

export type WorkspaceFileNode = {
  fileId: string
  name: string
  type: 'file' | 'folder'
  kind: 'note' | 'upload' | 'output' | 'folder'
  parentId: string | null
  updatedAt: number
  sizeBytes?: number
  hasText: boolean
  hasBinary: boolean
}

export type SyncMode = 'note' | 'text' | 'binary'

/** How the sync reads and writes the workspace (the actor's view of it). */
export interface WorkspaceFileSource {
  listTree(): Promise<WorkspaceFileNode[]>
  readText(node: WorkspaceFileNode): Promise<string>
  readBinary(node: WorkspaceFileNode): Promise<Uint8Array | null>
  updateText(file: { fileId: string; mode: 'note' | 'text' }, text: string, expectedUpdatedAt: number): Promise<'ok' | 'conflict'>
  createFolder(name: string, parentId: string | null): Promise<string>
  createTextFile(name: string, parentId: string | null, text: string): Promise<string>
  createBinaryFile(name: string, parentId: string | null, bytes: Uint8Array): Promise<string>
}

type ManifestEntry = { fileId: string; mode: SyncMode; updatedAt: number; sha256: string }
type Manifest = {
  version: 1
  syncedAt: number
  folders: Record<string, string>
  files: Record<string, ManifestEntry>
}

export type PlannedFile = { relPath: string; node: WorkspaceFileNode; mode: SyncMode }
export type MirrorPlan = { folders: Array<{ relDir: string; folderId: string }>; files: PlannedFile[] }

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function safeSegment(name: string): string {
  const cleaned = name.replace(/[/\\\0]/g, '_').replace(/[\r\n]/g, ' ').trim().slice(0, 200)
  return !cleaned || cleaned === '.' || cleaned === '..' ? '_' : cleaned
}

function uniqueIn(taken: Set<string>, name: string): string {
  if (!taken.has(name.toLowerCase())) {
    taken.add(name.toLowerCase())
    return name
  }
  const extension = posix.extname(name)
  const stem = extension ? name.slice(0, -extension.length) : name
  for (let index = 2; ; index += 1) {
    const candidate = `${stem} (${index})${extension}`
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase())
      return candidate
    }
  }
}

function modeFor(node: WorkspaceFileNode): SyncMode | null {
  if (node.kind === 'note') return 'note'
  // An upload keeps its original bytes even when text was extracted from it.
  if (node.hasBinary) return 'binary'
  if (node.hasText) return 'text'
  return null
}

/** Lays the workspace tree out as mirror paths: notes become `.md`, names are made path-safe and unique. */
export function planMirror(nodes: readonly WorkspaceFileNode[]): MirrorPlan {
  const folderIds = new Set(nodes.filter((node) => node.type === 'folder').map((node) => node.fileId))
  const children = new Map<string | null, WorkspaceFileNode[]>()
  for (const node of nodes) {
    const parent = node.parentId && folderIds.has(node.parentId) ? node.parentId : null
    children.set(parent, [...(children.get(parent) ?? []), node])
  }
  const plan: MirrorPlan = { folders: [], files: [] }
  const visit = (parentId: string | null, relDir: string, seen: Set<string>) => {
    const taken = new Set<string>()
    const entries = [...(children.get(parentId) ?? [])].sort((a, b) => a.name.localeCompare(b.name) || a.fileId.localeCompare(b.fileId))
    for (const node of entries) {
      if (node.type === 'folder') {
        if (seen.has(node.fileId)) continue
        const relFolder = posix.join(relDir, uniqueIn(taken, safeSegment(node.name)))
        plan.folders.push({ relDir: relFolder, folderId: node.fileId })
        visit(node.fileId, relFolder, new Set([...seen, node.fileId]))
        continue
      }
      const mode = modeFor(node)
      if (!mode) continue
      let name = safeSegment(node.name)
      if (mode === 'note' && !/\.md$/i.test(name)) name = `${name}.md`
      plan.files.push({ relPath: posix.join(relDir, uniqueIn(taken, name)), node, mode })
    }
  }
  visit(null, '', new Set())
  return plan
}

async function run(instance: SandboxInstance, command: string, args: string[]): Promise<string> {
  const handle = await instance.runCommand({ command, args, timeoutMs: COMMAND_TIMEOUT_MS })
  const result = await handle.wait()
  if (result.exitCode !== 0) throw new Error(`${command} exited ${result.exitCode}: ${result.stderr.slice(0, 500)}`)
  return result.stdout
}

/** The absolute mirror directory for a harness working directory (resolved like the harness: from the sandbox's `pwd`). */
export async function resolveMirrorRoot(instance: SandboxInstance, workDir: string): Promise<string> {
  const home = (await run(instance, 'pwd', [])).trim()
  return posix.join(home, workDir.replace(/^\/+/, ''), OVERLAY_MIRROR_DIRNAME)
}

async function mapConcurrent<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index]!)
    }
  }))
  return results
}

export type PullSummary = { files: number; bytes: number; skipped: number }

export async function pullWorkspaceIntoSandbox(args: {
  instance: SandboxInstance
  root: string
  source: WorkspaceFileSource
  now?: number
}): Promise<PullSummary> {
  const plan = planMirror(await args.source.listTree())
  // Rebuilt from scratch every turn: the mirror only ever holds this actor's files.
  await run(args.instance, 'sh', ['-c', 'rm -rf -- "$1" && mkdir -p -- "$1"', 'sh', args.root])
  if (plan.folders.length > 0) {
    await run(args.instance, 'sh', ['-c', 'cd -- "$1" && shift && mkdir -p -- "$@"', 'sh', args.root, ...plan.folders.map((folder) => folder.relDir)])
  }

  let totalBytes = 0
  let skipped = 0
  // Budget on recorded sizes before reading anything, so a large workspace
  // never loads more than the limits into memory.
  let estimatedBytes = 0
  const candidates = plan.files.filter((file) => {
    const size = file.node.sizeBytes ?? 0
    const fits = size <= SANDBOX_SYNC_LIMITS.maxFileBytes
      && estimatedBytes + size <= SANDBOX_SYNC_LIMITS.maxTotalBytes
    if (fits) estimatedBytes += size
    return fits
  }).slice(0, SANDBOX_SYNC_LIMITS.maxFiles)
  skipped += plan.files.length - candidates.length
  const contents = await mapConcurrent(candidates, READ_CONCURRENCY, async (file) => {
    try {
      if (file.mode === 'binary') return await args.source.readBinary(file.node)
      return new TextEncoder().encode(await args.source.readText(file.node))
    } catch (_error) {
      return null
    }
  })

  const manifest: Manifest = {
    version: 1,
    syncedAt: args.now ?? Date.now(),
    folders: Object.fromEntries(plan.folders.map((folder) => [folder.relDir, folder.folderId])),
    files: {},
  }
  const writes: Array<{ path: string; contents: Uint8Array }> = []
  candidates.forEach((file, index) => {
    const bytes = contents[index]
    if (!bytes || bytes.byteLength > SANDBOX_SYNC_LIMITS.maxFileBytes || totalBytes + bytes.byteLength > SANDBOX_SYNC_LIMITS.maxTotalBytes) {
      skipped += 1
      return
    }
    totalBytes += bytes.byteLength
    writes.push({ path: posix.join(args.root, file.relPath), contents: bytes })
    manifest.files[file.relPath] = { fileId: file.node.fileId, mode: file.mode, updatedAt: file.node.updatedAt, sha256: sha256(bytes) }
  })
  for (let index = 0; index < writes.length; index += WRITE_BATCH) {
    await args.instance.writeFiles(writes.slice(index, index + WRITE_BATCH))
  }
  await args.instance.writeFiles([{
    path: posix.join(args.root, MANIFEST_NAME),
    contents: new TextEncoder().encode(JSON.stringify(manifest)),
  }])
  return { files: writes.length, bytes: totalBytes, skipped }
}

function decodeText(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.includes('\0') ? null : text
  } catch (_error) {
    return null
  }
}

function withSuffix(relPath: string, suffix: string): string {
  const extension = posix.extname(relPath)
  const base = posix.basename(relPath, extension)
  return `${base} (${suffix})${extension}`
}

/** Parses `sha256sum` output; names it had to escape (newlines, backslashes) are skipped. */
export function parseSha256sum(output: string): Map<string, string> {
  const hashes = new Map<string, string>()
  for (const line of output.split('\n')) {
    const match = /^([0-9a-f]{64}) [ *]\.\/(.+)$/.exec(line)
    if (match) hashes.set(match[2]!, match[1]!)
  }
  return hashes
}

export type PushSummary = {
  updated: number
  created: number
  conflictCopies: number
  unchanged: number
  deletedInSandbox: number
  skipped: number
}

export async function pushSandboxChangesToWorkspace(args: {
  instance: SandboxInstance
  root: string
  source: WorkspaceFileSource
}): Promise<PushSummary | null> {
  const manifestBytes = await args.instance.readFile(posix.join(args.root, MANIFEST_NAME)).catch((_error) => null)
  if (!manifestBytes) return null
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest
  const maxKiB = Math.floor(SANDBOX_SYNC_LIMITS.maxFileBytes / 1024)
  const listing = await run(args.instance, 'sh', [
    '-c',
    `cd -- "$1" 2>/dev/null || exit 0; find . -type f ! -path './${MANIFEST_NAME}' -size -${maxKiB + 1}k -print0 | xargs -0 -r sha256sum`,
    'sh',
    args.root,
  ])
  const hashes = parseSha256sum(listing)
  const summary: PushSummary = { updated: 0, created: 0, conflictCopies: 0, unchanged: 0, deletedInSandbox: 0, skipped: 0 }
  summary.deletedInSandbox = Object.keys(manifest.files).filter((relPath) => !hashes.has(relPath)).length

  const changed = [...hashes.entries()]
    .filter(([relPath, hash]) => {
      const same = manifest.files[relPath]?.sha256 === hash
      if (same) summary.unchanged += 1
      return !same
    })
    .map(([relPath]) => relPath)
    .sort()
  const work = changed.slice(0, SANDBOX_SYNC_LIMITS.maxPushFiles)
  summary.skipped += changed.length - work.length

  const folderIds = new Map<string, string | null>([['', null], ...Object.entries(manifest.folders)])
  const ensureFolder = async (relDir: string): Promise<string | null> => {
    const normalized = relDir === '.' ? '' : relDir
    if (folderIds.has(normalized)) return folderIds.get(normalized) ?? null
    const parentId = await ensureFolder(posix.dirname(normalized))
    const id = await args.source.createFolder(posix.basename(normalized), parentId)
    folderIds.set(normalized, id)
    return id
  }
  const createNew = async (relPath: string, bytes: Uint8Array, name = posix.basename(relPath)): Promise<ManifestEntry> => {
    const parentId = await ensureFolder(posix.dirname(relPath))
    const text = bytes.byteLength <= SANDBOX_SYNC_LIMITS.maxTextFileBytes ? decodeText(bytes) : null
    const fileId = text !== null
      ? await args.source.createTextFile(name, parentId, text)
      : await args.source.createBinaryFile(name, parentId, bytes)
    return { fileId, mode: text !== null ? 'text' : 'binary', updatedAt: 0, sha256: sha256(bytes) }
  }
  // What was saved is recorded as it goes, so a retried sync does not save it twice.
  const saved = (relPath: string, entry: ManifestEntry) => { manifest.files[relPath] = entry }

  for (const relPath of work) {
    try {
      const bytes = await args.instance.readFile(posix.join(args.root, relPath))
      if (!bytes) {
        summary.skipped += 1
        continue
      }
      const entry = manifest.files[relPath]
      if (!entry) {
        saved(relPath, await createNew(relPath, bytes))
        summary.created += 1
        continue
      }
      const text = entry.mode === 'binary' ? null : decodeText(bytes)
      if (text !== null) {
        const outcome = await args.source.updateText({ fileId: entry.fileId, mode: entry.mode as 'note' | 'text' }, text, entry.updatedAt)
        if (outcome === 'ok') {
          saved(relPath, { ...entry, sha256: sha256(bytes) })
          summary.updated += 1
          continue
        }
      }
      // Changed in Overlay meanwhile, a binary original, or no longer text:
      // keep both versions rather than overwrite anything.
      await createNew(relPath, bytes, withSuffix(relPath, 'agent copy'))
      saved(relPath, { ...entry, sha256: sha256(bytes) })
      summary.conflictCopies += 1
    } catch (_error) {
      summary.skipped += 1
    }
  }
  await args.instance.writeFiles([{
    path: posix.join(args.root, MANIFEST_NAME),
    contents: new TextEncoder().encode(JSON.stringify(manifest)),
  }]).catch((_error) => undefined)
  return summary
}

export function sandboxSyncInstructions(): string {
  return [
    'Overlay files',
    `The user's Overlay workspace files are mirrored into ./${OVERLAY_MIRROR_DIRNAME} in your working directory at the start of this turn (notes as .md files). ` +
      'When the turn ends, files you change or create there are saved back to Overlay: edits update the original, new files are created, ' +
      'and a file edited in Overlay meanwhile is saved as an "(agent copy)" instead of overwriting it. Deleting a file there does not delete it in Overlay. ' +
      'Put anything the user should keep in that folder.',
  ].join('\n')
}
