import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ComparePageView } from '@/features/marketing/compare/ComparePageView'
import { COMPARE_PAGES, getComparePage } from '@/features/marketing/compare/comparePages'

export function generateStaticParams() {
  return COMPARE_PAGES.map((page) => ({ slug: page.slug }))
}

async function resolveComparison(params: Promise<{ slug: string }>) {
  const { slug } = await params
  const page = getComparePage(slug)
  if (!page) notFound()
  return page
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = await resolveComparison(params)
  return {
    title: page.metaTitle,
    description: page.description,
    alternates: { canonical: `/compare/${page.slug}` },
    openGraph: { title: page.metaTitle, description: page.description, url: `https://overlay.works/compare/${page.slug}` },
    robots: { index: true, follow: true },
  }
}

export default async function ComparePage({ params }: { params: Promise<{ slug: string }> }) {
  const page = await resolveComparison(params)

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
