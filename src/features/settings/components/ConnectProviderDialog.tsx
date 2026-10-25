'use client'

import { useState } from 'react'
import { ArrowUpRight, Check, Copy, KeyRound, Loader2, LockKeyhole } from 'lucide-react'
import { Button, DialogFrame, Input } from '@overlay/ui/primitives'
import { ProviderLogo } from '@overlay/ui/ai'
import type { ByokConnectionRow } from '@/shared/ai/gateway/byok-model-conversion'
import { safeHttpUrl } from '@/shared/security/safe-url'
import { ProviderDialog } from './ProviderDialog'
import { subscriptionLogo } from './subscription-connection-client'
import { useSubscriptionConnection } from './use-subscription-connection'

type Props = { connection?: ByokConnectionRow; onClose(): void; onConnected(): Promise<void> | void }

export function ConnectProviderDialog(props: Props) {
  const [kind, setKind] = useState<'subscription' | 'api-key'>('subscription')
  const [busy, setBusy] = useState(false)
  const tabs = <div className="flex gap-1 rounded-lg bg-(--surface-muted) p-1" aria-label="Connection type">
    <Button variant={kind === 'subscription' ? 'secondary' : 'ghost'} size="sm" className="flex-1" aria-pressed={kind === 'subscription'} disabled={busy} onClick={() => setKind('subscription')}>Subscription</Button>
    <Button variant={kind === 'api-key' ? 'secondary' : 'ghost'} size="sm" className="flex-1" aria-pressed={kind === 'api-key'} disabled={busy} onClick={() => setKind('api-key')}><KeyRound size={13} />API key</Button>
  </div>
  if (kind === 'api-key' && !props.connection) return <ProviderDialog state={{ mode: 'add' }} busy={busy} onBusyChange={setBusy} onClose={props.onClose} onSaved={() => { void props.onConnected(); props.onClose() }} intro={tabs} />
  return <SubscriptionDialog {...props} tabs={props.connection ? null : tabs} />
}

function SubscriptionDialog({ connection, onClose, onConnected, tabs }: Props & { tabs: React.ReactNode }) {
  const flow = useSubscriptionConnection({ connection, onConnected, onClose })
  const [providerId, setProviderId] = useState(connection?.providerId.replace(/^subscription:/, '') ?? '')
  const [copied, setCopied] = useState(false)
  const [callbackUrl, setCallbackUrl] = useState('')
  const selected = flow.availability?.providers.find((provider) => provider.id === providerId)
  const authorization = flow.login?.authorization
  const url = safeHttpUrl(authorization?.url)
  const copyCode = () => {
    if (!authorization?.userCode) return
    void navigator.clipboard.writeText(authorization.userCode).then(() => setCopied(true), () => setCopied(false))
  }
  const title = flow.connected ? `${flow.connected.displayName} connected` : authorization ? `Connect ${selected?.label ?? connection?.displayName ?? 'provider'}` : connection ? `Reconnect ${connection.displayName}` : 'Add provider'
  return <DialogFrame open title={title} className="w-[min(480px,92vw)]" onOpenChange={(open) => { if (!open) void flow.close() }} footer={
    <div className="flex justify-end gap-2">
      <Button variant="ghost" disabled={flow.busy} onClick={() => { void flow.close() }}>{flow.connected ? 'Done' : 'Cancel'}</Button>
      {!flow.connected && (!authorization || flow.stopped) ? <Button variant="primary" disabled={flow.busy || !selected?.enabled || !flow.availability?.available} onClick={() => { setCopied(false); void flow.start(providerId) }}>{flow.busy ? <Loader2 size={14} className="animate-spin" /> : null}{flow.stopped ? 'Start again' : 'Continue'}</Button> : null}
    </div>
  }>
    <div className="mt-4 space-y-4">
      {!authorization && !flow.busy ? tabs : null}
      {flow.connected ? <div className="space-y-3 py-4 text-center" role="status">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-(--surface-muted)"><Check size={21} /></span>
        <p className="text-sm">{flow.connected.enabledModelIds.length} models added to your dropdown.</p>
        <p className="text-xs text-muted-foreground">Choose a model in any compatible Overlay chat or agent.</p>
      </div> : authorization ? <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Sign in with your provider to connect your account.</p>
        {authorization.userCode ? <div className="flex items-center justify-between rounded-lg border border-(--border) px-4 py-3">
          <div><p className="text-xs text-muted-foreground">Enter this code</p><p className="mt-1 font-mono text-lg tracking-widest">{authorization.userCode}</p></div>
          <Button variant="ghost" size="icon-sm" aria-label={copied ? 'Code copied' : 'Copy sign-in code'} onClick={copyCode}>{copied ? <Check size={15} /> : <Copy size={15} />}</Button>
        </div> : null}
        {url && !flow.stopped ? <Button asChild variant="secondary" className="w-full"><a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open {selected?.label ?? 'provider'}<ArrowUpRight size={14} /></a></Button> : null}
        {authorization.callbackRequired && !flow.stopped ? <div className="space-y-2">
          <label htmlFor="subscription-callback" className="text-xs text-muted-foreground">After sign-in, paste the final callback URL here.</label>
          <Input id="subscription-callback" type="password" autoComplete="off" value={callbackUrl} maxLength={8192} onChange={(event) => setCallbackUrl(event.target.value)} placeholder="Callback URL" />
          <Button size="sm" disabled={!callbackUrl.trim() || flow.busy} onClick={() => { void flow.completeCallback(callbackUrl).then(() => setCallbackUrl('')) }}>Complete sign-in</Button>
        </div> : null}
        {!flow.stopped ? <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 size={13} className="animate-spin" />Waiting for sign-in. This updates automatically.</p> : null}
      </div> : <>
        <p className="text-sm text-muted-foreground">Use an account you already pay for.</p>
        {!flow.availability && !flow.error ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" />Loading providers...</p> : null}
        {flow.availability && !flow.availability.available ? <p className="rounded-lg bg-(--surface-muted) p-3 text-xs text-muted-foreground">{flow.availability.reason ?? 'Subscription connections are not configured on this deployment. You can still connect an API key.'}</p> : null}
        <div className="space-y-1.5" aria-label="Subscription providers">
          {flow.availability?.providers.filter((provider) => !connection || provider.id === providerId).map((provider) => <Button key={provider.id} variant={providerId === provider.id ? 'secondary' : 'ghost'} className="h-auto min-h-14 w-full justify-start gap-3 px-3 py-2.5 text-left" disabled={flow.busy || !provider.enabled || !flow.availability?.available} aria-pressed={providerId === provider.id} onClick={() => setProviderId(provider.id)}>
            <ProviderLogo provider={subscriptionLogo(provider.id)} size={21} />
            <span className="min-w-0 flex-1"><span className="block text-sm">{provider.label}</span><span className="block text-xs font-normal text-muted-foreground">{provider.description}</span></span>
            {providerId === provider.id ? <Check size={15} /> : null}
          </Button>)}
        </div>
      </>}
      {flow.error ? <p role="alert" className="text-xs text-destructive">{flow.error}</p> : null}
      <p className="flex items-start gap-2 border-t border-(--border) pt-3 text-xs leading-relaxed text-muted-foreground"><LockKeyhole size={13} className="mt-0.5 shrink-0" />Your connection stays personal. Provider limits apply. Overlay will not switch to paid inference if it becomes unavailable.</p>
    </div>
  </DialogFrame>
}
