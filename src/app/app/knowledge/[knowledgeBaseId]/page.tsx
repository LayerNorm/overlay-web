import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { notFound, redirect } from 'next/navigation'
import { getOverlaySession } from '@/server/auth/session'
import { getOverlayCapabilities } from '@/server/capabilities'
import { getOverlayServerContext } from '@/server/bootstrap'
import { KnowledgeBaseServiceError, KNOWLEDGE_BASE_RESOURCE_TYPE } from '@/server/knowledge-bases'
import { KnowledgeRouteSkeleton } from '../../_components/AppRouteSkeletons'

const KnowledgeBaseWorkspace = dynamic(
  () => import('@/features/knowledge-bases/components/KnowledgeBaseWorkspace')
    .then((module) => module.KnowledgeBaseWorkspace),
  { loading: () => <KnowledgeRouteSkeleton /> },
)

async function KnowledgeBaseWorkspaceContent({
  knowledgeBaseId,
  selectedSourceId,
  userId,
}: {
  knowledgeBaseId: string
  selectedSourceId?: string
  userId: string
}) {
  let data: Awaited<ReturnType<typeof loadKnowledgeBaseWorkspace>>
  try {
    data = await loadKnowledgeBaseWorkspace({ knowledgeBaseId, userId })
  } catch (error) {
    if (error instanceof KnowledgeBaseServiceError && error.statusCode === 404) notFound()
    throw error
  }
  return <KnowledgeBaseWorkspace {...data} initialSelectedSourceId={selectedSourceId} />
}

async function loadKnowledgeBaseWorkspace({
  knowledgeBaseId,
  userId,
}: {
  knowledgeBaseId: string
  userId: string
}) {
  const server = getOverlayServerContext()
  const knowledgeBase = await server.knowledgeBaseService.getKnowledgeBase({ knowledgeBaseId, userId })
  const [sourceDetails, editDecision, shareDecision] = await Promise.all([
      server.knowledgeBaseService.listSources({ knowledgeBaseId, userId }),
      server.authorizationService.checkResourceAccess({
        action: 'edit',
        capability: 'knowledge.edit',
        ownerUserId: knowledgeBase.ownerUserId,
        resourceId: knowledgeBase.id,
        resourceType: KNOWLEDGE_BASE_RESOURCE_TYPE,
        userId,
      }),
      server.authorizationService.checkResourceAccess({
        action: 'share',
        capability: 'knowledge.share',
        ownerUserId: knowledgeBase.ownerUserId,
        resourceId: knowledgeBase.id,
        resourceType: KNOWLEDGE_BASE_RESOURCE_TYPE,
        userId,
      }),
  ])
  return {
    canEdit: editDecision.allowed,
    canShare: shareDecision.allowed,
    initialKnowledgeBase: knowledgeBase,
    initialSources: sourceDetails.map(summarizeSourceDetail),
  }
}

function summarizeSourceDetail<T extends { source: { metadata: Record<string, unknown> } }>(detail: T) {
  const content = typeof detail.source.metadata.content === 'string' ? detail.source.metadata.content : ''
  const { content: _content, ...metadata } = detail.source.metadata
  void _content
  return {
    ...detail,
    source: {
      ...detail.source,
      metadata,
      ...(content ? { contentPreview: content.slice(0, 8000) } : {}),
    },
  }
}

export default async function KnowledgeBasePage({
  params,
  searchParams,
}: {
  params: Promise<{ knowledgeBaseId: string }>
  searchParams: Promise<{ source?: string | string[] }>
}) {
  const capabilities = await getOverlayCapabilities()
  if (!capabilities.knowledge) notFound()
  const session = await getOverlaySession()
  if (!session) redirect('/app/chat?signin=nav')
  const { knowledgeBaseId } = await params
  const requestedSource = (await searchParams).source
  const selectedSourceId = Array.isArray(requestedSource)
    ? requestedSource[0]
    : requestedSource
  return (
    <Suspense fallback={<KnowledgeRouteSkeleton />}>
      <KnowledgeBaseWorkspaceContent
        knowledgeBaseId={knowledgeBaseId}
        selectedSourceId={selectedSourceId}
        userId={session.user.id}
      />
    </Suspense>
  )
}
