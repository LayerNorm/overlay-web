'use client'

import { useState, type ReactNode } from 'react'
import { Check, Cloud, Folder, Github, Laptop } from 'lucide-react'
import { Button, DialogFrame, Input, toast } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { ThreadFolder } from '@/shared/agents/thread-work'
import type { ThreadMac } from './ThreadWorkFooter'

/**
 * Adds a folder a thread can work in (internal/develop/thread-folders.md): a GitHub repository through the GitHub
 * App, or a folder on one of the viewer's own Macs, used in place or copied into Overlay Files once.
 */

type Kind = 'github' | 'mac' | 'files'

function OptionRow({ selected, icon, title, detail, onSelect }: { selected: boolean; icon: ReactNode; title: string; detail: string; onSelect(): void }) {
  return (
    <Button
      variant="ghost"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`h-auto w-full items-start justify-start gap-3 whitespace-normal rounded-xl border px-3 py-2.5 text-left font-normal hover:bg-(--surface-subtle) ${selected ? 'border-(--foreground)/30' : 'border-(--border)'}`}
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

export function AddThreadFolderDialog({ open, onClose, workspaceId, macs, githubConnected, onUseMacFolder }: {
  open: boolean
  onClose(): void
  workspaceId: string
  macs: ThreadMac[]
  githubConnected: boolean
  onUseMacFolder(folder: Extract<ThreadFolder, { source: 'mac' }>): void
}) {
  const [kind, setKind] = useState<Kind>(macs.length > 0 ? 'mac' : 'github')
  const [macId, setMacId] = useState<string | null>(null)
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState<'use' | 'copy' | null>(null)
  const mac = macs.find(entry => entry.environmentId === macId) ?? macs[0] ?? null
  const trimmed = path.trim().replace(/\/+$/, '')
  const validPath = trimmed.startsWith('/') && trimmed.length > 1

  const connectGitHub = () => {
    const returnTo = `${window.location.pathname}${window.location.search}`
    window.location.assign(overlayAppClient.github.connectUrl(workspaceId, returnTo))
  }

  // Installing happens on GitHub in its own tab; connecting afterwards picks the installation up.
  const installGitHub = () => {
    window.open(overlayAppClient.github.installUrl(), '_blank', 'noopener')
  }

  const addOnMac = async () => {
    if (!mac || !validPath) return
    setBusy('use')
    try {
      // A Mac that may use all of the user's files needs no new approval; otherwise the folder joins its approved list.
      if (!mac.allFiles && !mac.roots.includes(trimmed)) {
        await overlayAppClient.agentEnvironments.updateRoots(workspaceId, mac.environmentId, {
          mode: 'selected_roots', roots: [...mac.roots, trimmed],
        })
        toast('Folder added. The Mac picks it up the next time it renews its access, within 15 minutes.')
      }
      onUseMacFolder({ source: 'mac', environmentId: mac.environmentId, path: trimmed })
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t add the folder.')
    } finally {
      setBusy(null)
    }
  }

  const copyToFiles = async () => {
    if (!mac || !validPath) return
    setBusy('copy')
    try {
      const result = await overlayAppClient.agentEnvironments.copyToFiles(workspaceId, mac.environmentId, { path: trimmed })
      toast(`Copied ${result.copied} files to Overlay Files${result.skipped.length ? `. ${result.skipped.length} weren’t copied.` : '.'}`)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t copy the folder.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <DialogFrame
      open={open}
      onOpenChange={(next) => { if (!next) onClose() }}
      title="Add a folder"
      description="Threads can work in folders from Overlay Files, GitHub or one of your Macs."
      className="flex max-h-[min(760px,calc(100vh-32px))] w-[min(480px,94vw)]! flex-col"
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-2">
        <div role="radiogroup" aria-label="Where the folder comes from" className="space-y-2">
          <OptionRow selected={kind === 'mac'} icon={<Laptop size={15} strokeWidth={1.75} />} title="A folder on your Mac" detail="Only your own Macs. The thread runs on that Mac." onSelect={() => setKind('mac')} />
          <OptionRow selected={kind === 'github'} icon={<Github size={15} strokeWidth={1.75} />} title="GitHub repository" detail="Cloned on the cloud computer. Changes go back as a pull request." onSelect={() => setKind('github')} />
          <OptionRow selected={kind === 'files'} icon={<Folder size={15} strokeWidth={1.75} />} title="Overlay Files folder" detail="Copied onto the computer when a run starts and saved back when it ends." onSelect={() => setKind('files')} />
        </div>

        {kind === 'mac' && macs.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-(--muted-light)">
            Connect a Mac first: open the Overlay desktop app on it and sign in, or use Settings → Desktop → This Mac.
          </p>
        ) : null}
        {kind === 'mac' && mac ? (
          <section className="space-y-2">
            {macs.length > 1 ? (
              <div role="radiogroup" aria-label="Which Mac" className="flex flex-wrap gap-1.5">
                {macs.map(entry => (
                  <Button
                    key={entry.environmentId}
                    variant={entry.environmentId === mac.environmentId ? 'secondary' : 'ghost'}
                    size="xs"
                    role="radio"
                    aria-checked={entry.environmentId === mac.environmentId}
                    onClick={() => setMacId(entry.environmentId)}
                    className="gap-1.5"
                  >
                    <Laptop size={12} strokeWidth={1.75} />{entry.name}
                  </Button>
                ))}
              </div>
            ) : null}
            <Input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/Users/you/code/project"
              aria-label="Folder path on the Mac"
              className="font-mono text-xs"
            />
            <p className="text-[11px] leading-relaxed text-(--muted-light)">
              Copying to Files leaves out node_modules, build output, .git and .env files.
            </p>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" disabled={!validPath || busy !== null} onClick={() => void copyToFiles()}>
                <Cloud size={14} />{busy === 'copy' ? 'Copying…' : 'Copy to Overlay Files'}
              </Button>
              <Button variant="primary" size="sm" disabled={!validPath || busy !== null} onClick={() => void addOnMac()}>
                <Laptop size={14} />{busy === 'use' ? 'Adding…' : `Use on ${mac.name}`}
              </Button>
            </div>
          </section>
        ) : null}
        {kind === 'github' ? (
          <section className="space-y-2">
            <p className="text-[11px] leading-relaxed text-(--muted-light)">
              {githubConnected
                ? 'Your repositories are listed in the folder menu. To add another account or organization, install the app there, then connect again.'
                : 'Install the Overlay GitHub App on your account or organization and choose its repositories, then connect.'}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={installGitHub}>Install on GitHub</Button>
              <Button variant="primary" size="sm" onClick={connectGitHub}><Github size={14} />{githubConnected ? 'Connect again' : 'Connect GitHub'}</Button>
            </div>
          </section>
        ) : null}
        {kind === 'files' ? (
          <p className="text-[11px] leading-relaxed text-(--muted-light)">
            Folders you create in Files are listed in the folder menu. Only the folder you choose is copied, never the whole workspace.
          </p>
        ) : null}
      </div>
    </DialogFrame>
  )
}
