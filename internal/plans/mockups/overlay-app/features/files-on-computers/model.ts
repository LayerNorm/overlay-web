import { useSyncExternalStore } from 'react'

/** The Atlas thread that works in a GitHub repo and an Overlay folder at once. */
export const LAUNCH_THREAD_ID = 'k17convatlaslaunch00000000000000'
/** An Atlas thread that runs on the Mac Studio while you watch from anywhere. */
export const IOS_THREAD_ID = 'k17convatlasiosshare000000000000'
export const FILES_AGENT_ID = 'agent_atlas'

export type Source = 'overlay' | 'github' | 'drive' | 'mac'
export type Host = 'web' | 'desktop'
/** A computer that can run a thread: the agent's cloud computer or any Mac with the desktop app. */
export type Where = 'cloud' | 'mbp' | 'studio' | 'mini'

export type Computer = {
  id: Where
  name: string
  kind: 'cloud' | 'laptop' | 'desktop'
  online: boolean
  /** Status in words, shown under the name. */
  status: string
}

export const COMPUTERS: Computer[] = [
  { id: 'cloud', name: 'Cloud computer', kind: 'cloud', online: true, status: 'Atlas’s computer · ready' },
  { id: 'mbp', name: 'MacBook Pro', kind: 'laptop', online: true, status: 'Online' },
  { id: 'studio', name: 'Mac Studio', kind: 'desktop', online: true, status: 'Online · running 1 thread' },
  { id: 'mini', name: 'Mac mini', kind: 'desktop', online: false, status: 'Offline · last seen 2 days ago' },
]
/** The Mac the desktop app in this mockup is open on. */
export const THIS_MAC: Where = 'mbp'
export const computerById = (id: Where) => COMPUTERS.find((computer) => computer.id === id)!

export type SourceFolder = {
  id: string
  name: string
  source: Source
  /** Where the folder lives, in words: a repo, a shared drive, a path on the Mac. */
  origin: string
  /** Where an agent finds it on the computer that runs the thread. */
  path: string
  /** How an agent's changes reach the source. */
  writes: string
  /** For a Mac folder: the Mac it lives on. */
  computer?: Where
}

export const SOURCE_LABEL: Record<Source, string> = {
  overlay: 'Overlay Files',
  github: 'GitHub',
  drive: 'Google Drive',
  mac: 'Mac',
}

export const FOLDERS: SourceFolder[] = [
  { id: 'k17folderlaunch00000000000000000', name: 'Launch', source: 'overlay', origin: 'Workspace files', path: '/overlay/workspace/Launch', writes: 'Saved to Files' },
  { id: 'k17folderresearch000000000000000', name: 'Research', source: 'overlay', origin: 'Workspace files', path: '/overlay/workspace/Research', writes: 'Saved to Files' },
  { id: 'k17foldergithubweb00000000000000', name: 'northwind-web', source: 'github', origin: 'northwind/northwind-web', path: '/workspace/northwind-web', writes: 'A branch and a pull request' },
  { id: 'k17foldergithubapi00000000000000', name: 'northwind-api', source: 'github', origin: 'northwind/northwind-api', path: '/workspace/northwind-api', writes: 'A branch and a pull request' },
  { id: 'k17folderdrivemarketing000000000', name: 'Marketing', source: 'drive', origin: 'Shared drive · Marketing', path: '/overlay/workspace/Marketing', writes: 'Saved to Drive with its version history' },
  { id: 'k17foldermachomepage000000000000', name: 'homepage-experiments', source: 'mac', computer: 'mbp', origin: '~/code/homepage-experiments', path: '~/code/homepage-experiments', writes: 'Edited in place on the Mac' },
  { id: 'k17foldermacstudioios00000000000', name: 'northwind-ios', source: 'mac', computer: 'studio', origin: '~/dev/northwind-ios', path: '~/dev/northwind-ios', writes: 'Edited in place on the Mac' },
]

export const folderById = (id: string | null | undefined) => FOLDERS.find((folder) => folder.id === id) ?? null
export const sourceOf = (id: string | null | undefined): Source | null => folderById(id)?.source ?? null

export const THREAD_BRANCH = 'atlas/launch-pricing-copy'

/** What one run changed, grouped by where each change went back to. */
export type WriteBack =
  | { kind: 'note'; title: string; detail: string; action: string }
  | { kind: 'drive'; title: string; detail: string; action: string }
  | { kind: 'conflict'; title: string; detail: string; action: string }
  | { kind: 'pr'; title: string; detail: string; action: string; added: number; removed: number }

export const WRITE_BACKS: WriteBack[] = [
  { kind: 'pr', title: 'northwind-web', detail: `${THREAD_BRANCH} · 3 files · pull request #491`, action: 'Review', added: 46, removed: 21 },
  { kind: 'note', title: 'Launch FAQ', detail: 'New note in Launch', action: 'Open' },
  { kind: 'drive', title: 'Pricing one-pager', detail: 'Updated in Marketing on Google Drive', action: 'Open' },
  { kind: 'conflict', title: 'Pricing benchmark', detail: 'Edited by you while Atlas worked, so Atlas saved its version as a copy', action: 'Compare' },
]

const MARKER_PREFIX = 'mockup-files-marker:'

export function writeBackMarker(conversationId: string, ago: number) {
  const at = Date.now() - ago
  return {
    id: `files_marker_${ago}`,
    conversationId,
    turnId: `files_marker_${ago}`,
    authorKind: 'system' as const,
    authorPrincipalId: 'system',
    content: MARKER_PREFIX + 'write-back',
    parts: [],
    createdAt: at,
    updatedAt: at,
    status: 'complete',
  }
}

export const isWriteBackMarker = (content: unknown) => typeof content === 'string' && content.startsWith(MARKER_PREFIX)

// ---- Mockup state: which app is shown, and each thread's folder and computer.

type State = {
  host: Host
  folder: Record<string, string | null>
  where: Record<string, Where>
  addFolder: boolean
}

function initialHost(): Host {
  const params = new URLSearchParams(globalThis.location?.search ?? '')
  return params.get('host') === 'web' ? 'web' : 'desktop'
}

let state: State = {
  host: initialHost(),
  folder: { [LAUNCH_THREAD_ID]: 'k17foldergithubweb00000000000000', [IOS_THREAD_ID]: 'k17foldermacstudioios00000000000' },
  where: { [LAUNCH_THREAD_ID]: 'cloud', [IOS_THREAD_ID]: 'studio' },
  addFolder: false,
}
const listeners = new Set<() => void>()
function set(next: Partial<State>) {
  state = { ...state, ...next }
  document.documentElement.dataset.mockupHost = state.host
  listeners.forEach((listener) => listener())
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useFilesState() {
  return useSyncExternalStore(subscribe, () => state, () => state)
}
export const setHost = (host: Host) => set({ host })
export const setAddFolder = (addFolder: boolean) => set({ addFolder })
export function chooseFolder(conversationId: string, folderId: string | null) {
  const folder = folderById(folderId)
  set({
    folder: { ...state.folder, [conversationId]: folderId },
    // A folder kept on a Mac can only be worked on by that Mac.
    where: folder?.computer ? { ...state.where, [conversationId]: folder.computer } : state.where,
  })
}
export function chooseWhere(conversationId: string, where: Where) {
  set({ where: { ...state.where, [conversationId]: where } })
}
export function initHostAttribute() {
  document.documentElement.dataset.mockupHost = state.host
}
