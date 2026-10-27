'use client'

import { useState } from 'react'
import { Check, Link2, Plus } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { ProviderLogo } from '@overlay/ui/ai'
import { useByokModels } from '@/components/providers/useByokModels'
import { ConnectProviderDialog } from '@/features/settings/components/ConnectProviderDialog'
import { subscriptionLogo } from '@/features/settings/components/subscription-connection-client'

export function OnboardingSubscriptions({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const { connections, refresh } = useByokModels()
  const subscriptions = connections.filter((connection) => connection.providerId.startsWith('subscription:') && connection.status === 'active')
  return <div className="mb-5">
    <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Bring your AI subscription</p>
    <div className="divide-y divide-(--border) overflow-hidden rounded-xl border border-(--border) bg-(--surface-elevated)">
      {subscriptions.map((connection) => <div key={connection._id} className="flex items-center gap-3 px-3.5 py-3">
        <ProviderLogo provider={subscriptionLogo(connection.providerId)} size={20} />
        <span className="min-w-0 flex-1 text-[13px]">{connection.displayName}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Check size={13} />Connected</span>
      </div>)}
      <Button variant="ghost" className="h-auto w-full justify-start gap-3 rounded-none px-3.5 py-3" disabled={disabled} onClick={() => setOpen(true)}>
        <Link2 size={18} />
        <span className="flex-1 text-left"><span className="block text-[13px]">Connect a provider</span><span className="block text-xs font-normal text-muted-foreground">Use your connected models in Overlay.</span></span>
        <Plus size={15} />
      </Button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">Optional. You can use Overlay models instead.</p>
    {open ? <ConnectProviderDialog onClose={() => setOpen(false)} onConnected={refresh} /> : null}
  </div>
}
