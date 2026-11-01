'use client'

import { Fragment, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import { ChevronRight, Trash2 } from 'lucide-react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
  Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  Label, SelectRoot as Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch,
} from '@overlay/ui'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  const control = isValidElement(children) && children.type !== Fragment
    ? cloneElement(children as ReactElement<{ id?: string }>, { id })
    : children
  return <div className="grid gap-2"><Label htmlFor={id}>{label}</Label>{control}</div>
}

export function FieldSelect({ id, value, onChange, options, 'aria-label': ariaLabel }: {
  id?: string; value: string; onChange: (value: string) => void
  options: readonly { value: string; label: string }[]
  'aria-label'?: string
}) {
  return <Select value={value} onValueChange={onChange}>
    <SelectTrigger id={id} aria-label={ariaLabel} className="rounded-md bg-(--surface-elevated)"><SelectValue /></SelectTrigger>
    <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>
}

export function ExtensionIcon({ children }: { children: ReactNode }) {
  return <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-(--surface-subtle) text-(--foreground)">{children}</div>
}

export function ExtensionCard({ icon, title, description, status, statusTone = 'muted', metadata, detail, onEdit, children }: {
  icon: ReactNode; title: string; description?: string; status: string
  statusTone?: 'muted' | 'active' | 'connected' | 'error'
  metadata: ReactNode; detail: string; onEdit: () => void; children?: ReactNode
}) {
  const dot = { muted: 'bg-(--muted-light)', active: 'bg-(--foreground)', connected: 'bg-emerald-500', error: 'bg-red-500' }[statusTone]
  return <Card className="gap-5 overflow-hidden pb-4 shadow-none">
    <CardHeader>
      <div className="flex items-center justify-between gap-3">
        <ExtensionIcon>{icon}</ExtensionIcon>
        <Badge variant="muted" className={`gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-normal ${statusTone === 'error' ? 'text-red-500' : ''}`}><span className={`size-1.5 rounded-full ${dot}`} />{status}</Badge>
      </div>
      <CardTitle className="mt-4 text-base">{title}</CardTitle>
      <CardDescription className="mt-1 min-h-12 line-clamp-2 leading-6">{description}</CardDescription>
    </CardHeader>
    <CardContent className="mt-auto space-y-2 text-xs text-(--muted)">
      <div className="flex flex-wrap items-center gap-1.5">{metadata}</div>{children}
    </CardContent>
    <CardFooter className="justify-between gap-2 pr-4">
      <span className="truncate text-xs text-(--muted)" title={detail}>{detail}</span>
      <Button variant="ghost" size="sm" className="text-(--foreground)" aria-label={`Manage ${title}`} onClick={onEdit}>Manage<ChevronRight size={14} /></Button>
    </CardFooter>
  </Card>
}

export function ExtensionDialog({ title, description, icon, onClose, enabled, onEnabledChange, activeDescription, busy, scopeActions, scopeLabel, children, footer }: {
  title: string; description: string; icon: ReactNode; onClose: () => void
  enabled: boolean; onEnabledChange: (enabled: boolean) => void; activeDescription: string
  busy?: boolean; scopeActions?: ReactNode; scopeLabel?: string; children: ReactNode; footer: ReactNode
}) {
  const activeId = useId()
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0" onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onPointerDownOutside={event => { if (busy) event.preventDefault() }}>
      <DialogHeader className="shrink-0 justify-start gap-3 px-6 pt-6 pr-12 pb-5">
        <ExtensionIcon>{icon}</ExtensionIcon>
        <div className="min-w-0"><DialogTitle className="text-lg">{title}</DialogTitle><DialogDescription className="mt-1 text-sm">{description}</DialogDescription></div>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6">
        {scopeActions ? <div className="flex items-center justify-between gap-3"><span className="text-xs text-(--muted)">{scopeLabel}</span>{scopeActions}</div> : null}
        {children}
        <div className="mt-6 flex items-center justify-between gap-5">
          <div><Label htmlFor={activeId}>Active</Label><p className="mt-2 text-xs text-(--muted)">{activeDescription}</p></div>
          <Switch id={activeId} checked={enabled} onCheckedChange={onEnabledChange} disabled={busy}
            className="h-5 w-9 border-transparent data-[state=checked]:border-(--foreground) data-[state=checked]:bg-(--foreground) data-[state=unchecked]:bg-(--border) [&_[data-slot=switch-thumb]]:size-4 [&_[data-state=checked]]:translate-x-4 [&_[data-state=unchecked]]:translate-x-0.5" />
        </div>
      </div>
      <DialogFooter className="m-0 shrink-0 justify-between gap-2 px-6 pb-6">{footer}</DialogFooter>
    </DialogContent>
  </Dialog>
}

export function DeleteExtensionButton({ name, kind, disabled, onConfirm }: { name: string; kind: 'server' | 'skill'; disabled?: boolean; onConfirm: () => void }) {
  return <AlertDialog>
    <AlertDialogTrigger asChild><Button variant="ghost" className="-ml-2 px-2 hover:text-red-500" disabled={disabled}><Trash2 size={15} />Delete</Button></AlertDialogTrigger>
    <AlertDialogContent className="w-[min(440px,calc(100vw-2rem))] p-6">
      <AlertDialogHeader><AlertDialogTitle className="text-lg">Delete {name}?</AlertDialogTitle><AlertDialogDescription className="mt-2 text-sm leading-6">This {kind}{kind === 'server' ? ' and its tools' : ''} will no longer be available to your agents. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel asChild><Button variant="outline">Cancel</Button></AlertDialogCancel><AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" disabled={disabled} onClick={onConfirm}>Delete {kind}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
