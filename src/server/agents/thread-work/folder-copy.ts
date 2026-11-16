import 'server-only'

import { createHash } from 'node:crypto'
import { toCanonicalNoteMarkdown } from '@overlay/app-core/note-markdown'
import { isExcludedWorkPath, workDirectoryName } from '@/shared/agents/thread-work'
import { FileServiceError } from '@/server/files/FileServiceErrors'
import type { FileService } from '@/server/files/FileService'
import type { FolderCopyEntry, FolderCopyRecord, ThreadWorkRepository } from './ConvexThreadWorkRepository'

/**
 * Copies a chosen Overlay folder onto the computer that runs an agent thread, and saves what changed back to Files
 * when the run ends (internal/develop/thread-folders.md). Every save goes through FileService, so permissions,
 * revision checks and agent attribution match the app. A file someone changed in the app meanwhile is never
 * overwritten: the agent's version is saved beside it as a copy.
 */

/** The computer a copy is written to, reduced to what copying needs. */
export type WorkMachine = {
  target: 'cloud' | 'mac'
  environmentId?: string
  /** Copies of Overlay folders go in folders inside this one. */
  base: string
  maxFileBytes: number
  maxTotalBytes: number
  maxFiles: number
  run(script: string, cwd?: string): Promise<{ exitCode: number; stdout: string; stderr: string }>
  write(files: Array<{ path: string; contents: Uint8Array }>): Promise<void>
  read(path: string): Promise<Uint8Array | null>
}

export type FolderFiles = Pick<FileService,
  'getOrListFiles' | 'readFileBytes' | 'updateFile' | 'createFile' | 'createFileFromBytes' | 'deleteFile'>

export type FolderRun = {
  agentRunId: string; conversationId: string; workspaceId: string; userId: string; agentId: string
  agentName?: string; messageId?: string
}

export type SavedChange = { path: string; action: 'created' | 'updated' | 'deleted' | 'saved_as_copy'; fileId?: string }
export type FolderSaveSummary = {
  folderId: string
  folderName: string
  saved: SavedChange[]
  failed: Array<{ path: string; reason: string }>
  skipped: string[]
}

export type CopyInResult =
  | { folderId: string; folderName: string; root: string; copied: number; skipped: string[]; alreadyCopied?: boolean }
  | { folderId: string; folderName: string; root: string; error: string }

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const encoder = new TextEncoder()
export const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

function splitName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: '' }
}

/** The file name on the computer: notes become Markdown files, and names stay unique within a folder. */
function uniqueName(taken: Set<string>, name: string): string {
  const safe = workDirectoryName(name)
  let candidate = safe
  for (let index = 2; taken.has(candidate.toLowerCase()); index += 1) {
    const { stem, ext } = splitName(safe)
    candidate = `${stem} (${index})${ext}`
  }
  taken.add(candidate.toLowerCase())
  return candidate
}

const join = (...parts: string[]) => parts.filter(Boolean).join('/')

async function inBatches<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  for (let index = 0; index < items.length; index += size) await Promise.all(items.slice(index, index + size).map(work))
}

type PlannedFile = { path: string; fileId: string; parentId: string; kind: FolderCopyEntry['kind']; updatedAt: number; sizeBytes: number }

/** Decides every path before anything is fetched, so the copy is predictable and bounded. */
export function planFolderCopy(
  rows: Awaited<ReturnType<ThreadWorkRepository['subtree']>>['rows'],
  rootId: string,
  limits: Pick<WorkMachine, 'maxFileBytes' | 'maxTotalBytes' | 'maxFiles'>,
) {
  const directoryOf = new Map<string, string>([[rootId, '']])
  const taken = new Map<string, Set<string>>()
  const namesIn = (directory: string) => {
    let names = taken.get(directory)
    if (!names) { names = new Set(); taken.set(directory, names) }
    return names
  }
  const folders: Array<{ path: string; fileId: string }> = [{ path: '', fileId: rootId }]
  const files: PlannedFile[] = []
  const skipped: string[] = []
  let total = 0
  for (const row of rows) {
    const parent = directoryOf.get(row.parentId)
    if (parent === undefined) continue
    if (row.type === 'folder') {
      const path = join(parent, uniqueName(namesIn(parent), row.name))
      if (isExcludedWorkPath(path)) { skipped.push(path); continue }
      directoryOf.set(row.id, path)
      folders.push({ path, fileId: row.id })
      continue
    }
    const kind: FolderCopyEntry['kind'] = row.kind === 'note' ? 'note'
      : row.hasStorageObject && !row.textInObjectStore ? 'binary' : 'text'
    const name = kind === 'note' && !/\.md$/i.test(row.name) ? `${row.name}.md` : row.name
    const path = join(parent, uniqueName(namesIn(parent), name))
    const sizeBytes = row.sizeBytes ?? 0
    if (isExcludedWorkPath(path)) { skipped.push(path); continue }
    if (sizeBytes > limits.maxFileBytes || files.length >= limits.maxFiles || total + sizeBytes > limits.maxTotalBytes) {
      skipped.push(path)
      continue
    }
    total += sizeBytes
    files.push({ path, fileId: row.id, parentId: row.parentId, kind, updatedAt: row.updatedAt, sizeBytes })
  }
  return { folders, files, skipped }
}

async function readOverlayFile(files: FolderFiles, run: FolderRun, file: PlannedFile): Promise<Uint8Array | null> {
  if (file.kind === 'binary') return await files.readFileBytes({ fileId: file.fileId, userId: run.userId })
  const row = await files.getOrListFiles({ fileId: file.fileId, fullText: true, userId: run.userId, workspaceId: run.workspaceId }) as
    { content?: unknown; textContent?: unknown }
  const text = typeof row.textContent === 'string' ? row.textContent : typeof row.content === 'string' ? row.content : ''
  return encoder.encode(file.kind === 'note' ? toCanonicalNoteMarkdown(text) : text)
}

export async function copyFolderIn(args: {
  repository: ThreadWorkRepository
  files: FolderFiles
  machine: WorkMachine
  run: FolderRun
  folder: { fileId: string; name: string }
  /** The folder's name on the computer, unique among the thread's folders. */
  directoryName: string
}): Promise<CopyInResult> {
  const { repository, files, machine, run, folder } = args
  const root = join(machine.base, args.directoryName)
  const copyId = `${run.agentRunId}:${folder.fileId}`
  const base = { folderId: folder.fileId, folderName: folder.name, root }
  const started = await repository.startCopy({
    copyId, agentRunId: run.agentRunId, conversationId: run.conversationId, workspaceId: run.workspaceId,
    userId: run.userId, agentId: run.agentId,
    ...(run.agentName ? { agentName: run.agentName } : {}), ...(run.messageId ? { messageId: run.messageId } : {}),
    target: machine.target, ...(machine.environmentId ? { environmentId: machine.environmentId } : {}),
    folderId: folder.fileId, folderName: folder.name, root,
  })
  // A continuation of the same run keeps the copy it already has.
  if (!started.created && started.status !== 'copying') return { ...base, copied: 0, skipped: [], alreadyCopied: true }
  try {
    const subtree = await repository.subtree({ userId: run.userId, workspaceId: run.workspaceId, folderId: folder.fileId })
    if (subtree.truncated) throw new Error('The folder has more than 2,000 files and folders. Choose a smaller folder.')
    const plan = planFolderCopy(subtree.rows, folder.fileId, machine)
    const directories = plan.folders.map(entry => join(root, entry.path))
    const prepare = [
      `mkdir -p -- ${directories.map(quote).join(' ')}`,
    ].filter(Boolean).join(' && ')
    const prepared = await machine.run(prepare)
    if (prepared.exitCode !== 0) throw new Error(`Couldn't create the folder on the computer: ${prepared.stderr.trim().slice(0, 300)}`)
    const entries: FolderCopyEntry[] = []
    const skipped = [...plan.skipped]
    await inBatches(plan.files, 6, async (file) => {
      const contents = await readOverlayFile(files, run, file).catch((_error) => null)
      if (!contents) { skipped.push(file.path); return }
      await machine.write([{ path: join(root, file.path), contents }])
      entries.push({ path: file.path, fileId: file.fileId, parentId: file.parentId, kind: file.kind, updatedAt: file.updatedAt, sha256: sha256(contents) })
    })
    await repository.updateCopy({ copyId, status: 'copied', entries, folders: plan.folders, skipped })
    return { ...base, copied: entries.length, skipped }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await repository.updateCopy({ copyId, status: 'failed', error: message.slice(0, 1000) }).catch((_error) => undefined)
    return { ...base, error: message }
  }
}

/** Lists every file under the copy with its size and SHA-256, skipping dependency and secret folders. */
export function listingScript(): string {
  const pruned = ['node_modules', '.git', '.next', '.turbo', '.venv', 'venv', '__pycache__', '.cache', 'dist', 'build']
    .map(name => `-name ${quote(name)}`).join(' -o ')
  return [
    'if command -v sha256sum >/dev/null 2>&1; then H="sha256sum"; else H="shasum -a 256"; fi',
    `find . \\( ${pruned} \\) -prune -o -type f -print | while IFS= read -r f; do`,
    '  s=$(wc -c < "$f" | tr -d " "); h=$($H "$f" | cut -d " " -f 1)',
    '  printf "%s\\t%s\\t%s\\n" "$s" "$h" "${f#./}"',
    'done',
  ].join('\n')
}

export function parseListing(stdout: string): Map<string, { size: number; sha256: string }> {
  const listing = new Map<string, { size: number; sha256: string }>()
  for (const line of stdout.split('\n')) {
    const [size, hash, ...rest] = line.split('\t')
    const path = rest.join('\t')
    if (!path || !hash || !/^[0-9a-f]{64}$/.test(hash)) continue
    listing.set(path, { size: Number(size) || 0, sha256: hash })
  }
  return listing
}

export type FolderChanges = {
  changed: Array<{ entry: FolderCopyEntry; size: number }>
  added: Array<{ path: string; size: number }>
  deleted: FolderCopyEntry[]
}

export function diffFolderCopy(entries: FolderCopyEntry[], listing: Map<string, { size: number; sha256: string }>): FolderChanges {
  const known = new Set(entries.map(entry => entry.path))
  const changed: FolderChanges['changed'] = []
  const deleted: FolderChanges['deleted'] = []
  for (const entry of entries) {
    const current = listing.get(entry.path)
    if (!current) deleted.push(entry)
    else if (current.sha256 !== entry.sha256) changed.push({ entry, size: current.size })
  }
  const added = [...listing.entries()]
    .filter(([path]) => !known.has(path) && !isExcludedWorkPath(path) && !path.split('/').some(part => part.startsWith('.overlay-')))
    .map(([path, value]) => ({ path, size: value.size }))
  return { changed, added, deleted }
}

function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (_error) {
    return null
  }
}

const isConflict = (error: unknown) => error instanceof FileServiceError && error.statusCode === 409
const reasonOf = (error: unknown) => error instanceof FileServiceError
  ? String(error.payload.message ?? error.payload.error ?? error.message)
  : error instanceof Error ? error.message : String(error)

const MIME_BY_EXTENSION: Record<string, string> = {
  '.md': 'text/markdown', '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json', '.ts': 'text/plain',
  '.tsx': 'text/plain', '.js': 'text/plain', '.py': 'text/plain', '.yaml': 'text/plain', '.yml': 'text/plain',
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}
const mimeFor = (name: string) => MIME_BY_EXTENSION[splitName(name).ext.toLowerCase()] ?? 'application/octet-stream'

/** Saves bytes as a new file in Files: Markdown becomes a note, other text a text file, anything else a stored file. */
export async function createOverlayFile(
  files: FolderFiles,
  owner: { userId: string; workspaceId: string; scope: 'personal' | 'workspace'; byAgent: boolean },
  file: { parentId: string; name: string; bytes: Uint8Array },
): Promise<string> {
  const { userId, workspaceId, scope, byAgent } = owner
  const text = decodeText(file.bytes)
  if (text !== null && /\.md$/i.test(file.name)) {
    const created = await files.createFile({
      body: { name: file.name.replace(/\.md$/i, ''), type: 'file', kind: 'note', parentId: file.parentId, content: toCanonicalNoteMarkdown(text), scope, byAgent },
      userId, workspaceId,
    })
    return String(created.id)
  }
  if (text !== null) {
    const created = await files.createFile({
      body: { name: file.name, type: 'file', kind: 'upload', parentId: file.parentId, textContent: text, mimeType: mimeFor(file.name), scope, byAgent },
      userId, workspaceId,
    })
    return String(created.id)
  }
  const created = await files.createFileFromBytes({
    bytes: file.bytes, name: file.name, mimeType: mimeFor(file.name), parentId: file.parentId, scope, byAgent, userId, workspaceId,
  })
  return created.id
}

export async function saveFolderBack(args: {
  repository: ThreadWorkRepository
  files: FolderFiles
  machine: WorkMachine
  copy: FolderCopyRecord
  agentName: string
  scope: 'personal' | 'workspace'
}): Promise<FolderSaveSummary | null> {
  const { repository, files, machine, copy } = args
  const claim = await repository.updateCopy({ copyId: copy.copyId, expectedStatus: 'copied', status: 'saving' })
  if (!claim.updated) return null
  const summary: FolderSaveSummary = { folderId: copy.folderId, folderName: copy.folderName, saved: [], failed: [], skipped: [] }
  const run = { userId: copy.userId, workspaceId: copy.workspaceId }
  try {
    const listed = await machine.run(listingScript(), copy.root)
    if (listed.exitCode !== 0) throw new Error(`Couldn't read the folder on the computer: ${listed.stderr.trim().slice(0, 300)}`)
    const changes = diffFolderCopy(copy.entries, parseListing(listed.stdout))
    const folderIds = new Map(copy.folders.map(entry => [entry.path, entry.fileId]))
    const copyName = (name: string) => {
      const { stem, ext } = splitName(name)
      return `${stem} (${args.agentName}’s copy)${ext}`
    }

    const ensureFolder = async (directory: string): Promise<string> => {
      const existing = folderIds.get(directory)
      if (existing) return existing
      const parentPath = directory.includes('/') ? directory.slice(0, directory.lastIndexOf('/')) : ''
      const parentId = await ensureFolder(parentPath)
      const name = directory.slice(directory.lastIndexOf('/') + 1)
      const created = await files.createFile({
        body: { name, type: 'folder', kind: 'folder', parentId, scope: args.scope, byAgent: true }, ...run,
      })
      const id = String(created.id)
      folderIds.set(directory, id)
      return id
    }

    const createFrom = (_path: string, parentId: string, name: string, bytes: Uint8Array) =>
      createOverlayFile(files, { ...run, scope: args.scope, byAgent: true }, { parentId, name, bytes })

    const fits = (path: string, size: number) => {
      if (size <= machine.maxFileBytes) return true
      summary.skipped.push(path)
      return false
    }
    const budget = machine.maxFiles
    let handled = 0
    const withinBudget = (path: string) => {
      if (handled < budget) { handled += 1; return true }
      summary.skipped.push(path)
      return false
    }

    for (const { entry, size } of changes.changed) {
      if (!withinBudget(entry.path) || !fits(entry.path, size)) continue
      try {
        const bytes = await machine.read(join(copy.root, entry.path))
        if (!bytes) { summary.failed.push({ path: entry.path, reason: 'The file couldn’t be read on the computer.' }); continue }
        const fileName = entry.path.slice(entry.path.lastIndexOf('/') + 1)
        const text = entry.kind === 'binary' ? null : decodeText(bytes)
        if (text !== null) {
          try {
            await files.updateFile({
              body: { fileId: entry.fileId, ...(entry.kind === 'note' ? { content: toCanonicalNoteMarkdown(text) } : { textContent: text }), expectedUpdatedAt: entry.updatedAt, byAgent: true },
              ...run,
            })
            summary.saved.push({ path: entry.path, action: 'updated', fileId: entry.fileId })
          } catch (error) {
            if (!isConflict(error)) throw error
            const name = copyName(fileName)
            const id = await createFrom(entry.path, entry.parentId, name, bytes)
            summary.saved.push({ path: entry.path, action: 'saved_as_copy', fileId: id })
          }
          continue
        }
        // Stored files can't be edited in place: save the new version, then remove the old one if nobody changed it.
        const current = await files.getOrListFiles({ fileId: entry.fileId, ...run }) as { updatedAt?: number }
        if (current.updatedAt !== entry.updatedAt) {
          const id = await createFrom(entry.path, entry.parentId, copyName(fileName), bytes)
          summary.saved.push({ path: entry.path, action: 'saved_as_copy', fileId: id })
          continue
        }
        const id = await createFrom(entry.path, entry.parentId, fileName, bytes)
        await files.deleteFile({ fileId: entry.fileId, ...run })
        summary.saved.push({ path: entry.path, action: 'updated', fileId: id })
      } catch (error) {
        summary.failed.push({ path: entry.path, reason: reasonOf(error) })
      }
    }

    for (const { path, size } of changes.added) {
      if (!withinBudget(path) || !fits(path, size)) continue
      try {
        const bytes = await machine.read(join(copy.root, path))
        if (!bytes) { summary.failed.push({ path, reason: 'The file couldn’t be read on the computer.' }); continue }
        const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
        const parentId = await ensureFolder(directory)
        const id = await createFrom(path, parentId, path.slice(path.lastIndexOf('/') + 1), bytes)
        summary.saved.push({ path, action: 'created', fileId: id })
      } catch (error) {
        summary.failed.push({ path, reason: reasonOf(error) })
      }
    }

    for (const entry of changes.deleted) {
      if (!withinBudget(entry.path)) continue
      try {
        const current = await files.getOrListFiles({ fileId: entry.fileId, ...run }).catch((_error) => null) as { updatedAt?: number } | null
        if (!current) continue
        // Someone changed it in the app while the agent worked: keep their version.
        if (current.updatedAt !== entry.updatedAt) { summary.skipped.push(entry.path); continue }
        await files.deleteFile({ fileId: entry.fileId, ...run })
        summary.saved.push({ path: entry.path, action: 'deleted', fileId: entry.fileId })
      } catch (error) {
        summary.failed.push({ path: entry.path, reason: reasonOf(error) })
      }
    }

    await repository.updateCopy({ copyId: copy.copyId, status: 'saved', summary })
    return summary
  } catch (error) {
    const reason = reasonOf(error)
    summary.failed.push({ path: '', reason })
    await repository.updateCopy({ copyId: copy.copyId, status: 'failed', summary, error: reason.slice(0, 1000) }).catch((_error) => undefined)
    return summary
  }
}
