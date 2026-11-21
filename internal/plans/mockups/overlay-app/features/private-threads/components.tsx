import { useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Check, ChevronDown, Cloud, CloudOff, CloudUpload } from 'lucide-react'
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, toast } from '@overlay/ui/primitives'
import { ConfirmDialog } from '@overlay/ui/overlays'
import { setSynced, useConversationId, useNotSynced } from './store'

// The proposed Cloud sync pieces. They follow ThreadWorkFooter's own chip, menu label and row styles.

function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-light)">{children}</div>
}

function Row({ icon, title, detail, selected }: { icon: ReactNode; title: string; detail: string; selected: boolean }) {
  return (
    <>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{title}</span>
        <span className="block truncate text-[11px] text-(--muted-light)">{detail}</span>
      </span>
      {selected ? <Check size={13} /> : null}
    </>
  )
}

/** Beside This computer and the folder, before the first message. Only shown for threads on this computer. */
export function CloudSyncChoice({ disabled }: { disabled: boolean }) {
  const conversationId = useConversationId()
  const notSynced = useNotSynced(conversationId)
  const Icon = notSynced ? CloudOff : Cloud
  const choose = (synced: boolean) => { if (conversationId) setSynced(conversationId, synced) }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" aria-label="Cloud sync" disabled={disabled} className="h-6 max-w-[220px] gap-1.5 px-1.5 text-[11px] font-normal text-(--muted)">
          <Icon size={12} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate">{notSynced ? 'Not synced' : 'Synced'}</span>
          <ChevronDown size={11} className="shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <MenuLabel>Cloud sync</MenuLabel>
        <DropdownMenuItem onSelect={() => choose(true)} className="gap-2 text-xs">
          <Row icon={<Cloud size={14} strokeWidth={1.75} />} title="Synced" detail="Saved to your workspace" selected={!notSynced} />
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => choose(false)} className="gap-2 text-xs">
          <Row icon={<CloudOff size={14} strokeWidth={1.75} />} title="Not synced" detail="Runs and stays on this computer" selected={notSynced} />
        </DropdownMenuItem>
        <div role="separator" className="my-1 h-px bg-(--border)" />
        <p className="px-2 py-1.5 text-[11px] leading-relaxed text-(--muted-light)">
          The agent can still use its tools, like memory and web search.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** After the first message the choice is fixed; only a thread that is not synced says so. */
export function NotSyncedLabel() {
  const notSynced = useNotSynced(useConversationId())
  if (!notSynced) return null
  return (
    <span title="Set when the thread started" className="inline-flex h-6 min-w-0 max-w-[220px] items-center gap-1.5 px-1.5 text-[11px] text-(--muted-light)">
      <CloudOff size={12} strokeWidth={1.75} className="shrink-0" />
      <span className="truncate">Not synced</span>
    </span>
  )
}

export function NotSyncedMark({ conversationId }: { conversationId: string }) {
  if (!useNotSynced(conversationId)) return null
  return <CloudOff size={12} strokeWidth={1.75} aria-label="Not synced" className="shrink-0 text-(--muted-light)" />
}

// The confirmation lives outside the options menu, which closes when an item is chosen.
const dialog = { conversationId: null as string | null, listeners: new Set<() => void>() }
const openDialog = (conversationId: string | null) => {
  dialog.conversationId = conversationId
  for (const listener of dialog.listeners) listener()
}

export function SyncToCloudMenuItem({ MenuButton, close }: { MenuButton: ComponentType<{ icon: typeof Cloud; label: string; onClick(): void }>; close(): void }) {
  const conversationId = useConversationId()
  if (!useNotSynced(conversationId)) return null
  return <MenuButton icon={CloudUpload} label="Sync to cloud" onClick={() => { close(); openDialog(conversationId) }} />
}

function SyncDialog() {
  const conversationId = useSyncExternalStore((listener) => { dialog.listeners.add(listener); return () => dialog.listeners.delete(listener) }, () => dialog.conversationId)
  return (
    <ConfirmDialog
      isOpen={conversationId !== null}
      title="Sync this thread to the cloud?"
      description="Its messages and tool results are saved to your workspace, and you can read it from any device. This can’t be undone."
      confirmLabel="Sync to cloud"
      destructive={false}
      onCancel={() => openDialog(null)}
      onConfirm={() => {
        if (conversationId) setSynced(conversationId, true)
        openDialog(null)
        toast('Thread synced to the cloud.')
      }}
    />
  )
}

export function mountSyncDialog() {
  const node = document.createElement('div')
  document.body.append(node)
  createRoot(node).render(<SyncDialog />)
}
