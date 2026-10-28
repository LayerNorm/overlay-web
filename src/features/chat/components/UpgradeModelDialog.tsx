'use client'

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@overlay/ui/primitives'
import type { ChatModel } from '@/shared/ai/gateway/model-types'

export function UpgradeModelDialog({
  model,
  onOpenChange,
  onUpgrade,
}: {
  model: Pick<ChatModel, 'name'> | null
  onOpenChange: (open: boolean) => void
  onUpgrade: () => void
}) {
  return (
    <Dialog open={Boolean(model)} onOpenChange={onOpenChange}>
      {model ? (
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{model.name} needs a plan</DialogTitle>
          </DialogHeader>
          <DialogDescription>Free workspaces chat with Auto. Upgrade to use every model.</DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Keep Auto</Button>
            <Button onClick={onUpgrade}>Upgrade</Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
