import './styles/landing-faq.css'

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'How do I run all my AI agents from one place?',
    a: 'Overlay gives every agent a home in one workspace: agents you create in Overlay and agents you already use (Codex, Claude Code, Hermes) connect to the same roster with shared context, tools, and a computer to work from.',
  },
  {
    q: 'Can I bring my own agents to Overlay?',
    a: 'Yes. Connect agents running on your own machine or deploy them on Overlay Cloud. They get the same workspace tools, memory, and supervision as agents built in Overlay.',
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

/** A quiet FAQ after the scroll story, before the footer. The matching
 * FAQPage JSON-LD lets answer engines cite the answers. */
export function LandingFaq() {
  return (
    <section className="lfaq border-t border-(--border)">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqStructuredData) }}
      />
      <div className="mx-auto max-w-3xl px-6 py-16 md:py-20">
        <h2 className="font-serif text-3xl tracking-tight md:text-4xl">Questions, answered</h2>
        <div className="mt-8 border-t border-(--border)">
          {FAQ_ITEMS.map((item) => (
            <details key={item.q} className="group border-b border-(--border)">
              <summary className="flex cursor-pointer items-center justify-between gap-4 py-5 font-serif text-base md:text-lg">
                {item.q}
                <span className="shrink-0 text-(--muted) transition-transform duration-200 group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="max-w-2xl pb-5 text-sm leading-7 text-(--muted)">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
