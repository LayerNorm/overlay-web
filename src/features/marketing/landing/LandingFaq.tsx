import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@overlay/ui/primitives'

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'What is an AI Chief of Staff?',
    a: 'Overlay is an agent that runs a team of AI coworkers for you. Tell it what you need, and it breaks the work down, hands each piece to the right agent, keeps them moving and brings back only the decisions that need a person.',
  },
  {
    q: 'What can Overlay’s agents do?',
    a: 'Each agent has a role, a memory, the tools your team uses (GitHub, Slack, Gmail, Calendar, Notion and more) and a computer of its own in the cloud, so it can run code, use a browser and keep files while your laptop is closed.',
  },
  {
    q: 'Where can I use Overlay?',
    a: 'On the web, in Overlay for Mac, in your phone’s browser, in Slack by mentioning @Overlay, and from ChatGPT, Claude or any MCP app. Agents can also run on schedules and triggers and report back to the same place.',
  },
  {
    q: 'Can my team share agents without sharing everything?',
    a: 'Yes. Every member has a personal space that only they can see, next to the shared workspace. Shared agents, channels and automations are visible to the team; personal agents, notes and threads stay private.',
  },
  {
    q: 'How do I control what agents can do?',
    a: 'Permissions, tool approvals, spend limits, run history, and audit trails apply to every agent in the workspace.',
  },
  {
    q: 'Is Overlay open source?',
    a: 'Yes. The core is AGPL-3.0 with hosted and self-hosted options, plus commercial licensing for organizations that need different terms. Set up your workspace before choosing the $8/month usage credit. There is no trial; bring your own model credentials if you prefer.',
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
