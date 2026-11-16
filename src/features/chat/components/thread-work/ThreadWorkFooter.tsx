'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Check, ChevronDown, Cloud, Folder, FolderPlus, Github, Laptop, Plus } from 'lucide-react'
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, toast,
} from '@overlay/ui/primitives'
import type { GitHubRepositoryResource } from '@overlay/api-client'
import { api } from '../../../../../convex/_generated/api'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { effectiveAgentEnvironmentStatus } from '@/shared/agents/environment-status'
import {
  applyComputerChoice, applyFolderChoice, folderKey, folderLabel,
  type ThreadComputer, type ThreadFolder, type ThreadWork,
} from '@/shared/agents/thread-work'
import { AddThreadFolderDialog } from './AddThreadFolderDialog'

/**
 * Under an agent thread's message box: the computer that runs the thread and the folder it works in
 * (internal/develop/thread-folders.md). Only the viewer's own Macs are listed.
 */

type Options = NonNullable<ReturnType<typeof useThreadWorkOptions>>
export type ThreadMac = Options['macs'][number]

function useThreadWorkOptions(workspaceId: string, agentId: string) {
  return useQuery(api.agents.threadWork.options, { workspaceId, agentId })
}

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

const macOnline = (mac: ThreadMac, now: number) =>
  effectiveAgentEnvironmentStatus({ status: mac.status, lastSeenAt: mac.lastSeenAt }, now) === 'online'

function FolderIcon({ folder, size }: { folder: ThreadFolder | null; size: number }) {
  if (folder?.source === 'github') return <Github size={size} strokeWidth={1.75} aria-hidden />
  if (folder?.source === 'mac') return <Laptop size={size} strokeWidth={1.75} aria-hidden />
  return <Folder size={size} strokeWidth={1.75} aria-hidden className={folder ? '' : 'opacity-60'} />
}

export function ThreadWorkFooter({ workspaceId, agentId, conversationId }: { workspaceId: string; agentId: string; conversationId: string }) {
  const work = useQuery(api.agents.threadWork.get, { workspaceId, agentId, conversationId: conversationId as never })
  const options = useThreadWorkOptions(workspaceId, agentId)
  const save = useMutation(api.agents.threadWork.set)
  const [repositories, setRepositories] = useState<GitHubRepositoryResource[] | null>(null)
  const [adding, setAdding] = useState(false)
  // The clock only refreshes online states when a menu opens; the query itself is live.
  const [now, setNow] = useState(() => Date.now())
  useGitHubConnectResult()

  if (!work || !options) return null
  const current: ThreadWork = work
  const computer: ThreadComputer = current.computer ?? { kind: 'cloud' }
  const folder = current.folders[0] ?? null
  const macs = options.macs
  const macName = (environmentId: string) => macs.find(mac => mac.environmentId === environmentId)?.name ?? 'Mac'

  const update = (next: ThreadWork) => {
    void save({ workspaceId, agentId, conversationId: conversationId as never, work: next }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message.replace(/^.*ConvexError: /, '').split('\n')[0] : 'Couldn’t change where this thread works.')
    })
  }

  const loadRepositories = () => {
    setNow(Date.now())
    if (!options.githubConnected || repositories) return
    void overlayAppClient.github.repositories(workspaceId)
      .then(result => setRepositories(result.repositories))
      .catch(() => setRepositories([]))
  }

  const computerLabel = computer.kind === 'cloud' ? 'Cloud computer' : macName(computer.environmentId)
  const pinnedTo = folder?.source === 'mac' ? folder.environmentId : null

  return (
    <div className="mt-1.5 flex min-w-0 items-center gap-0.5 px-1">
      <DropdownMenu onOpenChange={(open) => { if (open) setNow(Date.now()) }}>
        <DropdownMenuTrigger asChild>
          <Chip aria-label="Computer that runs this thread">
            {computer.kind === 'cloud' ? <Cloud size={12} strokeWidth={1.75} /> : <Laptop size={12} strokeWidth={1.75} />}
            <span className="truncate">{computerLabel}</span>
            <ChevronDown size={11} className="shrink-0 opacity-60" />
          </Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <MenuLabel>Runs on</MenuLabel>
          <DropdownMenuItem
            disabled={Boolean(pinnedTo)}
            onSelect={() => update(applyComputerChoice(current, { kind: 'cloud' }))}
            className="gap-2 text-xs"
          >
            <Cloud size={14} strokeWidth={1.75} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">Cloud computer</span>
              <span className="block truncate text-[11px] text-(--muted-light)">
                {pinnedTo ? `${folder ? folderLabel(folder) : 'The folder'} is on ${macName(pinnedTo)}` : options.cloud ? `This agent’s computer · ${options.cloud.status}` : 'Turn on Computer in the agent’s settings'}
              </span>
            </span>
            {computer.kind === 'cloud' ? <Check size={13} /> : null}
          </DropdownMenuItem>
          {macs.map(mac => {
            const online = macOnline(mac, now)
            const blocked = pinnedTo !== null && pinnedTo !== mac.environmentId
            return (
              <DropdownMenuItem
                key={mac.environmentId}
                disabled={!online || blocked}
                onSelect={() => update(applyComputerChoice(current, { kind: 'mac', environmentId: mac.environmentId }))}
                className="gap-2 text-xs"
              >
                <span className="relative">
                  <Laptop size={14} strokeWidth={1.75} />
                  <span className={`absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ${online ? 'bg-(--success)' : 'bg-(--muted-light)'}`} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{mac.name}</span>
                  <span className="block truncate text-[11px] text-(--muted-light)">
                    {blocked && folder ? `${folderLabel(folder)} is on ${macName(pinnedTo)}` : online ? 'Online' : 'Offline'}
                  </span>
                </span>
                {computer.kind === 'mac' && computer.environmentId === mac.environmentId ? <Check size={13} /> : null}
              </DropdownMenuItem>
            )
          })}
          <div role="separator" className="my-1 h-px bg-(--border)" />
          <DropdownMenuItem onSelect={() => setAdding(true)} className="gap-2 text-xs text-(--muted)">
            <Plus size={14} strokeWidth={1.75} />
            Add a Mac…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu onOpenChange={(open) => { if (open) loadRepositories() }}>
        <DropdownMenuTrigger asChild>
          <Chip aria-label="Folder this thread works in">
            <FolderIcon folder={folder} size={12} />
            <span className="truncate">{folder ? folderLabel(folder) : 'No folder'}</span>
            <ChevronDown size={11} className="shrink-0 opacity-60" />
          </Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[420px] w-80 overflow-y-auto">
          <DropdownMenuItem onSelect={() => update(applyFolderChoice(current, null))} className="gap-2 text-xs">
            <Folder size={14} strokeWidth={1.75} className="opacity-50" />
            <span className="flex-1">No folder</span>
            {!folder ? <Check size={13} /> : null}
          </DropdownMenuItem>
          {options.folders.length > 0 ? <MenuLabel>Overlay Files</MenuLabel> : null}
          {options.folders.map(option => {
            const choice: ThreadFolder = { source: 'overlay', fileId: option.fileId, name: option.name }
            return (
              <DropdownMenuItem key={option.fileId} onSelect={() => update(applyFolderChoice(current, choice))} className="gap-2 text-xs">
                <Folder size={14} strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.path}</span>
                  <span className="block truncate text-[11px] text-(--muted-light)">
                    {computer.kind === 'cloud' ? `Copied to ~/workspace/${option.name}` : 'Copied onto the Mac'} · {option.scope === 'workspace' ? 'Workspace' : 'Personal'}
                  </span>
                </span>
                {folder && folderKey(folder) === folderKey(choice) ? <Check size={13} /> : null}
              </DropdownMenuItem>
            )
          })}
          {options.githubConnected ? <MenuLabel>GitHub</MenuLabel> : null}
          {options.githubConnected && repositories === null ? <div className="px-2 py-1.5 text-[11px] text-(--muted-light)">Loading repositories…</div> : null}
          {(repositories ?? []).map(repository => {
            const choice: ThreadFolder = { source: 'github', repository: repository.repository, installationId: repository.installationId }
            return (
              <DropdownMenuItem key={repository.repository} onSelect={() => update(applyFolderChoice(current, choice))} className="gap-2 text-xs">
                <Github size={14} strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{repository.repository.split('/')[1]}</span>
                  <span className="block truncate text-[11px] text-(--muted-light)">{repository.repository}</span>
                </span>
                {folder && folderKey(folder) === folderKey(choice) ? <Check size={13} /> : null}
              </DropdownMenuItem>
            )
          })}
          {macs.filter(mac => mac.roots.length > 0).map(mac => (
            <div key={mac.environmentId}>
              <MenuLabel>{mac.name}</MenuLabel>
              {mac.roots.map((path: string) => {
                const choice: ThreadFolder = { source: 'mac', environmentId: mac.environmentId, path }
                return (
                  <DropdownMenuItem key={path} onSelect={() => update(applyFolderChoice(current, choice))} className="gap-2 text-xs">
                    <Laptop size={14} strokeWidth={1.75} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{folderLabel(choice)}</span>
                      <span className="block truncate text-[11px] text-(--muted-light)">{path}</span>
                    </span>
                    {folder && folderKey(folder) === folderKey(choice) ? <Check size={13} /> : null}
                  </DropdownMenuItem>
                )
              })}
            </div>
          ))}
          <div role="separator" className="my-1 h-px bg-(--border)" />
          <DropdownMenuItem onSelect={() => setAdding(true)} className="gap-2 text-xs text-(--muted)">
            <FolderPlus size={14} strokeWidth={1.75} />
            Add a folder…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddThreadFolderDialog
        open={adding}
        onClose={() => setAdding(false)}
        workspaceId={workspaceId}
        macs={macs}
        githubConnected={options.githubConnected}
        onUseMacFolder={(choice) => update(applyFolderChoice(current, choice))}
      />
    </div>
  )
}
