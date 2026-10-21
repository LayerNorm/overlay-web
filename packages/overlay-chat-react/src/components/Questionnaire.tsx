'use client'

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { QuestionnaireSuggestions } from '@overlay/ui/primitives'
import type { GeneratedQuestionnaireData } from '@overlay/chat-core/generated-ui'

type QuestionnaireComposer = {
  value: string
  onChange(value: string): void
  disabled?: boolean
  readDraft(): string
  subscribe(listener: () => void): () => void
}

const ComposerContext = createContext<QuestionnaireComposer | null>(null)
const noSubscription = () => () => {}
const emptyDraft = () => ''

export function QuestionnaireComposerProvider({ children, ...composer }: QuestionnaireComposer & { children: ReactNode }) {
  return <ComposerContext.Provider value={composer}>{children}</ComposerContext.Provider>
}

export function ConversationQuestionnaire({ requestId, data, readOnly }: { requestId: string; data: GeneratedQuestionnaireData; readOnly: boolean }) {
  const composer = useContext(ComposerContext)
  const value = useSyncExternalStore(composer?.subscribe ?? noSubscription, composer?.readDraft ?? emptyDraft, emptyDraft)
  return <div className="my-3 max-w-xl space-y-4">
    <p className="text-sm leading-6 text-foreground">{data.prompt}</p>
    <QuestionnaireSuggestions questionId={requestId} choices={data.choices} value={value} onDraftChange={(draft) => composer?.onChange(draft)} multiple={data.multiple} disabled={readOnly || !composer || composer.disabled} />
  </div>
}
