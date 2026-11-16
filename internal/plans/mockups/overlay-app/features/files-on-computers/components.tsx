import { useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Cloud, Copy, Folder, FolderOpen, FolderPlus, GitBranch,
  GitPullRequest, Globe, Laptop, Lock, Monitor, Plus, ShieldCheck, Upload,
} from 'lucide-react'
import {
  Button, DialogFrame, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, toast,
} from '@overlay/ui/primitives'
import { splitHref, useHref } from '../../shims/router'
import {
  COMPUTERS, FILES_AGENT_ID, FOLDERS, SOURCE_LABEL, THIS_MAC, computerById, THREAD_BRANCH, WRITE_BACKS, chooseFolder, chooseWhere, folderById, initHostAttribute,
  isWriteBackMarker, setAddFolder, setHost, sourceOf, useFilesState, type Host, type Source, type SourceFolder, type Where,
  type WriteBack,
} from './model'

// ---- Source marks

export function GitHubMark({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" width={size} height={size} aria-hidden className={`shrink-0 ${className}`}>
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M512 0C229.12 0 0 229.12 0 512c0 226.56 146.56 417.92 350.08 485.76 25.6 4.48 35.2-10.88 35.2-24.32 0-12.16-.64-52.48-.64-95.36-128.64 23.68-161.92-31.36-172.16-60.16-5.76-14.72-30.72-60.16-52.48-72.32-17.92-9.6-43.52-33.28-.64-33.92 40.32-.64 69.12 37.12 78.72 52.48 46.08 77.44 119.68 55.68 149.12 42.24 4.48-33.28 17.92-55.68 32.64-68.48-113.92-12.8-232.96-56.96-232.96-252.8 0-55.68 19.84-101.76 52.48-137.6-5.12-12.8-23.04-65.28 5.12-135.68 0 0 42.88-13.44 140.8 52.48 40.96-11.52 84.48-17.28 128-17.28s87.04 5.76 128 17.28c97.92-66.56 140.8-52.48 140.8-52.48 28.16 70.4 10.24 122.88 5.12 135.68 32.64 35.84 52.48 81.28 52.48 137.6 0 196.48-119.68 240-233.6 252.8 18.56 16 34.56 46.72 34.56 94.72 0 68.48-.64 123.52-.64 140.8 0 13.44 9.6 29.44 35.2 24.32C877.44 929.92 1024 737.92 1024 512 1024 229.12 794.88 0 512 0" />
    </svg>
  )
}

export function DriveMark({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 87.3 78" width={size} height={size} aria-hidden className={`shrink-0 ${className}`}>
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" />
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  )
}

/** The cloud, a laptop or a desktop Mac. */
function ComputerIcon({ where, size = 14, className = '' }: { where: Where; size?: number; className?: string }) {
  const kind = computerById(where).kind
  const Icon = kind === 'cloud' ? Cloud : kind === 'laptop' ? Laptop : Monitor
  return <Icon size={size} strokeWidth={1.75} aria-hidden className={`shrink-0 ${className}`} />
}

function SourceMark({ source, computer, open = false, size = 14, className = '' }: { source: Source | null; computer?: Where; open?: boolean; size?: number; className?: string }) {
  if (source === 'github') return <GitHubMark size={size} className={className} />
  if (source === 'drive') return <DriveMark size={size} className={className} />
  if (source === 'mac') return <ComputerIcon where={computer ?? THIS_MAC} size={size} className={className} />
  return open
    ? <FolderOpen size={size} aria-hidden className={`shrink-0 ${className}`} />
    : <Folder size={size} aria-hidden className={`shrink-0 ${className}`} />
}

/** Replaces the plain folder icon in the Files tree, list and cards. */
export function SourceFolderIcon({ file, open = false, size, className = '' }: { file: { _id: string }; open?: boolean; size?: number; className?: string }) {
  return <SourceMark source={sourceOf(file._id)} computer={folderById(file._id)?.computer} open={open} size={size} className={className} />
}

export function sourceFolderLabel(file: { _id: string }): string {
  const folder = folderById(file._id)
  if (folder?.computer) return `Folder · ${computerById(folder.computer).name}`
  return folder && folder.source !== 'overlay' ? `Folder · ${SOURCE_LABEL[folder.source]}` : 'Folder'
}

// ---- Web or desktop: the window around the app

function HostSwitch() {
  const { host } = useFilesState()
  const options: Array<[Host, string, ReactNode]> = [
    ['web', 'Web', <Globe key="w" size={12} strokeWidth={1.75} />],
    ['desktop', 'Desktop', <Laptop key="d" size={12} strokeWidth={1.75} />],
  ]
  return (
    <div role="radiogroup" aria-label="Show the app as" className="inline-flex rounded-lg bg-(--surface-subtle) p-0.5">
      {options.map(([value, label, icon]) => (
        <Button
          key={value}
          variant="ghost"
          size="xs"
          role="radio"
          aria-checked={host === value}
          onClick={() => setHost(value)}
          className={`h-6 gap-1.5 rounded-md px-2 text-[11px] font-normal ${host === value ? 'bg-(--surface-elevated) text-(--foreground) shadow-xs hover:bg-(--surface-elevated)' : 'text-(--muted)'}`}
        >
          {icon}{label}
        </Button>
      ))}
    </div>
  )
}

function HostBar() {
  const { host } = useFilesState()
  const { pathname } = splitHref(useHref())
  return (
    <div className="fixed inset-x-0 top-0 z-40 flex h-10 items-center gap-3 bg-background px-3 text-(--muted)">
      {host === 'desktop' ? (
        <div className="flex items-center gap-2 pl-1 sm:w-[140px]" aria-hidden>
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </div>
      ) : (
        <div className="flex items-center gap-1 sm:w-[140px]" aria-hidden>
          <ChevronLeft size={15} strokeWidth={1.75} />
          <ChevronRight size={15} strokeWidth={1.75} className="opacity-40" />
        </div>
      )}
      <div className="flex min-w-0 flex-1 justify-center max-sm:invisible">
        {host === 'web' ? (
          <span className="inline-flex h-6 min-w-0 max-w-[420px] flex-1 items-center justify-center gap-1.5 rounded-md bg-(--surface-subtle) px-3 text-[11px]">
            <Lock size={10} className="shrink-0" />
            <span className="truncate">app.getoverlay.io{pathname.replace(/^\/app/, '') || '/'}</span>
          </span>
        ) : (
          <span className="text-[11px]">Overlay</span>
        )}
      </div>
      <div className="flex justify-end sm:w-[140px]"><HostSwitch /></div>
    </div>
  )
}

function HostChrome() {
  const { addFolder } = useFilesState()
  return (
    <>
      <HostBar />
      <AddFolderDialog open={addFolder} onClose={() => setAddFolder(false)} />
    </>
  )
}

/** Mounts the window bar and the add-folder dialog beside the app, and leaves room for the bar. */
export function mountHostChrome() {
  initHostAttribute()
  const style = document.createElement('style')
  style.textContent = 'html[data-mockup-host] [data-app-shell]{height:calc(100vh - 40px)!important;margin-top:40px}'
  document.head.append(style)
  const node = document.createElement('div')
  document.body.append(node)
  createRoot(node).render(<HostChrome />)
}

// ---- Add a folder: from this Mac (desktop), GitHub, Google Drive, or a one-time upload (web)

type AddKind = 'mac' | 'github' | 'drive' | 'upload'
type MacMode = 'keep' | 'copy'

function OptionRow({ selected, icon, title, detail, onSelect }: { selected: boolean; icon: ReactNode; title: string; detail: string; onSelect(): void }) {
  return (
    <Button
      variant="ghost"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`h-auto w-full items-start justify-start gap-3 whitespace-normal rounded-xl border px-3 py-2.5 text-left font-normal ${selected ? 'border-(--foreground)/30 hover:bg-(--surface-subtle)' : 'border-(--border) hover:bg-(--surface-subtle)'}`}
    >
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-(--foreground)">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-(--foreground)">{title}</span>
        <span className="block text-[11px] leading-relaxed text-(--muted)">{detail}</span>
      </span>
      <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-(--foreground) bg-(--foreground) text-(--background)' : 'border-(--border)'}`}>
        {selected ? <Check size={10} strokeWidth={3} /> : null}
      </span>
    </Button>
  )
}

const dialogClass = 'flex max-h-[min(760px,calc(100vh-32px))] w-[min(480px,94vw)]! flex-col rounded-[20px]! p-0! [&>div:first-child]:px-5 [&>div:first-child]:pt-4 [&>p]:px-5'

function AddFolderDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { host } = useFilesState()
  const [kind, setKind] = useState<AddKind>('mac')
  const [macMode, setMacMode] = useState<MacMode>('keep')
  const current: AddKind = host === 'web' && kind === 'mac' ? 'github' : kind
  const options: Array<[AddKind, ReactNode, string, string]> = [
    ...(host === 'desktop' ? [['mac', <Laptop key="m" size={15} strokeWidth={1.75} />, 'From this Mac', 'Choose a folder on this MacBook Pro.'] as [AddKind, ReactNode, string, string]] : []),
    ['github', <GitHubMark key="g" size={15} />, 'GitHub repository', 'Agents work on a copy and send changes back as a pull request.'],
    ['drive', <DriveMark key="d" size={15} />, 'Google Drive folder', 'Shows up in Files. Edits keep Drive’s version history.'],
    ...(host === 'web' ? [['upload', <Upload key="u" size={15} strokeWidth={1.75} />, 'Upload a folder', 'Copies a folder from this computer into Files, once.'] as [AddKind, ReactNode, string, string]] : []),
  ]
  const confirm = () => {
    onClose()
    toast(current === 'mac' ? (macMode === 'keep' ? 'homepage-experiments added from this Mac' : 'Copying homepage-experiments to your files') : current === 'github' ? 'Choose a repository on GitHub' : current === 'drive' ? 'Choose a folder in Google Drive' : 'Choose a folder to upload')
  }
  return (
    <DialogFrame
      open={open}
      onOpenChange={(next) => { if (!next) onClose() }}
      title="Add a folder"
      description="Agents can work in it from any thread. It shows up in Files next to your other folders."
      className={dialogClass}
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4">
        <div role="radiogroup" aria-label="Where the folder comes from" className="space-y-2">
          {options.map(([value, icon, title, detail]) => (
            <OptionRow key={value} selected={current === value} icon={icon} title={title} detail={detail} onSelect={() => setKind(value)} />
          ))}
        </div>
        {current === 'mac' ? (
          <section className="space-y-2">
            <div className="flex items-center gap-3 rounded-xl bg-(--surface-subtle) px-3 py-2">
              <Folder size={14} className="shrink-0 text-(--muted)" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[11px] text-(--foreground)/85">~/code/homepage-experiments</span>
                <span className="block text-[11px] text-(--muted-light)">214 files · 3.8 MB</span>
              </span>
              <Button variant="secondary" size="xs" className="shrink-0">Change…</Button>
            </div>
            <div role="radiogroup" aria-label="How agents use it" className="space-y-2 pt-1">
              <OptionRow
                selected={macMode === 'keep'}
                icon={<Laptop size={15} strokeWidth={1.75} />}
                title="Keep it on this Mac"
                detail="Agents work on it on this MacBook Pro, only while it’s online. Nothing is uploaded."
                onSelect={() => setMacMode('keep')}
              />
              <OptionRow
                selected={macMode === 'copy'}
                icon={<Cloud size={15} strokeWidth={1.75} />}
                title="Copy it to Overlay Files"
                detail="Cloud agents can use it too. The folder on your Mac stays as it is and isn’t kept in sync."
                onSelect={() => setMacMode('copy')}
              />
            </div>
            {macMode === 'copy' ? (
              <p className="flex items-start gap-1.5 text-[11px] text-(--muted-light)">
                <ShieldCheck size={12} className="mt-px shrink-0" />
                <span>Not uploaded: <span className="font-mono">node_modules</span>, <span className="font-mono">.env</span>, <span className="font-mono">.env.local</span> and anything in <span className="font-mono">.gitignore</span></span>
              </p>
            ) : null}
          </section>
        ) : null}
        <p className="text-[11px] leading-relaxed text-(--muted-light)">
          {host === 'web'
            ? 'To let agents work in a folder on one of your Macs without uploading it, add it from the desktop app on that Mac.'
            : 'Folders on your other Macs are added from the desktop app on each Mac.'}
        </p>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-(--border) px-5 py-3">
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={confirm}><FolderPlus size={14} />{current === 'mac' || current === 'upload' ? 'Add folder' : 'Continue'}</Button>
      </div>
    </DialogFrame>
  )
}

/** Extra items in the Files upload menu. */
export function FilesSourceMenuItems({ close }: { close(): void }) {
  const { host } = useFilesState()
  const itemClass = 'flex h-auto w-full items-center justify-start gap-2 rounded-none px-2.5 py-1.5 text-left text-xs font-normal text-(--muted) hover:bg-(--surface-muted) hover:text-(--foreground)'
  const open = () => { close(); setAddFolder(true) }
  return (
    <>
      <div className="my-1 h-px bg-(--border)" />
      {host === 'desktop' ? <Button variant="ghost" onClick={open} className={itemClass}><Laptop size={13} strokeWidth={1.75} />From this Mac</Button> : null}
      <Button variant="ghost" onClick={open} className={itemClass}><GitHubMark size={13} />GitHub repository</Button>
      <Button variant="ghost" onClick={open} className={itemClass}><DriveMark size={13} />Google Drive folder</Button>
    </>
  )
}

// ---- Under the composer: which computer runs the thread and which folder it works in

function useConversationId(): string {
  const { search } = splitHref(useHref())
  return new URLSearchParams(search).get('id') ?? 'new'
}

function MenuSection({ label }: { label: string }) {
  return <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-light)">{label}</div>
}

function ComposerChip({ children, ...props }: { children: ReactNode } & Record<string, unknown>) {
  return (
    <Button variant="ghost" size="xs" className="h-6 max-w-[220px] gap-1.5 px-1.5 text-[11px] font-normal text-(--muted)" {...props}>
      {children}
    </Button>
  )
}

/** "This Mac" only in the desktop app, on the Mac it is open on. */
function computerStatus(where: Where, host: Host) {
  const computer = computerById(where)
  return host === 'desktop' && where === THIS_MAC ? `This Mac · ${computer.status.toLowerCase()}` : computer.status
}

function folderSubtitle(folder: SourceFolder, where: Where) {
  if (folder.computer) return folder.origin
  if (folder.source === 'github') return where === 'cloud' ? `A copy at ${folder.path}` : `Your clone of ${folder.origin}`
  return where === 'cloud' ? folder.path : `${SOURCE_LABEL[folder.source]} · read through Overlay`
}

export function FilesComposerFooter({ fallback: _fallback }: { fallback: ReactNode }) {
  const conversationId = useConversationId()
  const state = useFilesState()
  const where = state.where[conversationId] ?? 'cloud'
  const folder = folderById(state.folder[conversationId])
  const groups: Array<[string, SourceFolder[]]> = [
    ...(['overlay', 'github', 'drive'] as const).map((source): [string, SourceFolder[]] => [SOURCE_LABEL[source], FOLDERS.filter((entry) => entry.source === source)]),
    // Each Mac's folders under its own name.
    ...COMPUTERS.filter((computer) => computer.id !== 'cloud').map((computer): [string, SourceFolder[]] => [computer.name, FOLDERS.filter((entry) => entry.computer === computer.id)]),
  ].filter(([, folders]) => folders.length > 0)

  return (
    <div className="mt-1.5 flex min-w-0 items-center gap-0.5 px-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ComposerChip aria-label="Computer that runs this thread">
            <ComputerIcon where={where} size={12} />
            <span className="truncate">{computerById(where).name}</span>
            <ChevronDown size={11} className="shrink-0 opacity-60" />
          </ComposerChip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <MenuSection label="Runs on" />
          {COMPUTERS.map((computer) => {
            // A folder kept on a Mac pins the thread to that Mac.
            const pinned = folder?.computer && folder.computer !== computer.id
            const disabled = Boolean(pinned) || !computer.online
            return (
              <DropdownMenuItem key={computer.id} disabled={disabled} onSelect={() => chooseWhere(conversationId, computer.id)} className="gap-2 text-xs">
                <span className="relative">
                  <ComputerIcon where={computer.id} size={14} />
                  {computer.id !== 'cloud' ? (
                    <span className={`absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-(--surface-elevated) ${computer.online ? 'bg-(--success)' : 'bg-(--muted-light)'}`} />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{computer.name}</span>
                  <span className="block truncate text-[11px] text-(--muted-light)">
                    {pinned && computer.online ? `${folder?.name} is on ${computerById(folder!.computer!).name}` : computerStatus(computer.id, state.host)}
                  </span>
                </span>
                {computer.id === where ? <Check size={13} /> : null}
              </DropdownMenuItem>
            )
          })}
          <div className="my-1 h-px bg-(--border)" />
          <DropdownMenuItem onSelect={() => toast('Install the desktop app on another Mac and sign in. It shows up here.')} className="gap-2 text-xs text-(--muted)">
            <Plus size={14} strokeWidth={1.75} />
            Add a Mac…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ComposerChip aria-label="Folder this thread works in">
            {folder ? <SourceMark source={folder.source} computer={folder.computer} size={12} /> : <Folder size={12} strokeWidth={1.75} />}
            <span className="truncate">{folder?.name ?? 'No folder'}</span>
            <ChevronDown size={11} className="shrink-0 opacity-60" />
          </ComposerChip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[420px] w-80 overflow-y-auto">
          <DropdownMenuItem onSelect={() => chooseFolder(conversationId, null)} className="gap-2 text-xs">
            <Folder size={14} strokeWidth={1.75} className="opacity-50" />
            <span className="flex-1">No folder<span className="block text-[11px] text-(--muted-light)">Files are still there at /overlay</span></span>
            {!folder ? <Check size={13} /> : null}
          </DropdownMenuItem>
          {groups.map(([label, folders]) => (
            <div key={label}>
              <MenuSection label={label} />
              {folders.map((entry) => (
                <DropdownMenuItem key={entry.id} onSelect={() => chooseFolder(conversationId, entry.id)} className="gap-2 text-xs">
                  <SourceMark source={entry.source} computer={entry.computer} size={14} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{entry.name}</span>
                    <span className="block truncate text-[11px] text-(--muted-light)">{folderSubtitle(entry, entry.computer ?? where)}</span>
                  </span>
                  {entry.id === folder?.id ? <Check size={13} /> : null}
                </DropdownMenuItem>
              ))}
            </div>
          ))}
          <div className="my-1 h-px bg-(--border)" />
          <DropdownMenuItem onSelect={() => setAddFolder(true)} className="gap-2 text-xs text-(--muted)">
            <FolderPlus size={14} strokeWidth={1.75} />
            Add a folder…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {folder?.source === 'github' ? (
        <ComposerChip aria-label="Branch" className="h-6 max-w-[220px] gap-1.5 px-1.5 text-[11px] font-normal text-(--muted) max-sm:hidden">
          <GitBranch size={12} strokeWidth={1.75} />
          <span className="truncate font-mono">{THREAD_BRANCH}</span>
        </ComposerChip>
      ) : null}
      <span className="flex-1" />
      {folder?.source === 'github' ? (
        <Button variant="ghost" size="xs" className="h-6 shrink-0 gap-1.5 px-2 text-[11px] max-sm:hidden"><GitPullRequest size={12} />Pull request #491</Button>
      ) : folder?.source === 'mac' ? (
        <Button variant="ghost" size="xs" className="h-6 shrink-0 gap-1.5 px-2 text-[11px] max-sm:hidden" onClick={() => setAddFolder(true)}><Cloud size={12} />Copy to Files</Button>
      ) : folder ? (
        <Button variant="ghost" size="xs" className="h-6 shrink-0 gap-1.5 px-2 text-[11px] max-sm:hidden"><FolderOpen size={12} />Open in Files</Button>
      ) : null}
    </div>
  )
}

// ---- In the transcript: where each change went back to

function WriteBackIcon({ item }: { item: WriteBack }) {
  if (item.kind === 'pr') return <GitHubMark size={14} className="text-(--foreground)" />
  if (item.kind === 'drive') return <DriveMark size={14} />
  if (item.kind === 'conflict') return <Copy size={14} strokeWidth={1.75} className="shrink-0 text-(--muted)" />
  return <BookOpen size={14} strokeWidth={1.75} className="shrink-0 text-(--muted)" />
}

export function FilesTranscriptRow({ message, children }: { message: { content?: unknown }; children: ReactNode }) {
  if (!isWriteBackMarker(message.content)) return <>{children}</>
  return (
    <div className="pl-11 pr-2">
      <div className="divide-y divide-(--border) rounded-xl border border-(--border)">
        {WRITE_BACKS.map((item) => (
          <div key={item.title} className="flex items-center gap-3 px-3 py-2.5">
            <WriteBackIcon item={item} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-(--foreground)">{item.title}</p>
              <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-(--muted-light)">
                <span className="truncate">{item.detail}</span>
                {item.kind === 'pr' ? (
                  <span className="inline-flex shrink-0 gap-1 tabular-nums">
                    <span className="text-(--success)">+{item.added}</span>
                    <span className="text-(--danger)">−{item.removed}</span>
                  </span>
                ) : null}
              </p>
            </div>
            <Button variant={item.kind === 'pr' ? 'secondary' : 'ghost'} size="xs" className="shrink-0">{item.action}</Button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- In the right panel's Details: what the agent's computer can reach

export function filesDetailsSummary(agentId: string | undefined): string | null {
  return agentId === FILES_AGENT_ID ? 'northwind-web · Workspace files' : null
}

export function FilesDetails() {
  const rows: Array<[string, ReactNode]> = [
    ['Default folder', <span key="f" className="inline-flex items-center gap-1.5"><GitHubMark size={11} />northwind-web</span>],
    ['On the computer', <span key="p" className="font-mono">/workspace/northwind-web</span>],
    ['Changes go back', 'As a branch and pull request'],
    ['Overlay Files', <span key="o"><span className="font-mono">/overlay/workspace</span> · read and write</span>],
    ['Personal files', 'Not shared with this agent'],
    ['Access', 'Ends when the computer stops'],
  ]
  return (
    <div className="space-y-3 px-1">
      <dl className="space-y-1.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-3">
            <dt className="w-28 shrink-0 text-(--muted)">{label}</dt>
            <dd className="min-w-0 flex-1 truncate text-(--foreground)/85">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[11px] leading-relaxed text-(--muted-light)">
        Workspace files, including Google Drive folders, are mounted on Atlas’s computer. Every save goes through Overlay, so search and permissions stay the same as in the app.
      </p>
      <div className="space-y-1 pt-1">
        <p className="text-xs text-(--muted)">Computers</p>
        <ul className="space-y-1">
          {COMPUTERS.map((computer) => (
            <li key={computer.id} className="flex items-center gap-2 text-xs">
              <ComputerIcon where={computer.id} size={13} className={computer.online ? 'text-(--foreground)/85' : 'text-(--muted-light)'} />
              <span className={`min-w-0 flex-1 truncate ${computer.online ? 'text-(--foreground)/85' : 'text-(--muted-light)'}`}>{computer.name}</span>
              <span className="shrink-0 text-[11px] text-(--muted-light)">{computer.id === 'cloud' ? 'Ready' : computer.id === 'studio' ? '1 thread' : computer.online ? 'Online' : 'Offline'}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
