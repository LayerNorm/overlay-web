import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@overlay/ui/primitives'

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'How do I run all my AI agents from one place?',
    a: 'Overlay gives every agent a home in one workspace: agents you create in Overlay and agents you already use (Codex, Claude Code, Hermes) connect to the same roster with shared context, tools, and a computer to work from.',
  },
  {
    q: 'Can I bring my own agents to Overlay?',
    a: 'Yes. Connect agents running on machines you control. They join the same roster and receive workspace tools, context, and supervision through Overlay.',
  },
  {
    q: 'Where do Overlay agents work?',
    a: 'In the Overlay app and wherever work already happens: Slack, Telegram, iMessage, and the web. Agents can be scheduled or triggered, and they report back to the same place.',
  },
  {
    q: 'How do I control what agents can do?',
    a: 'Permissions, tool approvals, spend limits, run history, and audit trails apply to every agent on the roster, not just the ones Overlay runs.',
  },
  {
    q: 'Is Overlay open source?',
    a: 'Yes. The core is AGPL-3.0 with hosted and self-hosted options, plus commercial licensing for organizations that need different terms. The free tier needs no card.',
  },
]

const faqStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ_ITEMS.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  })),
}

/** The FAQ before the footer. The matching FAQPage JSON-LD lets answer engines cite the answers. */
export function LandingFaq() {
  return (
    <section className="sec">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqStructuredData) }}
      />
      <div className="head center"><h2 className="h2">Questions, answered</h2></div>
      <Accordion type="single" collapsible className="faq">
        {FAQ_ITEMS.map((item) => (
          <AccordionItem key={item.q} value={item.q} className="last:border-b">
            <AccordionTrigger className="faq-q">{item.q}</AccordionTrigger>
            <AccordionContent className="body faq-a">{item.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}
