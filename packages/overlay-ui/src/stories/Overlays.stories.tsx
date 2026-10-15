import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { Button } from '../components/primitives/Button'
import { ConfirmDialog } from '../components/overlays/ConfirmDialog'
import { DelayedTooltip } from '../components/overlays/DelayedTooltip'
import { DialogFrame } from '../components/primitives/Dialog'

function DialogFrameDemo() {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Open dialog
      </Button>
      <DialogFrame
        open={open}
        title="Name your workspace"
        description="Your chats, files, and agents live here."
        onOpenChange={setOpen}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep this name
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Continue
            </Button>
          </>
        }
      >
        <input
          className="mt-3 w-full rounded-lg border border-(--border) bg-(--background) px-3 py-2 text-sm text-(--foreground) outline-hidden focus:ring-2 focus:ring-(--foreground)/15"
          defaultValue="Personal's workspace"
          aria-label="Workspace name"
        />
      </DialogFrame>
    </div>
  )
}

function ConfirmDialogDemo() {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete memory
      </Button>
      <ConfirmDialog
        isOpen={open}
        title="Delete this memory?"
        description="The memory will be removed from the workspace knowledge surface. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </div>
  )
}

const meta: Meta = {
  title: 'Overlay/Overlays',
}

export default meta

export const Dialog: StoryObj = {
  render: () => <DialogFrameDemo />,
}

export const AlertDialog: StoryObj = {
  render: () => <ConfirmDialogDemo />,
}

export const Tooltip: StoryObj = {
  render: () => (
    <div className="flex items-center gap-4 p-8">
      <DelayedTooltip label="Send (↵) · new line (⇧↵)" side="top">
        <Button variant="primary">Hover me</Button>
      </DelayedTooltip>
      <DelayedTooltip label="Opens in the right-hand panel" side="bottom">
        <Button variant="secondary">Bottom side</Button>
      </DelayedTooltip>
      <DelayedTooltip label="Left-side tooltip" side="left">
        <Button variant="ghost">Left side</Button>
      </DelayedTooltip>
    </div>
  ),
}
