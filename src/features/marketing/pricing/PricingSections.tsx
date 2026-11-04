import type { CSSProperties } from 'react'
import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@overlay/ui/primitives'
import { MarketingPageHead } from '@/features/marketing/components/StaticMarketingShell'
import { MARKETING_SALES_URL } from '@/shared/marketing/marketing'
import s from './pricing.module.css'

const SETUP_ITEMS = ['Configure your workspace and connections', 'Draft your first task', 'Keep access to your history and exports']
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
  ['When do I pay?', 'Set up your workspace and draft your first task, then subscribe before starting work. Plans start at $8 a month, converted into usage credit. There is no trial.'],
  ['Is billing per person or workspace?', 'Each workspace has its own subscription and shared usage budget. Joining a funded workspace does not require a separate personal subscription.'],
  ['Can I bring my own subscription or API key?', 'Yes, supported connections are optional. A funded workspace is still required, and Overlay-hosted computers and tools use its budget.'],
  ['What uses my credit?', 'Hosted model inference, Overlay Cloud computers, web search, browser tasks, image and video generation, and metered storage.'],
  ['Does unused credit roll over?', 'No. Each month starts with the credit your plan buys. Anything left at renewal, including credit you added, does not carry over.'],
  ['What happens when credit runs out?', 'By default paid resources stop until next month. An owner can instead turn on automatic top-ups, which add credit from the workspace’s card up to a monthly limit they choose.'],
  ['Can I change my plan later?', 'Yes. Change the monthly amount, add credit, switch automatic top-ups on or off, or cancel at any time in your workspace’s billing settings.'],
] as const

export function PricingHero({ appHref }: { appHref: string }) {
  return (
    <MarketingPageHead
      label="Pricing"
      title={<>Pay for what your workspace <span className="k" style={{ '--k': '#ea580c' } as CSSProperties}>actually uses</span></>}
      lead="Plans start at $8 a month, converted into usage credit. Set up your workspace first, then subscribe before your first task. No trial."
    >
      <div className="actions">
        <Link className="btn primary" href={appHref}>Get started <ArrowRight className="i go" /></Link>
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
        <h2>Set up, then start work</h2>
        <p>Prepare your first task before subscribing. You decide when to start it.</p>
      </div>
      <div>
        <div className={s.kinds}>
          <div className={s.kind}>
            <h3>Before payment</h3>
            <div className={s.price}><b>Set up</b>no execution yet</div>
            <ul>{SETUP_ITEMS.map((item) => <Item key={item}>{item}</Item>)}</ul>
          </div>
          <div className={s.kind}>
            <h3>Start work</h3>
            <div className={s.price}><b>From $8</b>a month</div>
            <ul>
              <Item muted>Your monthly payment becomes usage credit</Item>
              {PAID_ITEMS.map((item) => <Item key={item}>{item}</Item>)}
            </ul>
          </div>
        </div>
        <p className={s.note}>
          <b>Payment comes before execution.</b> Bringing your own supported subscription or API key is optional. It does not replace workspace funding.
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
        <h2 className="h2">Start with your first real task.</h2>
        <div className="actions">
          <Link className="btn primary" href={appHref}>Get started <ArrowRight className="i go" /></Link>
          <a className="btn ghost" href={MARKETING_SALES_URL} target="_blank" rel="noopener noreferrer">Talk to us</a>
        </div>
      </div>
    </section>
  )
}
