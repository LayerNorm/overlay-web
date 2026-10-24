import type { CSSProperties } from 'react'
import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@overlay/ui/primitives'
import { MarketingPageHead } from '@/features/marketing/components/StaticMarketingShell'
import { MARKETING_SALES_URL } from '@/shared/marketing/marketing'
import s from './pricing.module.css'

const FREE_ITEMS = ['Auto model, with weekly limits', 'Notes, chats, files and knowledge', '10 MB of storage']
const PAID_ITEMS = [
  'Premium models',
  'Overlay Cloud computers',
  'Web search and browser tasks',
  'Image and video generation',
  'More storage',
]

const TRUST = [
  ['Credit is spent first', 'Nothing is charged to your card for usage while credit remains.'],
  ['On-demand is off until you turn it on', 'Out of the box, paid resources stop at $0.'],
  ['Every line is itemized', 'Each resource is totaled separately, to the cent, with its quantity.'],
  ['Your limit is the limit', 'Automatic top-ups never go past the monthly limit you set.'],
] as const

const FAQ = [
  ['Is free or paid a setting on my account?', 'No. Each workspace is free or paid on its own. You can have a free workspace and a paid one under the same account.'],
  ['What does a free workspace include?', 'The Auto model, notes, chats, files and knowledge, and 10 MB of storage. Each free workspace gets 15 chat messages, 15 writing requests and 15 agent runs a week, and 10 minutes of transcription.'],
  ['How many free workspaces can I own?', 'Up to three. Joining other people’s workspaces does not count. Add a plan to any workspace whenever you want more.'],
  ['What counts as a paid resource?', 'Premium models, Overlay Cloud computers, web search, browser tasks, image and video generation, and storage beyond the free 10 MB.'],
  ['Does unused credit roll over?', 'No. Each month starts with the credit your plan buys. Anything left at renewal, including credit you added, does not carry over.'],
  ['What happens when credit runs out?', 'By default paid resources stop until next month. An owner can instead turn on automatic top-ups, which add credit from the workspace’s card up to a monthly limit they choose.'],
  ['Can I change my plan later?', 'Yes. Change the monthly amount, add credit, switch automatic top-ups on or off, or cancel at any time in your workspace’s billing settings.'],
] as const

export function PricingHero({ appHref }: { appHref: string }) {
  return (
    <MarketingPageHead
      label="Pricing"
      title={<>Pay for what your workspace <span className="k" style={{ '--k': '#ea580c' } as CSSProperties}>actually uses</span></>}
      lead="Every workspace is free or paid. Paid plans start at $8 a month, which becomes $8 of credit for that month. What you use comes out of it."
    >
      <div className="actions">
        <Link className="btn primary" href={appHref}>Start free <ArrowRight className="i go" /></Link>
        <a className="btn ghost" href="#bill">See an example bill</a>
      </div>
    </MarketingPageHead>
  )
}

function Item({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <li className={muted ? s.plus : undefined}>
      <Check className={s.i} aria-hidden="true" />
      {children}
    </li>
  )
}

export function PricingKinds() {
  return (
    <section>
      <div className={s.lab}>
        <h2>Two kinds of workspace</h2>
        <p>A workspace is free or paid. Your account is neither; it just belongs to workspaces.</p>
      </div>
      <div>
        <div className={s.kinds}>
          <div className={s.kind}>
            <h3>Free</h3>
            <div className={s.price}><b>$0</b>no card needed</div>
            <ul>{FREE_ITEMS.map((item) => <Item key={item}>{item}</Item>)}</ul>
          </div>
          <div className={s.kind}>
            <h3>Paid</h3>
            <div className={s.price}><b>From $8</b>a month</div>
            <ul>
              <Item muted>Everything in Free</Item>
              {PAID_ITEMS.map((item) => <Item key={item}>{item}</Item>)}
            </ul>
          </div>
        </div>
        <p className={s.note}>
          <b>Free workspaces never need a card.</b> Each person can own up to three free workspaces. A paid resource in a free workspace asks you to add a plan first.
        </p>
      </div>
    </section>
  )
}

export function PricingTrust() {
  return (
    <section>
      <div className={s.lab}><h2>No surprises</h2></div>
      <div className={s.trust}>
        {TRUST.map(([title, text]) => (
          <div key={title}>
            <h3><Check className={s.i} aria-hidden="true" />{title}</h3>
            <p>{text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

export function PricingFaq() {
  return (
    <section>
      <div className={s.lab}><h2>Questions</h2></div>
      <Accordion type="single" collapsible className="faq flush">
        {FAQ.map(([question, answer]) => (
          <AccordionItem key={question} value={question} className="last:border-b">
            <AccordionTrigger className="faq-q">{question}</AccordionTrigger>
            <AccordionContent className="body faq-a">{answer}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}

export function PricingEnd({ appHref }: { appHref: string }) {
  return (
    <section className="sec">
      <div className="head center">
        <h2 className="h2">Free or paid, one workspace at a time.</h2>
        <div className="actions">
          <Link className="btn primary" href={appHref}>Start free <ArrowRight className="i go" /></Link>
          <a className="btn ghost" href={MARKETING_SALES_URL} target="_blank" rel="noopener noreferrer">Talk to us</a>
        </div>
      </div>
    </section>
  )
}
