'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, ChevronRight, Cloud, Folder, FolderPlus, Github, Laptop, Settings, X } from 'lucide-react'
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, toast,
} from '@overlay/ui/primitives'
import { folderName } from '@/components/desktop/this-computer'
import { folderKey, folderLabel, type ThreadFolder } from '@/shared/agents/thread-work'
import type { ThreadWorkControls } from './useThreadWork'
import { CloudSyncChoice } from '../private-threads/CloudSyncChoice'

/**
 * An agent thread's computer and folder (internal/develop/thread-folders.md). The desktop app shows both under the
 * message box. The web has no row there: every new thread runs in the cloud and its folder is chosen from the + menu.
 * Both are fixed once the thread has a message, and shown as plain labels.
 */

function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-light)">{children}</div>
}

function Chip({ children, ...props }: { children: ReactNode } & Record<string, unknown>) {
  return (
    <Button variant="ghost" size="xs" className="h-6 max-w-[220px] gap-1.5 px-1.5 text-[11px] font-normal text-(--muted)" {...props}>
      {children}
    </Button>
  )
}

/** A choice that can no longer change. */
function Fixed({ children }: { children: ReactNode }) {
  return (
    <span title="Set when the thread started" className="inline-flex h-6 min-w-0 max-w-[220px] items-center gap-1.5 px-1.5 text-[11px] text-(--muted-light)">
      {children}
    </span>
  )
}

function Row({ icon, title, detail, selected }: { icon: ReactNode; title: string; detail?: string; selected?: boolean }) {
  return (
    <>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{title}</span>
        {detail ? <span className="block truncate text-[11px] text-(--muted-light)">{detail}</span> : null}
      </span>
      {selected ? <Check size={13} /> : null}
    </>
  )
}

function FolderIcon({ folder, size }: { folder: ThreadFolder | null; size: number }) {
  if (folder?.source === 'github') return <Github size={size} strokeWidth={1.75} aria-hidden className="shrink-0" />
  if (folder?.source === 'mac') return <Laptop size={size} strokeWidth={1.75} aria-hidden className="shrink-0" />
  return <Folder size={size} strokeWidth={1.75} aria-hidden className={`shrink-0 ${folder ? '' : 'opacity-60'}`} />
}

const GITHUB_RESULTS: Record<string, string> = {
  not_configured: 'GitHub isn’t set up on this Overlay server yet.',
  expired: 'Connecting GitHub took too long. Try again.',
  signed_in_as_someone_else: 'You came back signed in as someone else. Sign in as the person who started connecting GitHub.',
  not_installed: 'The Overlay GitHub App isn’t installed on any account you can access. Install it on GitHub, then connect again.',
  cancelled: 'Connecting GitHub was cancelled.',
  workspace: 'That workspace isn’t available to you.',
  connect_failed: 'Connecting GitHub didn’t work. Try again.',
}

/** GitHub sends people back here with the result in the address; show it once and tidy the address. */
function useGitHubConnectResult() {
  useEffect(() => {
    const url = new URL(window.location.href)
    const connected = url.searchParams.get('github') === 'connected'
    const error = url.searchParams.get('githubError')
    if (!connected && !error) return
    if (connected) toast('GitHub is connected. Its repositories are in the folder menu.')
    else toast.error(GITHUB_RESULTS[error ?? ''] ?? GITHUB_RESULTS.connect_failed)
    url.searchParams.delete('github')
    url.searchParams.delete('githubError')
    window.history.replaceState(window.history.state, '', url.toString())
  }, [])
}

type Choice = { key: string; folder: ThreadFolder; title: string; detail: string }

/** The folders a thread may work in for where it runs: on this computer and Overlay Files, or Overlay Files and GitHub. */
function useFolderChoices(controls: ThreadWorkControls): Array<{ label: string; choices: Choice[]; kind: 'computer' | 'overlay' | 'github' }> {
  const { options, repositories, thisComputer, local } = controls
  const overlay: Choice[] = (options?.folders ?? []).map((option) => ({
    key: option.fileId,
    folder: { source: 'overlay', fileId: option.fileId, name: option.name },
    title: option.path,
    detail: option.scope === 'workspace' ? 'Workspace files' : 'Personal files',
  }))
  if (local) {
    const environmentId = thisComputer.environmentId
    const onComputer: Choice[] = environmentId
      ? thisComputer.folders.map((path) => ({ key: path, folder: { source: 'mac', environmentId, path }, title: folderName(path), detail: path }))
      : []
    return [
      { label: 'On this computer', kind: 'computer', choices: onComputer },
      { label: 'Overlay Files', kind: 'overlay', choices: overlay },
    ]
  }
  const github: Choice[] = (repositories ?? []).map((repository) => ({
    key: repository.repository,
    folder: { source: 'github', repository: repository.repository, installationId: repository.installationId },
    title: repository.repository.split('/')[1] ?? repository.repository,
    detail: repository.repository,
  }))
  return [
    { label: 'Overlay Files', kind: 'overlay', choices: overlay },
    { label: 'GitHub', kind: 'github', choices: github },
  ]
}

export function ThreadWorkFooter({ controls, onMakePrivate, switching = false }: {
  controls: ThreadWorkControls
  /** Cloud sync off: turns this new thread on this computer into a private one (internal/develop/private-threads.md). */
  onMakePrivate?: () => void
  switching?: boolean
}) {
  const router = useRouter()
  const groups = useFolderChoices(controls)
  useGitHubConnectResult()
  const { computer, folder, local, started, thisComputer, options, repositories, connecting } = controls
  if (!controls.ready) return null
  const desktop = thisComputer.available
  const selected = (choice: Choice) => Boolean(folder && folderKey(folder) === folderKey(choice.folder))
  const where = local ? (thisComputer.environmentId === (computer.kind === 'mac' ? computer.environmentId : null) ? 'This computer' : controls.computerName ?? 'Another computer') : 'Cloud'
  const WhereIcon = local ? Laptop : Cloud

  if (started || controls.readOnly) {
    // On the web a started thread shows only its folder; the desktop app also shows where it runs.
    if (!desktop && !folder) return null
    return (
      <div className="mt-1.5 flex min-w-0 items-center gap-0.5 px-1">
        {desktop ? <Fixed><WhereIcon size={12} strokeWidth={1.75} className="shrink-0" /><span className="truncate">{where}</span></Fixed> : null}
        <Fixed><FolderIcon folder={folder} size={12} /><span className="truncate">{folder ? folderLabel(folder) : 'No folder'}</span></Fixed>
        <span className="flex-1" />
        {desktop && folder?.source === 'mac' ? <CopyToFiles controls={controls} /> : null}
      </div>
    )
  }

  if (!desktop) {
    // Nothing sits under the message box until a folder is chosen from the + menu.
    if (!folder) return null
    return (
      <div className="mt-1.5 flex min-w-0 items-center gap-0.5 px-1">
        <span className="inline-flex h-6 max-w-[260px] items-center gap-1.5 pl-1.5 text-[11px] text-(--muted)">
          <FolderIcon folder={folder} size={12} />
          <span className="truncate">{folderLabel(folder)}</span>
        </span>
        <Button variant="ghost" size="xs" aria-label={`Stop working in ${folderLabel(folder)}`} className="size-6 p-0 text-(--muted-light)" onClick={() => controls.chooseFolder(null)}>
          <X size={11} />
        </Button>
      </div>
    )
  }

  return (
    <div className="mt-1.5 flex min-w-0 items-center gap-0.5 px-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Chip aria-label="Where this thread runs" disabled={connecting}>
            <WhereIcon size={12} strokeWidth={1.75} className="shrink-0" />
            <span className="truncate">{connecting ? 'Connecting…' : where}</span>
            <ChevronDown size={11} className="shrink-0 opacity-60" />
          </Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <MenuLabel>Runs on</MenuLabel>
          <DropdownMenuItem disabled={!options?.localComputer} onSelect={() => void controls.chooseThisComputer()} className="gap-2 text-xs">
            <Row
              icon={<Laptop size={14} strokeWidth={1.75} />}
              title="This computer"
              detail={!options?.localComputer ? 'Turn on Local computer in the agent’s settings'
                : thisComputer.environmentId ? `${thisComputer.name ?? 'This computer'} · continues only here` : 'Connects this computer to Overlay'}
              selected={local}
            />
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={controls.chooseCloud} className="gap-2 text-xs">
            <Row
              icon={<Cloud size={14} strokeWidth={1.75} />}
              title="Cloud"
              detail={options?.cloud ? 'Continues on any device' : 'Turn on Cloud computer in the agent’s settings'}
              selected={!local}
            />
          </DropdownMenuItem>
          <div role="separator" className="my-1 h-px bg-(--border)" />
          <DropdownMenuItem onSelect={() => router.push('/app/settings?section=desktop')} className="gap-2 text-xs text-(--muted)">
            <Settings size={14} strokeWidth={1.75} />
            Computer settings…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu onOpenChange={(open) => { if (open) controls.loadRepositories() }}>
        <DropdownMenuTrigger asChild>
          <Chip aria-label="Folder this thread works in" disabled={connecting}>
            <FolderIcon folder={folder} size={12} />
            <span className="truncate">{folder ? folderLabel(folder) : 'No folder'}</span>
            <ChevronDown size={11} className="shrink-0 opacity-60" />
          </Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[420px] w-80 overflow-y-auto">
          <DropdownMenuItem onSelect={() => controls.chooseFolder(null)} className="gap-2 text-xs">
            <Row icon={<FolderIcon folder={null} size={14} />} title="No folder" selected={!folder} />
          </DropdownMenuItem>
          {groups.map((group) => (
            <div key={group.label}>
              <MenuLabel>{group.label}</MenuLabel>
              {group.choices.map((choice) => (
                <DropdownMenuItem key={choice.key} onSelect={() => controls.chooseFolder(choice.folder)} className="gap-2 text-xs">
                  <Row icon={<FolderIcon folder={choice.folder} size={14} />} title={choice.title} detail={choice.detail} selected={selected(choice)} />
                </DropdownMenuItem>
              ))}
              {group.kind === 'computer' ? (
                <DropdownMenuItem onSelect={() => void controls.chooseLocalFolder()} className="gap-2 text-xs text-(--muted)">
                  <FolderPlus size={14} strokeWidth={1.75} />
                  Choose folder…
                </DropdownMenuItem>
              ) : null}
              {group.kind === 'overlay' && group.choices.length === 0 ? <Empty>Folders you create in Files appear here.</Empty> : null}
              {group.kind === 'github' ? <GitHubRows controls={controls} loading={Boolean(options?.githubConnected) && repositories === null} /> : null}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {local && onMakePrivate ? <CloudSyncChoice synced disabled={connecting || switching} onChoose={(synced) => { if (!synced) onMakePrivate() }} /> : null}
      <span className="flex-1" />
      {folder?.source === 'mac' ? <CopyToFiles controls={controls} /> : null}
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1.5 text-[11px] leading-relaxed text-(--muted-light)">{children}</p>
}

function GitHubRows({ controls, loading }: { controls: ThreadWorkControls; loading: boolean }) {
  if (loading) return <Empty>Loading repositories…</Empty>
  return (
    <DropdownMenuItem onSelect={controls.connectGitHub} className="gap-2 text-xs text-(--muted)">
      <Github size={14} strokeWidth={1.75} />
      {controls.options?.githubConnected ? 'Connect GitHub again…' : 'Connect GitHub…'}
    </DropdownMenuItem>
  )
}

/** The one-time copy of a folder on this computer into Overlay Files, so cloud threads can use it. */
function CopyToFiles({ controls }: { controls: ThreadWorkControls }) {
  const [copying, setCopying] = useState(false)
  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={copying}
      className="h-6 shrink-0 gap-1.5 px-2 text-[11px] text-(--muted) max-sm:hidden"
      onClick={() => {
        setCopying(true)
        void controls.copyToFiles().finally(() => setCopying(false))
      }}
    >
      <Cloud size={12} />{copying ? 'Copying…' : 'Copy to Overlay Files'}
    </Button>
  )
}

const menuRow = 'h-auto w-full justify-start gap-2.5 px-3 py-2 text-xs font-normal text-(--muted) transition-colors hover:bg-(--surface-muted) hover:text-(--foreground)'

/**
 * In the + menu on the web: the folder a new cloud thread works in. The desktop app chooses it under the message box.
 */
export function ThreadFolderMenuItems({ controls, close }: { controls: ThreadWorkControls; close(): void }) {
  const [open, setOpen] = useState(false)
  const groups = useFolderChoices(controls)
  const { folder, options, repositories } = controls
  if (!controls.ready || controls.started || controls.local || controls.thisComputer.available) return null
  const choose = (next: ThreadFolder | null) => {
    controls.chooseFolder(next)
    close()
  }
  const check = <Check size={11} strokeWidth={1.8} className="ml-auto shrink-0 text-(--foreground)" />
  return (
    <>
      <Button
        variant="ghost"
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value)
          controls.loadRepositories()
        }}
        className={menuRow}
      >
        <Folder size={13} strokeWidth={1.75} />
        <span>Work in a folder</span>
        <span className="ml-auto flex min-w-0 items-center gap-1 text-[10px] text-(--muted-light)">
          <span className="max-w-24 truncate">{folder ? folderLabel(folder) : null}</span>
          <ChevronRight size={11} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        </span>
      </Button>
      {open ? (
        <div className="max-h-72 overflow-y-auto border-y border-(--border) bg-(--surface-subtle) py-1">
          <Button variant="ghost" type="button" onClick={() => choose(null)} className={menuRow}>
            <FolderIcon folder={null} size={13} />
            <span>No folder</span>
            {!folder ? check : null}
          </Button>
          {groups.map((group) => (
            <div key={group.label}>
              <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-light)">{group.label}</div>
              {group.choices.map((choice) => (
                <Button key={choice.key} variant="ghost" type="button" onClick={() => choose(choice.folder)} className={menuRow}>
                  <FolderIcon folder={choice.folder} size={13} />
                  <span className="truncate">{choice.title}</span>
                  {folder && folderKey(folder) === folderKey(choice.folder) ? check : null}
                </Button>
              ))}
              {group.kind === 'overlay' && group.choices.length === 0 ? <p className="px-3 py-1.5 text-[11px] text-(--muted-light)">Folders you create in Files appear here.</p> : null}
              {group.kind === 'github' && options?.githubConnected && repositories === null ? <p className="px-3 py-1.5 text-[11px] text-(--muted-light)">Loading repositories…</p> : null}
              {group.kind === 'github' && !(options?.githubConnected && repositories === null) ? (
                <Button variant="ghost" type="button" onClick={controls.connectGitHub} className={menuRow}>
                  <Github size={13} strokeWidth={1.75} />
                  <span>{options?.githubConnected ? 'Connect GitHub again…' : 'Connect GitHub…'}</span>
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}

/** Stands in for the message box when a local thread is opened anywhere but its own computer. */
export function LocalThreadNotice({ computerName }: { computerName: string | null }) {
  return (
    <div className="mx-auto w-full max-w-[896px] px-3 pb-5 pt-2 lg:px-0">
      <div role="note" className="flex items-center gap-3 rounded-2xl border border-(--border) bg-(--surface-subtle) px-4 py-3">
        <Laptop size={16} strokeWidth={1.75} className="shrink-0 text-(--muted)" />
        <div className="min-w-0">
          <p className="text-[13px] text-(--foreground)">This is a local thread</p>
          <p className="text-xs leading-relaxed text-(--muted-light)">
            {computerName ? `It runs on ${computerName}. Open Overlay on that computer to continue it.` : 'It runs on the computer it was started on. Open Overlay on that computer to continue it.'}
          </p>
        </div>
      </div>
    </div>
  )
}
