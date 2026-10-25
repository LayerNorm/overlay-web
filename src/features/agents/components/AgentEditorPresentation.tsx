'use client'

import { unstyledButton } from '@overlay/ui/control-reset'

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

export function AgentEditorSidePanel({ title, onTogglePanelMode, onClose, children }: {
  title: string
  onTogglePanelMode?: () => void
  onClose(): void
  children: ReactNode
}) {
  return (
    <AppScreenSidePanel
      title={title}
      actions={(
        <>
          {onTogglePanelMode ? (
            <Button variant="ghost"
              type="button"
              onClick={onTogglePanelMode}
              title="Show as dialog"
              aria-label="Show as dialog"
              className={unstyledButton(`inline-flex h-8 w-8 items-center justify-center rounded-lg text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)`)}
            >
              <AppWindow size={15} />
            </Button>
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
        <Button variant="ghost"
          type="button"
          onClick={onTogglePanelMode}
          title="Dock panel to the side"
          aria-label="Dock panel to the side"
          className={unstyledButton(`inline-flex h-7 w-7 items-center justify-center rounded-md text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)`)}
        >
          <PanelRight size={14} />
        </Button>
      ) : undefined}
      className="max-h-[88vh] w-[min(560px,94vw)] overflow-y-auto border-transparent shadow-2xl"
    >
      {children}
    </DialogFrame>
  )
}
