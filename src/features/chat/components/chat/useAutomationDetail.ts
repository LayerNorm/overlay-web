'use client'

import { useCallback, useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { AutomationDetail } from '@overlay/app-core'
import { useConvex } from 'convex/react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import type { useChatPreferences } from './useChatPreferences'

type ChatPrefs = ReturnType<typeof useChatPreferences>

export function useAutomationDetail({
  mode,
  automationIdParam,
  activeChatIdRef,
  activeChatId,
  pathname,
  router,
  searchParams,
  selectedAutomation,
  setSelectedAutomation,
  setSelectedAutomationLoading,
  selectedActModel,
  setSelectedActModel,
  setSelectedModels,
  userAskModelOverrideRef,
  persistChatModel,
}: {
  mode: 'chat' | 'automate'
  automationIdParam: string | null
  activeChatIdRef: MutableRefObject<string | null>
  activeChatId: string | null
  pathname: ReturnType<typeof usePathname>
  router: ReturnType<typeof useRouter>
  searchParams: ReturnType<typeof useSearchParams>
  selectedAutomation: AutomationDetail | null
  setSelectedAutomation: Dispatch<SetStateAction<AutomationDetail | null>>
  setSelectedAutomationLoading: Dispatch<SetStateAction<boolean>>
  selectedActModel: ChatPrefs['selectedActModel']
  setSelectedActModel: ChatPrefs['setSelectedActModel']
  setSelectedModels: ChatPrefs['setSelectedModels']
  userAskModelOverrideRef: MutableRefObject<boolean>
  persistChatModel: (askModelIds: string[], actModelId: string) => void
}) {
  // Native one-shot reads; the open editor subscribes to the same automation live.
  const convex = useConvex()
  const { activeWorkspaceId } = useWorkspace()

  const refreshSelectedAutomation = useCallback(async (options?: {
    showLoading?: boolean
    conversationId?: string
  }) => {
    if (mode !== 'automate') {
      setSelectedAutomation(null)
      setSelectedAutomationLoading(false)
      return
    }
    if (options?.showLoading !== false) setSelectedAutomationLoading(true)
    try {
      let automationId = automationIdParam
      if (!automationId) {
        const conversationId = options?.conversationId ?? activeChatIdRef.current
        if (conversationId) {
          const listed = activeWorkspaceId
            ? await convex.query(api.automations.browse.list, { workspaceId: activeWorkspaceId, includeAgentBound: true })
            : null
          const linked = ((listed ?? []) as AutomationDetail[]).find((automation) => (
            automation.conversationId === conversationId
          ))
          if (linked) {
            automationId = linked._id
            setSelectedAutomation(linked)
            const params = new URLSearchParams(searchParams?.toString() ?? '')
            params.set('automationId', linked._id)
            if (!params.get('id')) params.set('id', conversationId)
            const query = params.toString()
            router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false })
          }
        }
      }
      if (!automationId) {
        setSelectedAutomation(null)
        return
      }
      if (!activeWorkspaceId) throw new Error('No workspace')
      const automation = await convex.query(api.automations.browse.get, {
        workspaceId: activeWorkspaceId,
        automationId: automationId as Id<'automations'>,
      }) as AutomationDetail | null
      if (!automation) throw new Error('Automation not found')
      // Only the automation-owned thread is shown — the source conversation is
      // provenance (the chat the automation was drafted in) and stays a normal
      // chat for its owner.
      // The native transcript query enforces access to this thread.
      const resolvedConversationId = automation.conversationId ?? null
      const validatedAutomation: AutomationDetail = {
        ...automation,
        sourceConversationId:
          resolvedConversationId === automation.sourceConversationId
            ? automation.sourceConversationId
            : undefined,
        conversationId:
          resolvedConversationId === automation.conversationId
            ? automation.conversationId
            : undefined,
      }
      setSelectedAutomation(validatedAutomation)
      const currentId = searchParams?.get('id')
      if (currentId !== resolvedConversationId) {
        const params = new URLSearchParams(searchParams?.toString() ?? '')
        if (resolvedConversationId) params.set('id', resolvedConversationId)
        else params.delete('id')
        params.set('automationId', automation._id)
        const query = params.toString()
        router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false })
      }
    } catch {
      setSelectedAutomation(null)
    } finally {
      setSelectedAutomationLoading(false)
    }
  }, [activeChatIdRef, activeWorkspaceId, automationIdParam, convex, mode, pathname, router, searchParams, setSelectedAutomation, setSelectedAutomationLoading])

  useEffect(() => {
    void refreshSelectedAutomation()
  }, [refreshSelectedAutomation])

  const saveAutomationHeaderModel = useCallback(async (modelId: string) => {
    // Mark the model as user-chosen so the new-chat-surface default-model effect
    // does not immediately reset it back to the account default.
    userAskModelOverrideRef.current = true
    // Always reflect the choice in local model state so a brand-new automation
    // (no saved doc yet) uses it when the automation is created from the first message.
    setSelectedActModel(modelId)
    setSelectedModels([modelId])
    if (!selectedAutomation) return
    const previousAutomation = selectedAutomation
    const nextAutomation = { ...selectedAutomation, modelId }
    setSelectedAutomation(nextAutomation)
    try {
      const res = await overlayAppClient.automations.updateResponse({
        automationId: selectedAutomation._id,
        modelId,
      })
      if (!res.ok) throw new Error('Failed to save automation model')
      if (activeChatId) persistChatModel([modelId], modelId)
    } catch {
      setSelectedAutomation(previousAutomation)
      const fallbackModelId = previousAutomation.modelId ?? selectedActModel
      setSelectedActModel(fallbackModelId)
      setSelectedModels([fallbackModelId])
    }
  }, [selectedAutomation, activeChatId, persistChatModel, selectedActModel, setSelectedActModel, setSelectedModels, setSelectedAutomation, userAskModelOverrideRef])

  const automationHeaderModelId = selectedAutomation?.modelId ?? selectedActModel ?? DEFAULT_MODEL_ID

  // The thread's composer runs follow-ups on the automation's model, the same value as the details panel.
  const automationModelId = selectedAutomation?.modelId ?? null
  useEffect(() => {
    if (!automationModelId) return
    setSelectedActModel(automationModelId)
    setSelectedModels([automationModelId])
  }, [activeChatId, automationModelId, setSelectedActModel, setSelectedModels])

  return {
    refreshSelectedAutomation,
    saveAutomationHeaderModel,
    automationHeaderModelId,
  }
}
