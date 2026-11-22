import type { Metadata } from 'next'
import { ComparePageView } from './ComparePageView'
import type { ComparePage } from './comparePages'

export function getCompareMetadata(page: ComparePage): Metadata {
  return {
    title: page.metaTitle,
    description: page.description,
    alternates: { canonical: `/compare/${page.slug}` },
    openGraph: { title: page.metaTitle, description: page.description, url: `https://overlay.works/compare/${page.slug}` },
    robots: { index: true, follow: true },
  }
}

export function CompareArticle({ page }: { page: ComparePage }) {
  // Keep the structured FAQ in sync with the questions visible on the page.
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: page.title,
        description: page.description,
        url: `https://overlay.works/compare/${page.slug}`,
        author: { '@id': 'https://overlay.works/#organization' },
        publisher: { '@id': 'https://overlay.works/#organization' },
        about: { '@id': 'https://overlay.works/#application' },
      },
      {
        '@type': 'FAQPage',
        mainEntity: page.faq.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
    ],
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
      <ComparePageView page={page} />
    </>
  )
}
