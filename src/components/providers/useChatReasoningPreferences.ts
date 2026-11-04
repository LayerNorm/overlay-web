'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ReasoningLevel } from '@overlay/chat-core'
import {
  chatReasoningStorageKey,
  isPersistentChatReasoningScope,
  readStoredReasoningByModel,
  writeStoredReasoningByModel,
  type ChatReasoningScope,
  type ReasoningByModel,
} from '@/shared/chat/chat-model-prefs'

export function useChatReasoningPreferences(scope: ChatReasoningScope) {
  const reasoningStorageKey = chatReasoningStorageKey(scope)
  const persistReasoning = isPersistentChatReasoningScope(scope)
  const [state, setState] = useState<{
    storageKey: string
    values: Record<string, ReasoningLevel>
  }>(() => ({ storageKey: '', values: {} }))
  const reasoningByModel: ReasoningByModel = state.storageKey === reasoningStorageKey ? state.values : {}

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read browser-local reasoning preferences after mount
    setState({
      storageKey: reasoningStorageKey,
      values: persistReasoning ? readStoredReasoningByModel(reasoningStorageKey) : {},
    })
  }, [persistReasoning, reasoningStorageKey])

  const onModelReasoningChange = useCallback((modelId: string, level: ReasoningLevel | undefined) => {
    if (!modelId) return
    const current = state.storageKey === reasoningStorageKey
      ? state.values
      : persistReasoning ? readStoredReasoningByModel(reasoningStorageKey) : {}
    const next = { ...current }
    if (!level || level === 'provider-default') delete next[modelId]
    else next[modelId] = level
    if (persistReasoning) writeStoredReasoningByModel(reasoningStorageKey, next)
    setState({ storageKey: reasoningStorageKey, values: next })
  }, [persistReasoning, state, reasoningStorageKey])

  return { reasoningByModel, onModelReasoningChange, reasoningStorageKey }
}
