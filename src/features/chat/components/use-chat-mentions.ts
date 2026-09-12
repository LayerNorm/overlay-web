'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { MentionCategory, MentionItem } from '@/shared/knowledge/mention-types'

export function useChatMentions({
  activeWorkspaceId,
  isPublicShowcase,
}: {
  activeWorkspaceId: string | null | undefined
  isPublicShowcase: boolean
}) {
  const [mentions, setMentions] = useState<MentionItem[]>([])
  const [personalMentionConfirmationOpen, setPersonalMentionConfirmationOpen] = useState(false)
  const [mentionCategories, setMentionCategories] = useState<MentionCategory[]>([])
  // MentionInput emits a fresh mentions array on every keystroke. Bail out when the
  // value is unchanged so plain typing does not push new state / re-render the whole
  // chat experience on each character.
  const handleMentionsChange = useCallback((next: MentionItem[]) => {
    setMentions((prev) => {
      if (prev === next) return prev
      if (prev.length === next.length &&
        prev.every((m, i) => m.type === next[i]!.type && m.id === next[i]!.id && m.name === next[i]!.name)) {
        return prev
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!activeWorkspaceId || isPublicShowcase) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMentionCategories([])
      return
    }
    let cancelled = false
    void Promise.allSettled([
      overlayAppClient.workspaces.management(activeWorkspaceId, 'people'),
      overlayAppClient.workspaces.management(activeWorkspaceId, 'chats-agents'),
      overlayAppClient.knowledgeBases.list(),
    ]).then(([peopleResult, agentsResult, knowledgeResult]) => {
      if (cancelled) return
      const people = peopleResult.status === 'fulfilled'
        ? peopleResult.value
        : { items: [], currentPrincipalId: undefined }
      const agents = agentsResult.status === 'fulfilled' ? agentsResult.value : { items: [] }
      const knowledgeBases = knowledgeResult.status === 'fulfilled'
        ? knowledgeResult.value.knowledgeBases
        : []
      const principals = new Map<string, MentionItem>()
      for (const item of [...people.items, ...agents.items]) {
        if (
          item.kind !== 'member' ||
          !item.principalId ||
          item.principalId === people.currentPrincipalId ||
          item.status !== 'active'
        ) continue
        principals.set(item.principalId, {
          type: 'person',
          id: item.principalId,
          name: item.name,
          description: item.principalType === 'agent' ? 'Agent' : 'Workspace member',
          icon: 'UsersRound',
        })
      }
      const items = [...principals.values()].sort((left, right) => left.name.localeCompare(right.name))
      const bases = knowledgeBases
        .map((base) => ({
          type: 'knowledge' as const,
          id: base.id,
          name: base.title,
          description: base.description || `${base.kind} knowledge base`,
          icon: 'BookOpen',
        }))
        .sort((left, right) => left.name.localeCompare(right.name))
      setMentionCategories([
        ...(items.length ? [{
          type: 'person' as const,
          label: 'Members',
          icon: 'UsersRound',
          items,
        }] : []),
        ...(bases.length ? [{
          type: 'knowledge' as const,
          label: 'Knowledge Bases',
          icon: 'BookOpen',
          items: bases,
        }] : []),
      ])
    }).catch(() => {
      if (!cancelled) setMentionCategories([])
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, isPublicShowcase])

  const personMentions = useMemo(
    () => mentions.filter((mention) => mention.type === 'person'),
    [mentions],
  )

  useEffect(() => {
    if (personalMentionConfirmationOpen && personMentions.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPersonalMentionConfirmationOpen(false)
    }
  }, [personalMentionConfirmationOpen, personMentions.length])

  return {
    mentions,
    setMentions,
    handleMentionsChange,
    personalMentionConfirmationOpen,
    setPersonalMentionConfirmationOpen,
    mentionCategories,
    personMentions,
  }
}
