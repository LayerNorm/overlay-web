import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { convex } from '@/server/database/convex'
import { SharedFileView } from '@/features/share/components/SharedFileView'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export type SharedFile = {
  _id: string
  name: string
  kind: 'note' | 'upload' | 'output' | 'folder'
  mimeType: string | null
  extension: string | null
  sizeBytes: number | null
  content: string | null
  textContent: string | null
  hasBinary: boolean
  createdAt: number
  sharedAt: number
}

async function loadShared(token: string): Promise<SharedFile | null> {
  return await convex.query<SharedFile | null>(
    'files/files:getPublicByToken',
    { token },
    { background: true },
  )
}

function describe(file: SharedFile): string {
  if (file.kind === 'note') return 'A note shared from Overlay.'
  if (file.mimeType?.startsWith('image/')) return 'An image shared from Overlay.'
  if (file.mimeType === 'application/pdf') return 'A PDF shared from Overlay.'
  return 'A file shared from Overlay.'
}

export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const { token } = await params
  const file = await loadShared(token)
  if (!file) {
    return { title: 'Shared file — Overlay', robots: { index: false } }
  }
  const description = describe(file)
  return {
    title: `${file.name} — Overlay`,
    description,
    openGraph: {
      title: file.name,
      description,
      type: 'article',
      siteName: 'Overlay',
    },
    twitter: {
      card: 'summary_large_image',
      title: file.name,
      description,
    },
  }
}

export default async function SharedFilePage(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const file = await loadShared(token)
  if (!file) notFound()
  return <SharedFileView file={file} token={token} />
}
