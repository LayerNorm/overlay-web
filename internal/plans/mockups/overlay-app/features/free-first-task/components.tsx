'use client'

import { useState, useSyncExternalStore } from 'react'
import { ArrowRight, Play } from 'lucide-react'
import { Button, Checkbox } from '@overlay/ui/primitives'
import { LEGAL_DOCUMENTS } from '@/shared/legal/legal-documents'
import { OverlayMark } from '@/components/brand/OverlayMark'
import { BrandMark } from '@/app/_components/onboarding/onboarding-logos'
import styles from '@/app/_components/onboarding/onboarding.module.css'
import { fixtureVersion, subscribeFixtures } from '../../fixtures/convex'
import { ONBOARDING_ROOM, followUp, overlaySays, personSays, type FollowUpStage } from './fixtures'

export const FREE_FIRST_TASK_HINT = 'Two quick questions, then your first task runs free. No card needed.'

/** Replaces the payment step: the drafted first task starts without a plan. */
export function FreeFirstTask({ title, disabled, workspaceName, personal, onStart, onEdit }: {
  title: string
  disabled: boolean
  workspaceName?: string
  personal?: boolean
  onStart(): Promise<void>
  onEdit(): void
} & Record<string, unknown>) {
  const [busy, setBusy] = useState(false)
  const locked = disabled || busy
  const start = async () => {
    setBusy(true)
    try { await onStart() } finally { setBusy(false) }
  }
  return <div className="space-y-4">
    <div className="rounded-xl bg-(--surface-subtle) p-4">
      <p className="text-[11px] text-muted-foreground">First task</p>
      <p className="mt-1 text-sm font-medium break-words">{title}</p>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><OverlayMark size={16} />Overlay<span className="ml-2">{personal ? 'Personal' : workspaceName}</span></div>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" size="sm" disabled={locked} onClick={() => void start()}><Play size={13} />Start task</Button>
      <Button variant="ghost" size="sm" disabled={locked} onClick={onEdit}>Edit task</Button>
    </div>
    <p className="text-xs text-muted-foreground">Free. You'll choose a plan after you see the result.</p>
  </div>
}

function useFollowUpStage() {
  useSyncExternalStore(subscribeFixtures, fixtureVersion, fixtureVersion)
  return followUp.stage
}

/** Controls under Overlay's last message in the onboarding chat, once the free first task has finished. */
export function FirstResultFollowUp({ conversationId }: { conversationId: string }) {
  const stage = useFollowUpStage()
  if (conversationId !== ONBOARDING_ROOM || (stage !== 'offer' && stage !== 'subscribed')) return null
  return <div className={styles.reply}>
    <div key={stage} className={styles.appear}>{stage === 'offer' ? <SubscribeOffer /> : <BringOverlayToSlack />}</div>
  </div>
}

function advance(stage: FollowUpStage, said: string, reply: string) {
  followUp.stage = stage
  personSays(said)
  window.setTimeout(() => overlaySays(reply), 450)
}

function SubscribeOffer() {
  const [accepted, setAccepted] = useState(false)
  return <div className="space-y-4">
    <div><p><strong className="text-2xl font-semibold">$8</strong><span className="text-sm text-muted-foreground"> / month</span></p>
      <p className="mt-2 text-sm">$8 in usage credit for models, computers and tools.</p>
      <p className="mt-1 text-xs text-muted-foreground">Renews monthly. Unused credit expires at renewal. Cancel in billing settings.</p>
    </div>
    <label className="flex items-start gap-2 text-xs text-muted-foreground">
      <Checkbox checked={accepted} onCheckedChange={(value) => setAccepted(value === true)} aria-label="Accept terms and privacy policy" />
      <span>I agree to the <a className="underline" href={LEGAL_DOCUMENTS.terms.href} target="_blank" rel="noreferrer">Terms of Service</a> and <a className="underline" href={LEGAL_DOCUMENTS.privacy.href} target="_blank" rel="noreferrer">Privacy Policy</a>.</span>
    </label>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" size="sm" disabled={!accepted} onClick={() => advance('subscribed', 'Subscribed', "You're subscribed. Want me in Slack too? Mention @Overlay in any channel and I'll reply in the thread.")}>Subscribe<ArrowRight size={14} /></Button>
      <Button variant="ghost" size="sm" onClick={() => advance('done', 'Not now', "No problem. Everything is saved here and in Work. You can subscribe from Billing in Settings whenever you're ready.")}>Not now</Button>
    </div>
  </div>
}

function BringOverlayToSlack() {
  const done = (said: string, reply: string) => advance('done', said, reply)
  return <div className="flex flex-wrap items-center gap-2">
    <Button variant="outline" size="sm" onClick={() => done('Add to Slack', "I'm in your Slack workspace now. Try mentioning @Overlay in #general.")}><BrandMark id="slack" size={14} />Add to Slack</Button>
    <Button variant="outline" size="sm" onClick={() => done('Connect Gmail', "Gmail is connected. I'll draft replies for you to review and never send without asking.")}><BrandMark id="gmail" size={14} />Connect Gmail</Button>
    <Button variant="ghost" size="sm" onClick={() => done('Maybe later', 'Sure. You can add Slack and other apps anytime from Settings.')}>Maybe later</Button>
  </div>
}
