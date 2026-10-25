'use client'

import { useRef, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { ChatModelPicker } from '@overlay/chat-react'
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Textarea } from '@overlay/ui/primitives'
import { useAutosizeTextarea } from '@overlay/ui/hooks'
import { isFreeTierChatModelId } from '@/shared/ai/gateway/model-types'
import { MODEL_RECOMMENDATIONS } from '@/shared/ai/gateway/model-data'
import {
  AgentSidebarAdvancedSettings,
  AgentSidebarTools,
  getEnabledToolGroupCount,
} from './AgentSidebarDetails.parts'
import type { useAgentEditorController } from './AgentEditorPage'

type Controller = ReturnType<typeof useAgentEditorController>

function DetailsDisclosure({ label, summary, children }: {
  label: string
  summary?: string
  children: ReactNode
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          type="button"
          className="group/details-disclosure h-8 w-full justify-start rounded-md px-1 text-left text-xs font-medium text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)"
        >
          <span className="truncate">{label}</span>
          {summary ? (
            <span className="ml-auto min-w-0 truncate pl-3 font-normal text-(--muted-light) group-data-[state=open]/details-disclosure:hidden">
              {summary}
            </span>
          ) : null}
          <ChevronRight
            size={14}
            className={`shrink-0 transition-transform duration-200 group-data-[state=open]/details-disclosure:rotate-90 ${summary ? 'ml-2 group-data-[state=open]/details-disclosure:ml-auto' : 'ml-auto'}`}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">{children}</CollapsibleContent>
    </Collapsible>
  )
}

function AgentInstructionsField({ editor, onBlurSave }: {
  editor: Controller
  onBlurSave(): void
}) {
  const instructionsRef = useRef<HTMLTextAreaElement>(null)
  const instructions = editor.form.instructions
  useAutosizeTextarea(instructionsRef, instructions)

  return (
    <Textarea
      ref={instructionsRef}
      value={instructions}
      onChange={(event) => {
        editor.form.setInstructions(event.target.value)
        editor.form.markDirty()
      }}
      onBlur={onBlurSave}
      placeholder="Describe what this agent should do, how it should respond, and when it should stop."
      className="min-h-24 w-full resize-none overflow-hidden rounded-[10px] border-0 bg-(--surface-subtle) px-3 py-2.5 text-xs leading-[1.5] text-(--foreground) shadow-none"
    />
  )
}

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
  const detailsLoading = editor.loading
    || !editor.connectedAgentsChecked
    || editor.byo.initialLoading
    || editor.surfaces.initialLoading
    || editor.computer.initialLoading

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
          <DetailsDisclosure label="Model" summary={modelField.modelPickerLabel}>
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
            {modelField.isFreeTierWorkspace && !isFreeTierChatModelId(form.modelId) ? (
              <p className="mt-1.5 text-[11px] leading-4 text-(--muted)">
                Free workspaces use free models. This agent will use Auto.
              </p>
            ) : null}
          </DetailsDisclosure>
          <DetailsDisclosure
            label="Instructions"
            summary={form.instructions.trim() || 'None'}
          >
            <AgentInstructionsField editor={editor} onBlurSave={onBlurSave} />
          </DetailsDisclosure>
          <DetailsDisclosure
            label="Tools"
            summary={`${getEnabledToolGroupCount(editor)} on`}
          >
            <AgentSidebarTools editor={editor} />
          </DetailsDisclosure>
        </>
      ) : null}
      {runtime.legacyHostedRuntime ? (
        <p className="text-xs leading-5 text-(--muted)">
          This agent ran on a hosted runtime that is no longer available. It is unchanged; recreate it as an Overlay agent, or connect an agent running on your own machine.
        </p>
      ) : null}
      <DetailsDisclosure label="Advanced" summary={overlaySettings ? (form.permissionMode === 'auto' ? 'Auto' : 'Ask') : undefined}>
        <AgentSidebarAdvancedSettings editor={editor} />
      </DetailsDisclosure>
    </div>
  )
}
