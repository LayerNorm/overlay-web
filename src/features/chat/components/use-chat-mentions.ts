'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveWorkspacePrincipals } from '@/hooks/use-workspace-members'
import type { MentionCategory, MentionItem } from '@/shared/knowledge/mention-types'

export function useChatMentions({
  activeWorkspaceId,

}: {
  activeWorkspaceId: string | null | undefined

}) {
  const [mentions, setMentions] = useState<MentionItem[]>([])
  const [personalMentionConfirmationOpen, setPersonalMentionConfirmationOpen] = useState(false)
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

  // Live: people and agents joining, leaving or renamed update the mention list without reopening the chat.
  const principals = useLiveWorkspacePrincipals(activeWorkspaceId)
  const mentionCategories = useMemo<MentionCategory[]>(() => {
    const items = (principals?.items ?? [])
      .filter((item) => item.principalId !== principals?.currentPrincipalId)
      .map((item): MentionItem => ({
        type: 'person',
        id: item.principalId!,
        name: item.name,
        description: item.principalType === 'agent' ? 'Agent' : 'Workspace member',
        principalType: item.principalType,
        avatarColor: item.avatarColor,
        avatarShape: item.avatarShape,
        isDefault: item.isDefault,
        ...(item.principalType === 'human' && item.photoUrl ? { photoUrl: item.photoUrl } : {}),
        icon: 'UsersRound',
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
    return items.length ? [{ type: 'person' as const, label: 'Members', icon: 'UsersRound', items }] : []
  }, [principals])

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
