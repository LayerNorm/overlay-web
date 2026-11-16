/**
 * Where an agent thread works: the computer that runs it and the folders chosen for it
 * (internal/develop/thread-folders.md). Chosen Overlay folders are copied onto the computer when a run
 * starts and changes are saved back when it ends; GitHub repositories are cloned; Mac folders are used in place.
 */

/** The agent's cloud Computer, or one of the thread owner's own Macs. Never a teammate's Mac. */
export type ThreadComputer = { kind: 'cloud' } | { kind: 'mac'; environmentId: string }

export type ThreadFolder =
  | { source: 'overlay'; fileId: string; name: string }
  | { source: 'github'; repository: string; installationId: number }
  | { source: 'mac'; environmentId: string; path: string }

export type ThreadWork = { computer?: ThreadComputer; folders: ThreadFolder[] }

export const THREAD_WORK_MAX_FOLDERS = 5

/** Cloud Computers keep copies and clones here. */
export const CLOUD_WORK_ROOT = '/workspace'

/** On a Mac, copies of Overlay folders go in this folder inside the first approved folder. */
export const MAC_WORK_FOLDER = 'Overlay Files'

const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/

export function isValidRepository(value: string): boolean {
  return REPOSITORY.test(value) && !value.split('/').some((part) => part === '.' || part === '..')
}

/** A folder or repository name that is safe as one path segment on any computer. */
export function workDirectoryName(name: string): string {
  const cleaned = name.normalize('NFC').replace(/[\\/:\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim().slice(0, 120)
  return cleaned || 'folder'
}

export function folderKey(folder: ThreadFolder): string {
  if (folder.source === 'overlay') return `overlay:${folder.fileId}`
  if (folder.source === 'github') return `github:${folder.repository.toLowerCase()}`
  return `mac:${folder.environmentId}:${folder.path}`
}

export function folderLabel(folder: ThreadFolder): string {
  if (folder.source === 'overlay') return folder.name
  if (folder.source === 'github') return folder.repository.split('/')[1] ?? folder.repository
  return folder.path.split('/').filter(Boolean).pop() ?? folder.path
}

/**
 * The computer a thread's folders allow. A Mac folder pins the thread to its Mac, and GitHub repositories are cloned
 * only on cloud Computers. Returns why the combination can't run, or null when it can.
 */
export function threadWorkProblem(work: ThreadWork): string | null {
  if (work.folders.length > THREAD_WORK_MAX_FOLDERS) return `A thread can use at most ${THREAD_WORK_MAX_FOLDERS} folders.`
  const keys = new Set(work.folders.map(folderKey))
  if (keys.size !== work.folders.length) return 'A folder is listed twice.'
  const macFolders = work.folders.filter((folder) => folder.source === 'mac')
  const macs = new Set(macFolders.map((folder) => folder.environmentId))
  if (macs.size > 1) return 'Folders from two different Macs can’t be used in one thread.'
  const computer = work.computer ?? { kind: 'cloud' as const }
  if (macFolders.length > 0 && (computer.kind !== 'mac' || !macs.has(computer.environmentId))) {
    return 'A folder on a Mac can only be used by a thread that runs on that Mac.'
  }
  if (computer.kind === 'mac' && work.folders.some((folder) => folder.source === 'github')) {
    return 'GitHub repositories are cloned on cloud Computers. Choose the cloud Computer, or work in your own clone on the Mac.'
  }
  for (const folder of work.folders) {
    if (folder.source === 'github' && !isValidRepository(folder.repository)) return 'That repository name isn’t valid.'
    if (folder.source === 'mac' && (!folder.path.startsWith('/') || folder.path.length > 1024)) return 'Mac folders need a full path.'
    if (folder.source === 'overlay' && (!folder.fileId || !folder.name.trim())) return 'That folder isn’t valid.'
  }
  return null
}

/** Picking a Mac folder moves the thread to that Mac; picking the cloud drops folders that only exist on a Mac. */
export function applyComputerChoice(work: ThreadWork, computer: ThreadComputer): ThreadWork {
  const folders = work.folders.filter((folder) => {
    if (folder.source === 'mac') return computer.kind === 'mac' && computer.environmentId === folder.environmentId
    if (folder.source === 'github') return computer.kind === 'cloud'
    return true
  })
  return { computer, folders }
}

export function applyFolderChoice(work: ThreadWork, folder: ThreadFolder | null): ThreadWork {
  if (!folder) return { ...work, folders: [] }
  const computer: ThreadComputer = folder.source === 'mac'
    ? { kind: 'mac', environmentId: folder.environmentId }
    : folder.source === 'github' ? { kind: 'cloud' } : work.computer ?? { kind: 'cloud' }
  return { computer, folders: [folder] }
}

/** Names never copied in either direction: dependencies, build output, git internals and secrets. */
const EXCLUDED_NAMES = new Set([
  'node_modules', '.git', '.next', '.turbo', '.venv', 'venv', '__pycache__', '.DS_Store', '.cache', 'dist', 'build',
])

export function isExcludedWorkPath(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => EXCLUDED_NAMES.has(segment)
    || segment === '.env' || (segment.startsWith('.env.') && segment !== '.env.example'))
}
