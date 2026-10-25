'use client'

import { useEffect, useRef } from 'react'
import { ChatModelPicker } from '@overlay/chat-react'
import { Button, Textarea } from '@overlay/ui/primitives'
import { isFreeTierChatModelId } from '@/shared/ai/gateway/model-types'
import { MODEL_RECOMMENDATIONS } from '@/shared/ai/gateway/model-data'
import {
  AgentSidebarMoreSettings,
  AgentSidebarTools,
  SectionHeading,
} from './AgentSidebarDetails.parts'
import type { useAgentEditorController } from './AgentEditorPage'
import { OverlayAgentPermissionsField } from './AgentEditorForm'

type Controller = ReturnType<typeof useAgentEditorController>

export function AgentSidebarDetails({
  editor,
  saveFailed,
  onRetry,
  onBlurSave,
}: {
  editor: Controller
  saveFailed: boolean
  onRetry(): void
  onBlurSave(): void
}) {
  const { form, modelField, runtime } = editor
  const instructionsRef = useRef<HTMLTextAreaElement>(null)
  const detailsLoading = editor.loading
    || !editor.connectedAgentsChecked
    || editor.byo.initialLoading
    || editor.surfaces.initialLoading
    || editor.computer.initialLoading

  useEffect(() => {
    const textarea = instructionsRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [detailsLoading, form.instructions])

  if (detailsLoading) {
    return <p className="text-xs text-(--muted)">Loading agent details...</p>
  }

  const overlaySettings = runtime.agentType === 'overlay' && !runtime.cloudAgent

  return (
    <div className="space-y-[22px]">
      {saveFailed ? (
        <p className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400" role="alert">
          Couldn&apos;t save
          <Button variant="ghost" size="sm" onClick={onRetry} className="h-6 px-2 text-xs">
            Retry
          </Button>
        </p>
      ) : null}
      {overlaySettings && !runtime.legacyHostedRuntime ? (
        <>
          <section>
            <SectionHeading>Instructions</SectionHeading>
            <Textarea
              ref={instructionsRef}
              value={form.instructions}
              onChange={(event) => {
                form.setInstructions(event.target.value)
                form.markDirty()
              }}
              onBlur={onBlurSave}
              placeholder="Describe what this agent should do, how it should respond, and when it should stop."
              className="mt-2 min-h-24 w-full resize-none overflow-hidden rounded-[10px] border-0 bg-(--surface-subtle) px-3 py-2.5 text-xs leading-[1.5] text-(--foreground) shadow-none focus-visible:ring-1 focus-visible:ring-(--ring)"
            />
          </section>
          <section>
            <SectionHeading>Model</SectionHeading>
            <div className="mt-2">
              <ChatModelPicker
                placement="field"
                modelPickerLabel={modelField.modelPickerLabel}
                selectableTextModels={modelField.selectableTextModels}
                selectedActModel={form.modelId}
                onToggleTextModel={(value) => {
                  form.setModelId(value)
                  form.markDirty()
                }}
                isFreeTier={modelField.isFreeTier}
                isFreeTierChatModelId={isFreeTierChatModelId}
                favoriteScope={modelField.favoriteScope}
                modelRecommendations={MODEL_RECOMMENDATIONS}
                textModelsLoading={modelField.textModelsLoading}
                generationMode="text"
                lockedGenerationMode="text"
              />
            </div>
            {modelField.isFreeTierWorkspace && !isFreeTierChatModelId(form.modelId) ? (
              <p className="mt-1.5 text-[11px] leading-4 text-(--muted)">
                Free workspaces use free models. This agent will use Auto.
              </p>
            ) : null}
          </section>
          <section>
            <SectionHeading>Tools</SectionHeading>
            <AgentSidebarTools editor={editor} />
          </section>
          <section>
            <OverlayAgentPermissionsField
              value={form.permissionMode}
              onChange={(value) => { form.setPermissionMode(value); form.markDirty() }}
            />
          </section>
        </>
      ) : null}
      {runtime.legacyHostedRuntime ? (
        <p className="text-xs leading-5 text-(--muted)">
          This agent ran on a hosted runtime that is no longer available. It is unchanged; recreate it as an Overlay agent, or connect an agent running on your own machine.
        </p>
      ) : null}
      <AgentSidebarMoreSettings editor={editor} />
    </div>
  )
}
