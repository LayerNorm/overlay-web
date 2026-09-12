'use client'

import type { ReactNode } from 'react'
import { AppWindow, MessageSquare, PanelRight } from 'lucide-react'
import { Button, DialogFrame } from '@overlay/ui/primitives'
import { AppScreenSidePanel } from '@overlay/modules-react/shell'

export function SayHelloButton({ mode, hasAgent, highlight, showcase, onSayHello }: {
  mode: 'new' | 'edit'
  hasAgent: boolean
  highlight: boolean
  showcase: boolean
  onSayHello(): void
}) {
  if (mode !== 'edit' || !hasAgent || (!highlight && !showcase)) return null
  return <Button variant="secondary" size="sm" onClick={onSayHello}><MessageSquare size={13} /> Say hello</Button>
}

export function AgentEditorSidePanel({ title, mode, savedFlash, onTogglePanelMode, onClose, children }: {
  title: string
  mode: 'new' | 'edit'
  savedFlash: boolean
  onTogglePanelMode?: () => void
  onClose(): void
  children: ReactNode
}) {
  return (
    <AppScreenSidePanel
      title={title}
      actions={(
        <>
          {savedFlash && mode === 'edit'
            ? <span role="status" className="text-[11px] text-[var(--muted)]">Saved</span>
            : null}
          {onTogglePanelMode ? (
            <button
              type="button"
              onClick={onTogglePanelMode}
              title="Show as dialog"
              aria-label="Show as dialog"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
            >
              <AppWindow size={15} />
            </button>
          ) : null}
        </>
      )}
      onClose={onClose}
      closeLabel="Close agent settings"
      bodyClassName="overflow-hidden"
    >
      {children}
    </AppScreenSidePanel>
  )
}

export function AgentEditorDialog({ title, onTogglePanelMode, onClose, children }: {
  title: string
  onTogglePanelMode?: () => void
  onClose(): void
  children: ReactNode
}) {
  return (
    <DialogFrame
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      title={title}
      actions={onTogglePanelMode ? (
        <button
          type="button"
          onClick={onTogglePanelMode}
          title="Dock panel to the side"
          aria-label="Dock panel to the side"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
        >
          <PanelRight size={14} />
        </button>
      ) : undefined}
      className="max-h-[88vh] w-[min(560px,94vw)] overflow-y-auto border-transparent shadow-2xl"
    >
      {children}
    </DialogFrame>
  )
}
