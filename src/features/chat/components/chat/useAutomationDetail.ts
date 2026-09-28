'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { AutomationDetail, AutomationDetailTab } from '@overlay/app-core'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
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
  selectedModels,
  setSelectedModels,
  askModelSelectionMode,
  setAskModelSelectionMode,
  setComposerNotice,
  userAskModelOverrideRef,
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
  selectedModels: ChatPrefs['selectedModels']
  setSelectedModels: ChatPrefs['setSelectedModels']
  askModelSelectionMode: ChatPrefs['askModelSelectionMode']
  setAskModelSelectionMode: ChatPrefs['setAskModelSelectionMode']
  setComposerNotice: Dispatch<SetStateAction<string | null>>
  userAskModelOverrideRef: MutableRefObject<boolean>
}) {
  const creatingAutomationDraftRef = useRef(false)

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
          const page = await overlayAppClient.automations.getPage<AutomationDetail>({ limit: 100 })
          const linked = (Array.isArray(page.data) ? page.data : []).find((automation) => (
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
      const res = await overlayAppClient.automations.getResponse({ automationId }, {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('Failed to load automation')
      const automation = await res.json() as AutomationDetail
      // Only the automation-owned thread is shown — the source conversation is
      // provenance (the chat the automation was drafted in) and stays a normal
      // chat for its owner.
      const candidates = [automation.conversationId]
        .filter((value): value is string => Boolean(value))
      let resolvedConversationId: string | null = null
      for (const candidate of candidates) {
        const conversationResponse = await overlayAppClient.conversations.getResponse({
          conversationId: candidate,
        }, { cache: 'no-store' }).catch(() => null)
        if (conversationResponse?.ok) {
          resolvedConversationId = candidate
          break
        }
      }
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
  }, [activeChatIdRef, automationIdParam, mode, pathname, router, searchParams, setSelectedAutomation, setSelectedAutomationLoading])

  useEffect(() => {
    void refreshSelectedAutomation()
  }, [refreshSelectedAutomation])

  // Automations must always run with exactly one model. Collapse multi-model selection
  // whenever the user is working inside an automation surface so saved automations and
  // automation-chat runs never inherit a stale multi-model state.
  useEffect(() => {
    if (mode !== 'automate') return
    if (askModelSelectionMode !== 'multiple' && selectedModels.length <= 1) return
    const primary = selectedActModel || selectedModels[0] || DEFAULT_MODEL_ID
    setAskModelSelectionMode('single')
    setSelectedModels([primary])
    setSelectedActModel(primary)
  }, [
    askModelSelectionMode,
    mode,
    selectedActModel,
    selectedModels,
    setAskModelSelectionMode,
    setSelectedActModel,
    setSelectedModels,
  ])

  const selectAutomationDetailTab = useCallback(async (tab: AutomationDetailTab) => {
    // A brand-new automation has no saved doc yet. Switching to "edit" creates an
    // empty draft so the full editor can load and persist, then routes to it.
    if (tab === 'edit' && mode === 'automate' && !automationIdParam && !selectedAutomation) {
      if (creatingAutomationDraftRef.current) return
      creatingAutomationDraftRef.current = true
      try {
        const res = await overlayAppClient.automations.createResponse({
          name: 'New automation',
          description: 'Draft automation',
          instructions: 'Describe what this automation should do.',
          schedule: { kind: 'daily', hourUTC: 14, minuteUTC: 0 },
          modelId: selectedActModel,
          enabled: false,
        })
        const payload = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
        if (!res.ok || !payload.id) {
          throw new Error(payload.error || 'Failed to create automation draft')
        }
        const params = new URLSearchParams(searchParams?.toString() ?? '')
        params.set('automationId', payload.id)
        params.set('tab', 'edit')
        router.replace(`${pathname}?${params.toString()}`)
      } catch (error) {
        setComposerNotice(error instanceof Error ? error.message : 'Failed to open automation editor.')
        window.setTimeout(() => setComposerNotice(null), 6000)
      } finally {
        creatingAutomationDraftRef.current = false
      }
      return
    }
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (tab === 'chat') {
      params.delete('tab')
    } else {
      params.set('tab', tab)
    }
    const query = params.toString()
    router.replace(`${pathname}${query ? `?${query}` : ''}`)
  }, [pathname, router, searchParams, mode, automationIdParam, selectedAutomation, selectedActModel, setComposerNotice])

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
      if (activeChatId) {
        await overlayAppClient.conversations.updateResponse({
          conversationId: activeChatId,
          actModelId: modelId,
          askModelIds: [modelId],
          lastMode: 'act',
        })
      }
    } catch {
      setSelectedAutomation(previousAutomation)
      const fallbackModelId = previousAutomation.modelId ?? selectedActModel
      setSelectedActModel(fallbackModelId)
      setSelectedModels([fallbackModelId])
    }
  }, [selectedAutomation, activeChatId, selectedActModel, setSelectedActModel, setSelectedModels, setSelectedAutomation, userAskModelOverrideRef])

  const automationHeaderModelId = selectedAutomation?.modelId ?? selectedActModel ?? DEFAULT_MODEL_ID

  return {
    refreshSelectedAutomation,
    selectAutomationDetailTab,
    saveAutomationHeaderModel,
    automationHeaderModelId,
  }
}
