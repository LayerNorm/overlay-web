import { useMemo } from 'react'
import type { AssistantVisualBlock, ChatTranscriptSourceView } from '@overlay/chat-core'
import { collectWebSourcesFromBlocks } from '@overlay/chat-core'
import {
  externalSourcesFromMarkdown,
  knowledgeCitationsFromMarkdown,
  knowledgeSourcesFromCitations,
} from '../../lib/knowledge-sources'
import type { SourceCitationMap } from '../../lib/source-citations'
import type { WebSourceItem } from '../../lib/web-sources'

function providerUrlSources(sources: readonly ChatTranscriptSourceView[]): WebSourceItem[] {
  return sources.flatMap((source) => source.sourceKind === 'url' && source.url
    ? [{ url: source.url, title: source.title || source.url, origin: 'web-search' as const }]
    : [])
}

function uniqueSources(sources: WebSourceItem[]): WebSourceItem[] {
  const seen = new Set<string>()
  return sources.filter((source) => {
    const key = `${source.url ?? ''}\n${source.internalHref ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function useChatExchangeSources({
  assistantPlainText,
  assistantVisualBlocks,
  responseSources,
  sourceCitations,
}: {
  assistantPlainText: string
  assistantVisualBlocks: AssistantVisualBlock[]
  responseSources?: readonly ChatTranscriptSourceView[]
  sourceCitations?: SourceCitationMap
}) {
  const webSources = useMemo(
    () => collectWebSourcesFromBlocks(assistantVisualBlocks),
    [assistantVisualBlocks],
  )
  const effectiveSourceCitations = useMemo(() => {
    if (sourceCitations && Object.keys(sourceCitations).length > 0) return sourceCitations
    const recovered = knowledgeCitationsFromMarkdown(assistantPlainText)
    return Object.keys(recovered).length > 0 ? recovered : undefined
  }, [assistantPlainText, sourceCitations])
  const allSources = useMemo(() => {
    const external = [...providerUrlSources(responseSources ?? []), ...webSources]
    const knowledge = knowledgeSourcesFromCitations(effectiveSourceCitations)
    const candidates = external.length > 0
      ? [...external, ...knowledge]
      : [...externalSourcesFromMarkdown(assistantPlainText), ...knowledge]
    return uniqueSources(candidates)
  }, [assistantPlainText, effectiveSourceCitations, responseSources, webSources])

  return { allSources, effectiveSourceCitations, webSources }
}
