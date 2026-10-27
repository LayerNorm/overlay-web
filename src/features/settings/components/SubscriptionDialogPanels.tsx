'use client'

import { ArrowUpRight, Check, Copy, Loader2, LockKeyhole } from 'lucide-react'
import { Button, Input } from '@overlay/ui/primitives'
import { ProviderLogo } from '@overlay/ui/ai'
import type { ByokConnectionRow } from '@/shared/ai/gateway/byok-model-conversion'
import { safeHttpUrl } from '@/shared/security/safe-url'
import { subscriptionLogo } from './subscription-connection-client'
import type { useSubscriptionConnection } from './use-subscription-connection'

type Flow = ReturnType<typeof useSubscriptionConnection>
type Provider = NonNullable<Flow['availability']>['providers'][number]
type Authorization = NonNullable<Flow['login']>['authorization']

export function SubscriptionFooter({
  flow,
  selected,
  onClose,
  onStart,
}: {
  flow: Flow
  selected?: Provider
  onClose(): void
  onStart(): void
}) {
  const authorization = flow.login?.authorization
  return <div className="flex justify-end gap-2">
    <Button variant="ghost" disabled={flow.busy} onClick={onClose}>{flow.connected ? 'Done' : 'Cancel'}</Button>
    {!flow.connected && (!authorization || flow.stopped) ? <Button variant="primary" disabled={flow.busy || !selected?.enabled || !flow.availability?.available} onClick={onStart}>{flow.busy ? <Loader2 size={14} className="animate-spin" /> : null}{flow.stopped ? 'Start again' : 'Continue'}</Button> : null}
  </div>
}

export function ConnectedStatePanel({ flow }: { flow: Flow }) {
  return <div className="space-y-3 py-4 text-center" role="status">
    <span className="mx-auto grid size-11 place-items-center rounded-full bg-(--surface-muted)"><Check size={21} /></span>
    <p className="text-sm">{flow.connected?.enabledModelIds.length} models added to your dropdown.</p>
    <p className="text-xs text-muted-foreground">Choose a model in any compatible Overlay chat or agent.</p>
  </div>
}

export function AuthorizationPanel({
  flow,
  authorization,
  providerLabel,
  copied,
  callbackUrl,
  onCopyCode,
  onCallbackUrlChange,
  onCompleteCallback,
}: {
  flow: Flow
  authorization: NonNullable<Authorization>
  providerLabel?: string
  copied: boolean
  callbackUrl: string
  onCopyCode(): void
  onCallbackUrlChange(value: string): void
  onCompleteCallback(): void
}) {
  const url = safeHttpUrl(authorization.url)
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Sign in with your provider to connect your account.</p>
    {authorization.userCode ? <div className="flex items-center justify-between rounded-lg border border-(--border) px-4 py-3">
      <div><p className="text-xs text-muted-foreground">Enter this code</p><p className="mt-1 font-mono text-lg tracking-widest">{authorization.userCode}</p></div>
      <Button variant="ghost" size="icon-sm" aria-label={copied ? 'Code copied' : 'Copy sign-in code'} onClick={onCopyCode}>{copied ? <Check size={15} /> : <Copy size={15} />}</Button>
    </div> : null}
    {url && !flow.stopped ? <Button asChild variant="secondary" className="w-full"><a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open {providerLabel ?? 'provider'}<ArrowUpRight size={14} /></a></Button> : null}
    {authorization.callbackRequired && !flow.stopped ? <div className="space-y-2">
      <label htmlFor="subscription-callback" className="text-xs text-muted-foreground">After sign-in, paste the final callback URL here.</label>
      <Input id="subscription-callback" type="password" autoComplete="off" value={callbackUrl} maxLength={8192} onChange={(event) => onCallbackUrlChange(event.target.value)} placeholder="Callback URL" />
      <Button size="sm" disabled={!callbackUrl.trim() || flow.busy} onClick={onCompleteCallback}>Complete sign-in</Button>
    </div> : null}
    {!flow.stopped ? <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 size={13} className="animate-spin" />Waiting for sign-in. This updates automatically.</p> : null}
  </div>
}

export function ProviderChoicePanel({
  flow,
  connection,
  providerId,
  onProviderChange,
}: {
  flow: Flow
  connection?: ByokConnectionRow
  providerId: string
  onProviderChange(providerId: string): void
}) {
  return <>
    <p className="text-sm text-muted-foreground">Use an account you already pay for.</p>
    {!flow.availability && !flow.error ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" />Loading providers...</p> : null}
    {flow.availability && !flow.availability.available ? <p className="rounded-lg bg-(--surface-muted) p-3 text-xs text-muted-foreground">{flow.availability.reason ?? 'Subscription connections are not configured on this deployment. You can still connect an API key.'}</p> : null}
    <div className="space-y-1.5" aria-label="Subscription providers">
      {flow.availability?.providers.filter((provider) => !connection || provider.id === providerId).map((provider) => <Button key={provider.id} variant={providerId === provider.id ? 'secondary' : 'ghost'} className="h-auto min-h-14 w-full justify-start gap-3 px-3 py-2.5 text-left" disabled={flow.busy || !provider.enabled || !flow.availability?.available} aria-pressed={providerId === provider.id} onClick={() => onProviderChange(provider.id)}>
        <ProviderLogo provider={subscriptionLogo(provider.id)} size={21} />
        <span className="min-w-0 flex-1"><span className="block text-sm">{provider.label}</span><span className="block text-xs font-normal text-muted-foreground">{provider.description}</span></span>
        {providerId === provider.id ? <Check size={15} /> : null}
      </Button>)}
    </div>
  </>
}

export function SubscriptionPrivacyNote() {
  return <p className="flex items-start gap-2 border-t border-(--border) pt-3 text-xs leading-relaxed text-muted-foreground"><LockKeyhole size={13} className="mt-0.5 shrink-0" />Your connection stays personal. Provider limits apply. Overlay will not switch to paid inference if it becomes unavailable.</p>
}
