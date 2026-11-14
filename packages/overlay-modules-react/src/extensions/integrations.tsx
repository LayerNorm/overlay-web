'use client'

import type { ConnectorCatalogItem } from '@overlay/app-core'
import { Loader2 } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@overlay/ui'
import { ExtensionCatalogLogoTile } from './catalog-page'

export interface ConnectorDetailsDialogProps {
  connector: ConnectorCatalogItem
  logoUrl?: string | null
  /** The logo is black on transparent and is inverted in the dark theme. */
  logoInvertInDark?: boolean
  connected: boolean
  busy?: boolean
  /** "Workspace account" or "Your account": whose account the connection uses. */
  accountLabel: string
  onClose: () => void
  onConnect: () => void
  onDisconnect: () => void
}

/** What a connector does and whether it is connected, with the one action that changes that. */
export function ConnectorDetailsDialog({ connector, logoUrl, logoInvertInDark, connected, busy, accountLabel, onClose, onConnect, onDisconnect }: ConnectorDetailsDialogProps) {
  const managedExternally = connected && connector.capabilities?.supportsDisconnect === false
  const connectLabel = connector.capabilities?.connectionSetup === 'provider-console' ? 'Configure' : 'Connect'
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="flex w-[min(480px,calc(100vw-2rem))] flex-col gap-0 p-0">
        <DialogHeader className="items-start justify-start gap-3 px-6 pt-6 pr-12 pb-5">
          <ExtensionCatalogLogoTile name={connector.name} logo={{ kind: 'image', src: logoUrl ?? connector.logoUrl, invertInDark: logoInvertInDark }} />
          <div className="min-w-0">
            <DialogTitle className="text-lg">{connector.name}</DialogTitle>
            <DialogDescription className="mt-1 line-clamp-3 text-sm">{connector.description || 'Lets your agents use this app.'}</DialogDescription>
          </div>
        </DialogHeader>
        <dl className="mx-6 mb-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-(--muted)">Status</dt><dd>{connected ? 'Connected' : 'Not connected'}</dd>
          <dt className="text-(--muted)">Account</dt><dd>{accountLabel}</dd>
        </dl>
        <DialogFooter className="m-0 justify-end gap-2 px-6 pb-6">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {connected ? (
            <Button variant="secondary" disabled={busy || managedExternally} onClick={onDisconnect}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}{managedExternally ? 'Managed externally' : 'Disconnect'}
            </Button>
          ) : (
            <Button variant="primary" disabled={busy} onClick={onConnect}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}{connectLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
