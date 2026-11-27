'use client'

import { useSearchParams } from 'next/navigation'
import { resolveKnowledgeLayout } from '@overlay/app-core'
import { FilesRouteSkeleton } from '../_components/PageRouteSkeletons'

export function FilesRouteLoadingSkeleton() {
  const searchParams = useSearchParams()
  const layout = resolveKnowledgeLayout({
    layout: searchParams?.get('layout'),
    activeTab: 'files',
  })

  return <FilesRouteSkeleton layout={layout} />
}
