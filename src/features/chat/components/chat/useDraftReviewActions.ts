'use client'

import { useCallback, useState } from 'react'
import { toast } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { DraftModalState } from '../chat-interface/types'

type SkillDraftSummary = Extract<DraftModalState, { kind: 'skill' }>['draft']

export function useDraftReviewActions() {
  const [draftModalState, setDraftModalState] = useState<DraftModalState | null>(null)
  const [isDraftSaving, setIsDraftSaving] = useState(false)

  const saveSkillDraft = useCallback(async (draft: SkillDraftSummary) => {
    setIsDraftSaving(true)
    try {
      const res = await overlayAppClient.skills.createResponse({
        name: draft.name,
        description: draft.description,
        instructions: draft.instructions,
        enabled: true,
      })
      const payload = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        throw new Error(payload.error || 'Failed to save skill draft')
      }
      setDraftModalState(null)
      toast.success('Skill saved. It will now be available in chat.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save skill.')
    } finally {
      setIsDraftSaving(false)
    }
  }, [])

  return {
    draftModalState,
    isDraftSaving,
    saveSkillDraft,
    setDraftModalState,
  }
}
