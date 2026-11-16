import 'server-only'

import {
  CLOUD_WORK_ROOT, MAC_WORK_FOLDER, folderLabel, isExcludedWorkPath, workDirectoryName,
  type ThreadComputer, type ThreadFolder, type ThreadWork,
} from '@/shared/agents/thread-work'
import type { FolderSavesData } from '@/shared/agents/folder-saves'
import { getOverlayServerContext } from '@/server/bootstrap'
import { computerInstanceFor } from '@/server/tools/tools/overlay-executes'
import { fileService } from '@/server/files/http'
import { logger } from '@/server/observability/logger'
import {
  getRepository, githubAppConfigured, installationToken, pullRequestsOpenedSince,
} from '@/server/integrations/github/github-app'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { ConvexThreadWorkRepository, type FolderCopyRecord, type ThreadWorkRepository } from './ConvexThreadWorkRepository'
import {
  copyFolderIn, createOverlayFile, listingScript, parseListing, quote, saveFolderBack,
  type FolderFiles, type FolderSaveSummary, type WorkMachine,
} from './folder-copy'

/**
 * Runs copy-in when an agent thread's run starts and save-back when it ends (internal/develop/thread-folders.md).
 */

const CLOUD_LIMITS = { maxFileBytes: 50 * 1024 * 1024, maxTotalBytes: 200 * 1024 * 1024, maxFiles: 1_000 }
// The Mac's host carries one file per call, up to about 480 KB.
const MAC_LIMITS = { maxFileBytes: 450 * 1024, maxTotalBytes: 20 * 1024 * 1024, maxFiles: 300 }
const OPERATION_DEADLINE_MS = 9 * 60_000
const GITHUB_DIR = '/tmp/overlay-github'

export type ThreadRun = {
  actorUserId: string
  workspaceId: string
  agentId: string
  conversationId: string
  agentRunId: string
  /** The agent's reply, where the summary card goes. */
  messageId: string
}

type Dependencies = { repository: ThreadWorkRepository; files: FolderFiles }
const defaults = (): Dependencies => ({ repository: new ConvexThreadWorkRepository(), files: fileService })

type MachineAccess =
  | { ok: true; operate<T>(work: (machine: WorkMachine) => Promise<T>): Promise<T> }
  | { ok: false; error: string }

/** The computer a thread runs on, reduced to what copying needs. Only the thread owner's own Mac is ever used. */
async function machineFor(run: Pick<ThreadRun, 'actorUserId' | 'workspaceId' | 'agentId'>, computer: ThreadComputer): Promise<MachineAccess> {
  const resolved = await computerInstanceFor({
    userId: run.actorUserId, workspaceId: run.workspaceId, agentId: run.agentId, computerApprovalContext: 'work',
    ...(computer.kind === 'mac' ? { localEnvironmentId: computer.environmentId } : {}),
  }, { target: computer.kind === 'mac' ? 'local' : 'cloud', toolName: 'folder_copy' })
  if (!resolved.ok) return { ok: false, error: resolved.error }
  let base = CLOUD_WORK_ROOT
  if (computer.kind === 'mac') {
    const mac = await getOverlayServerContext().localComputerService.findForUser({
      workspaceId: run.workspaceId, userId: run.actorUserId, environmentId: computer.environmentId,
    })
    if (!mac) return { ok: false, error: 'The Mac this thread runs on is offline.' }
    base = `${(mac.roots?.[0] ?? mac.capability.homeDirectory).replace(/\/$/, '')}/${MAC_WORK_FOLDER}`
  }
  return {
    ok: true,
    operate: (work) => resolved.operate(async (instance) => {
      const machine: WorkMachine = {
        target: computer.kind === 'mac' ? 'mac' : 'cloud',
        ...(computer.kind === 'mac' ? { environmentId: computer.environmentId } : { createBase: CLOUD_WORK_ROOT }),
        base,
        ...(computer.kind === 'mac' ? MAC_LIMITS : CLOUD_LIMITS),
        run: async (script, cwd) => await (await instance.runCommand({
          command: 'sh', args: ['-c', script], ...(cwd ? { cwd } : {}), timeoutMs: 280_000,
        })).wait(),
        write: async (files) => await instance.writeFiles(files),
        read: async (path) => await instance.readFile(path),
      }
      return await work(machine)
    }, OPERATION_DEADLINE_MS),
  }
}

/** Unique folder names on the computer, in the order the folders were chosen. */
export function directoryNames(folders: ThreadFolder[]): Map<string, string> {
  const taken = new Set<string>()
  const names = new Map<string, string>()
  for (const folder of folders) {
    if (folder.source === 'mac') continue
    const base = workDirectoryName(folderLabel(folder))
    let name = base
    for (let index = 2; taken.has(name.toLowerCase()); index += 1) name = `${base} (${index})`
    taken.add(name.toLowerCase())
    names.set(folder.source === 'overlay' ? folder.fileId : folder.repository, name)
  }
  return names
}

/** Where the agent finds each chosen folder. The Mac's copy folder is only known once the Mac is reached. */
export function folderLocation(folder: ThreadFolder, computer: ThreadComputer, names: Map<string, string>, macBase?: string): string {
  if (folder.source === 'mac') return folder.path
  const name = names.get(folder.source === 'overlay' ? folder.fileId : folder.repository) ?? folderLabel(folder)
  if (computer.kind === 'mac') return `${macBase ?? `<first approved folder>/${MAC_WORK_FOLDER}`}/${name}`
  return `${CLOUD_WORK_ROOT}/${name}`
}

async function workspaceInstallations(workspaceId: string): Promise<Set<number>> {
  const rows = await convex.query<Array<{ installationId: number }>>('integrations/githubInstallations:listByServer', {
    serverSecret: getInternalApiSecret(), workspaceId,
  }, { throwOnError: true }) ?? []
  return new Set(rows.map(row => row.installationId))
}

/** Each installation's token goes to a file only git's helper reads; it expires on its own within an hour. */
function credentialHelper(): string {
  return [
    '#!/bin/sh',
    '[ "$1" = get ] || exit 0',
    'path=""',
    'while IFS= read -r line; do [ -z "$line" ] && break; case "$line" in path=*) path="${line#path=}";; esac; done',
    'owner="${path%%/*}"',
    `[ -f "${GITHUB_DIR}/$owner.token" ] || exit 0`,
    'echo username=x-access-token',
    `echo "password=$(cat "${GITHUB_DIR}/$owner.token")"`,
  ].join('\n') + '\n'
}

async function cloneRepositories(machine: WorkMachine, run: ThreadRun, folders: Array<Extract<ThreadFolder, { source: 'github' }>>, names: Map<string, string>, agentName: string): Promise<string[]> {
  if (folders.length === 0) return []
  if (!githubAppConfigured()) return folders.map(folder => `${folder.repository}: the GitHub App isn't set up on this Overlay server, so it wasn't cloned.`)
  const allowed = await workspaceInstallations(run.workspaceId)
  const notes: string[] = []
  const encoder = new TextEncoder()
  const made = await machine.run(`mkdir -p ${GITHUB_DIR} && chmod 700 ${GITHUB_DIR}`)
  if (made.exitCode !== 0) return folders.map(folder => `${folder.repository}: couldn't set up git on the computer.`)
  await machine.write([{ path: `${GITHUB_DIR}/credential-helper`, contents: encoder.encode(credentialHelper()) }])
  const setup = await machine.run([
    `chmod 700 ${GITHUB_DIR}/credential-helper`,
    `git config --global credential.https://github.com.helper ${quote(`${GITHUB_DIR}/credential-helper`)}`,
    'git config --global credential.https://github.com.useHttpPath true',
  ].join(' && '))
  if (setup.exitCode !== 0) return folders.map(folder => `${folder.repository}: couldn't set up git on the computer.`)
  for (const folder of folders) {
    try {
      if (!allowed.has(folder.installationId)) throw new Error('its GitHub installation is no longer connected to this workspace')
      const [owner, repo] = folder.repository.split('/')
      const { token } = await installationToken(folder.installationId, [repo!])
      const { defaultBranch } = await getRepository(token, folder.repository)
      await machine.write([{ path: `${GITHUB_DIR}/${owner}.token`, contents: encoder.encode(token) }])
      const directory = `${CLOUD_WORK_ROOT}/${names.get(folder.repository)}`
      const cloned = await machine.run([
        `sudo -n mkdir -p ${CLOUD_WORK_ROOT} && sudo -n chown "$(id -u):$(id -g)" ${CLOUD_WORK_ROOT}`,
        `chmod 600 ${quote(`${GITHUB_DIR}/${owner}.token`)}`,
        `if [ -d ${quote(`${directory}/.git`)} ]; then git -C ${quote(directory)} fetch --quiet origin; else git clone --quiet https://github.com/${folder.repository}.git ${quote(directory)}; fi`,
        `git -C ${quote(directory)} config user.name ${quote(`${agentName} (Overlay)`)}`,
        `git -C ${quote(directory)} config user.email 'agent@getoverlay.io'`,
      ].join(' && '))
      if (cloned.exitCode !== 0) throw new Error(cloned.stderr.trim().slice(0, 300) || 'git clone failed')
      notes.push(`${folder.repository} is cloned at ${directory} (default branch ${defaultBranch}). git push works with the run's token; to open a pull request, call the GitHub API with the token in ${GITHUB_DIR}/${owner}.token.`)
    } catch (error) {
      notes.push(`${folder.repository} couldn't be cloned: ${error instanceof Error ? error.message : String(error)}.`)
    }
  }
  return notes
}

/**
 * Copies the thread's Overlay folders onto its computer and clones its repositories. Returns a short note for the
 * agent with what happened, or an empty string when the thread chose no folders.
 */
export async function prepareThreadWork(args: { run: ThreadRun; work: ThreadWork; agentName: string }, dependencies = defaults()): Promise<string> {
  const { run, work } = args
  const overlay = work.folders.filter((folder): folder is Extract<ThreadFolder, { source: 'overlay' }> => folder.source === 'overlay')
  const github = work.folders.filter((folder): folder is Extract<ThreadFolder, { source: 'github' }> => folder.source === 'github')
  if (overlay.length === 0 && github.length === 0) return ''
  const computer = work.computer ?? { kind: 'cloud' as const }
  const access = await machineFor(run, computer)
  if (!access.ok) return `Folder setup: the chosen folders couldn't be put on the computer. ${access.error}`
  const names = directoryNames(work.folders)
  try {
    return await access.operate(async (machine) => {
      const lines: string[] = []
      for (const folder of overlay) {
        const result = await copyFolderIn({
          ...dependencies, machine,
          run: {
            agentRunId: run.agentRunId, conversationId: run.conversationId, workspaceId: run.workspaceId,
            userId: run.actorUserId, agentId: run.agentId, agentName: args.agentName, messageId: run.messageId,
          },
          folder: { fileId: folder.fileId, name: folder.name }, directoryName: names.get(folder.fileId) ?? folder.name,
        })
        if ('error' in result) lines.push(`${folder.name} couldn't be copied: ${result.error}`)
        else if (result.alreadyCopied) lines.push(`${folder.name} is already copied at ${result.root}.`)
        else lines.push(`${folder.name} is copied at ${result.root} (${result.copied} files${result.skipped.length ? `; not copied: ${result.skipped.slice(0, 10).join(', ')}${result.skipped.length > 10 ? ', …' : ''}` : ''}).`)
      }
      if (computer.kind === 'cloud') lines.push(...await cloneRepositories(machine, run, github, names, args.agentName))
      return lines.length ? `Folder setup for this run:\n${lines.map(line => `- ${line}`).join('\n')}` : ''
    })
  } catch (error) {
    logger.warn('[thread-work] copy-in failed', { agentRunId: run.agentRunId, error: error instanceof Error ? error.message : String(error) })
    return `Folder setup: the chosen folders couldn't be put on the computer (${error instanceof Error ? error.message : String(error)}).`
  }
}

async function folderScope(files: FolderFiles, copy: FolderCopyRecord): Promise<'personal' | 'workspace'> {
  const folder = await files.getOrListFiles({ fileId: copy.folderId, userId: copy.userId, workspaceId: copy.workspaceId })
    .catch((_error) => null) as { scope?: string } | null
  return folder?.scope === 'workspace' ? 'workspace' : 'personal'
}

async function pullRequestsFor(run: ThreadRun, work: ThreadWork | null, since: number): Promise<FolderSavesData['pullRequests']> {
  const github = (work?.folders ?? []).filter((folder): folder is Extract<ThreadFolder, { source: 'github' }> => folder.source === 'github')
  if (github.length === 0 || !githubAppConfigured() || work?.computer?.kind === 'mac') return []
  const found: FolderSavesData['pullRequests'] = []
  for (const folder of github) {
    try {
      const { token } = await installationToken(folder.installationId, [folder.repository.split('/')[1]!])
      for (const pull of await pullRequestsOpenedSince(token, folder.repository, since)) found.push({ repository: folder.repository, ...pull })
    } catch (_error) {
      // A missing pull request list only leaves the card shorter.
    }
  }
  return found
}

/**
 * Saves every folder copied for a run back to Files, then shows what went back as a card on the agent's reply.
 * Safe to call more than once: each copy is claimed once.
 */
export async function saveThreadWork(args: {
  run: ThreadRun
  runStartedAt: number
  agentName?: string
}, dependencies = defaults()): Promise<FolderSavesData | null> {
  const { run } = args
  const copies = (await dependencies.repository.listCopies(run.agentRunId)).filter(copy => copy.status === 'copied')
  const work = await dependencies.repository.getWork(run.conversationId).catch((_error) => null)
  const folders: FolderSaveSummary[] = []
  const groups = new Map<string, FolderCopyRecord[]>()
  for (const copy of copies) {
    const key = copy.target === 'mac' ? `mac:${copy.environmentId}` : 'cloud'
    groups.set(key, [...groups.get(key) ?? [], copy])
  }
  for (const [key, group] of groups) {
    const computer: ThreadComputer = key === 'cloud' ? { kind: 'cloud' } : { kind: 'mac', environmentId: key.slice(4) }
    const first = group[0]!
    const access = await machineFor({ actorUserId: first.userId, workspaceId: first.workspaceId, agentId: first.agentId }, computer)
    if (!access.ok) {
      for (const copy of group) folders.push({ folderId: copy.folderId, folderName: copy.folderName, saved: [], skipped: [], failed: [{ path: '', reason: access.error }] })
      continue
    }
    try {
      await access.operate(async (machine) => {
        for (const copy of group) {
          const summary = await saveFolderBack({
            ...dependencies, machine, copy, agentName: args.agentName ?? copy.agentName ?? 'Agent',
            scope: await folderScope(dependencies.files, copy),
          })
          if (summary) folders.push(summary)
        }
        if (computer.kind === 'cloud') await machine.run(`rm -rf ${GITHUB_DIR}`).catch((_error) => undefined)
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      for (const copy of group) folders.push({ folderId: copy.folderId, folderName: copy.folderName, saved: [], skipped: [], failed: [{ path: '', reason }] })
    }
  }
  const pullRequests = await pullRequestsFor(run, work, args.runStartedAt)
  if (folders.length === 0 && pullRequests.length === 0) return null
  const data: FolderSavesData = { version: 1, folders, pullRequests }
  await dependencies.repository.attachSummary({ conversationId: run.conversationId, messageId: run.messageId, data })
    .catch((error) => logger.warn('[thread-work] summary card failed', { error: error instanceof Error ? error.message : String(error) }))
  return data
}


/**
 * Saves a stopped run's folders: Stop cancels the workflow before its own save step, so the stop route calls this.
 * Uses only what the copy records hold.
 */
export async function saveThreadWorkForRun(agentRunId: string, dependencies = defaults()): Promise<void> {
  const copies = (await dependencies.repository.listCopies(agentRunId)).filter(copy => copy.status === 'copied')
  const first = copies[0]
  if (!first?.messageId) return
  await saveThreadWork({
    run: {
      actorUserId: first.userId, workspaceId: first.workspaceId, agentId: first.agentId,
      conversationId: first.conversationId, agentRunId, messageId: first.messageId,
    },
    runStartedAt: first.createdAt,
    ...(first.agentName ? { agentName: first.agentName } : {}),
  }, dependencies)
}

/**
 * Copies a folder on one of the person's own Macs into Overlay Files, once, so cloud agents can use it
 * (internal/develop/thread-folders.md). Dependency folders, build output and `.env` files are never uploaded.
 */
export async function copyMacFolderToFiles(args: {
  userId: string
  workspaceId: string
  environmentId: string
  path: string
  scope: 'personal' | 'workspace'
}, dependencies = defaults()): Promise<{ folderId: string; copied: number; skipped: string[] }> {
  const path = args.path.replace(/\/+$/, '')
  if (!path.startsWith('/') || path.length > 1024) throw new ThreadWorkError('invalid_path', 'Choose a folder by its full path.')
  const access = await machineFor({ actorUserId: args.userId, workspaceId: args.workspaceId, agentId: '' }, { kind: 'mac', environmentId: args.environmentId })
  if (!access.ok) throw new ThreadWorkError('mac_unavailable', access.error)
  return await access.operate(async (machine) => {
    const listed = await machine.run(listingScript(), path)
    if (listed.exitCode !== 0) throw new ThreadWorkError('folder_unavailable', 'That folder couldn’t be read on the Mac. Check that it is one of the Mac’s approved folders.')
    const listing = [...parseListing(listed.stdout).entries()].filter(([relative]) => !isExcludedWorkPath(relative))
    const name = workDirectoryName(path.slice(path.lastIndexOf('/') + 1))
    const run = { userId: args.userId, workspaceId: args.workspaceId }
    const root = await dependencies.files.createFile({ body: { name, type: 'folder', kind: 'folder', scope: args.scope }, ...run })
    const folderIds = new Map<string, string>([['', String(root.id)]])
    const ensureFolder = async (directory: string): Promise<string> => {
      const existing = folderIds.get(directory)
      if (existing) return existing
      const parent = directory.includes('/') ? directory.slice(0, directory.lastIndexOf('/')) : ''
      const parentId = await ensureFolder(parent)
      const created = await dependencies.files.createFile({
        body: { name: directory.slice(directory.lastIndexOf('/') + 1), type: 'folder', kind: 'folder', parentId, scope: args.scope }, ...run,
      })
      folderIds.set(directory, String(created.id))
      return String(created.id)
    }
    const skipped: string[] = []
    let copied = 0
    let total = 0
    for (const [relative, { size }] of listing) {
      if (copied >= machine.maxFiles || size > machine.maxFileBytes || total + size > machine.maxTotalBytes) { skipped.push(relative); continue }
      const bytes = await machine.read(`${path}/${relative}`)
      if (!bytes) { skipped.push(relative); continue }
      const directory = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : ''
      await createOverlayFile(dependencies.files, { ...run, scope: args.scope, byAgent: false }, {
        parentId: await ensureFolder(directory), name: relative.slice(relative.lastIndexOf('/') + 1), bytes,
      })
      copied += 1
      total += size
    }
    return { folderId: String(root.id), copied, skipped }
  })
}

export class ThreadWorkError extends Error {
  constructor(readonly code: 'invalid_path' | 'mac_unavailable' | 'folder_unavailable', message: string) {
    super(message)
    this.name = 'ThreadWorkError'
  }
}
