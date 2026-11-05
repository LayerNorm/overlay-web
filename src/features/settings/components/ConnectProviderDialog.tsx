'use client'

import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Button, DialogFrame } from '@overlay/ui/primitives'
import type { ByokConnectionRow } from '@/shared/ai/gateway/byok-model-conversion'
import { useOptionalWorkspace } from '@/contexts/WorkspaceContext'
import type { SubscriptionScope } from './subscription-connection-client'
import { ProviderDialog } from './ProviderDialog'
import {
  AuthorizationPanel,
  ConnectedStatePanel,
  ProviderChoicePanel,
  SubscriptionFooter,
  SubscriptionPrivacyNote,
  SubscriptionScopeSelector,
} from './SubscriptionDialogPanels'
import { useSubscriptionConnection } from './use-subscription-connection'

type Props = { connection?: ByokConnectionRow; onClose(): void; onConnected(): Promise<void> | void }

export function ConnectProviderDialog(props: Props) {
  const workspace = useOptionalWorkspace()
  const workspaceReady = !workspace || (workspace.status === 'ready' && !workspace.switchingWorkspaceId)
  const [kind, setKind] = useState<'subscription' | 'api-key'>('subscription')
  const [busy, setBusy] = useState(false)
  const tabs = <div className="flex gap-1 rounded-lg bg-(--surface-muted) p-1" aria-label="Connection type">
    <Button variant={kind === 'subscription' ? 'secondary' : 'ghost'} size="sm" className="flex-1" aria-pressed={kind === 'subscription'} disabled={busy} onClick={() => setKind('subscription')}>Subscription</Button>
    <Button variant={kind === 'api-key' ? 'secondary' : 'ghost'} size="sm" className="flex-1" aria-pressed={kind === 'api-key'} disabled={busy} onClick={() => setKind('api-key')}><KeyRound size={13} />API key</Button>
  </div>
  if (kind === 'api-key' && !props.connection) return <ProviderDialog state={{ mode: 'add' }} busy={busy} onBusyChange={setBusy} onClose={props.onClose} onSaved={() => { void props.onConnected(); props.onClose() }} intro={tabs} />
  return <SubscriptionDialog key={`${props.connection?._id ?? 'new'}:${workspace?.activeWorkspaceId ?? 'personal'}`} {...props} workspaceId={workspace?.activeWorkspaceId ?? undefined} workspaceReady={workspaceReady} workspaceName={workspace?.activeWorkspace?.name} tabs={props.connection ? null : tabs} />
}

function SubscriptionDialog({ connection, onClose, onConnected, tabs, workspaceId, workspaceReady, workspaceName }: Props & { tabs: React.ReactNode; workspaceId?: string; workspaceReady: boolean; workspaceName?: string }) {
  const [scope, setScope] = useState<SubscriptionScope>(connection?.scope ?? 'personal')
  const flow = useSubscriptionConnection({ connection, scope, workspaceId, onConnected, onClose })
  const [providerId, setProviderId] = useState(connection?.providerId.replace(/^subscription:/, '') ?? '')
  const [copied, setCopied] = useState(false)
  const [callbackUrl, setCallbackUrl] = useState('')
  const selected = flow.availability?.providers.find((provider) => provider.id === providerId)
  const authorization = flow.login?.authorization
  const copyCode = () => {
    if (!authorization?.userCode) return
    void navigator.clipboard.writeText(authorization.userCode).then(() => setCopied(true), () => setCopied(false))
  }
  const title = flow.connected ? `${flow.connected.displayName} connected` : authorization ? `Connect ${selected?.label ?? connection?.displayName ?? 'provider'}` : connection ? `Reconnect ${connection.displayName}` : 'Add provider'
  return <DialogFrame
    open
    title={title}
    className="w-[min(480px,92vw)] max-h-[calc(100dvh-2rem)] overflow-y-auto"
    onOpenChange={(open) => { if (!open) void flow.close() }}
    footer={<SubscriptionFooter
      flow={flow}
      selected={selected}
      onClose={() => { void flow.close() }}
      onStart={() => { setCopied(false); void flow.start(providerId) }}
      startDisabled={!workspaceReady}
    />}
  >
    <div className="mt-4 space-y-4">
      {!authorization && !flow.busy && !flow.selectionLocked ? tabs : null}
      {flow.connected ? <ConnectedStatePanel flow={flow} /> : authorization
        ? <AuthorizationPanel
          flow={flow}
          authorization={authorization}
          providerLabel={selected?.label}
          copied={copied}
          callbackUrl={callbackUrl}
          onCopyCode={copyCode}
          onCallbackUrlChange={setCallbackUrl}
          onCompleteCallback={() => {
            void flow.completeCallback(callbackUrl).then(() => setCallbackUrl(''))
          }}
        />
        : <>
          <SubscriptionScopeSelector scope={scope} onScopeChange={setScope} workspaceName={workspaceName} workspaceAvailable={Boolean(workspaceId) && workspaceReady} disabled={flow.busy || flow.selectionLocked} />
          <ProviderChoicePanel
          flow={flow}
          connection={connection}
          providerId={providerId}
          onProviderChange={setProviderId}
        /></>}
      {flow.error ? <p role="alert" className="text-xs text-destructive">{flow.error}</p> : null}
      <SubscriptionPrivacyNote />
    </div>
  </DialogFrame>
}
