'use client'

import { Questionnaire as Primitive } from '@shadcn/react/questionnaire'
import { Check } from 'lucide-react'
import { selectedQuestionnaireChoices, toggleQuestionnaireChoice, type QuestionnaireSuggestion } from './questionnaire-draft'

export { selectedQuestionnaireChoices, toggleQuestionnaireChoice, type QuestionnaireSuggestion } from './questionnaire-draft'

/** Choices edit the host composer's draft. They never submit or authorize an action. */
export function QuestionnaireSuggestions({
  questionId, choices, value, onDraftChange, multiple = false, disabled = false,
}: {
  questionId: string
  choices: readonly QuestionnaireSuggestion[]
  value: string
  onDraftChange(value: string): void
  multiple?: boolean
  disabled?: boolean
}) {
  const selected = selectedQuestionnaireChoices(value, choices)
  return (
    <Primitive.Root item={questionId} onSubmit={(event) => event.preventDefault()} className="w-full">
      <Primitive.Item name={questionId} multiple={multiple} className="min-w-0 border-0 p-0">
        <Primitive.Title className="sr-only">Suggested answers</Primitive.Title>
        <Primitive.Choices className="flex flex-wrap gap-2">
          {choices.map((choice) => (
            <Primitive.Choice key={choice.id} value={choice.id} checked={selected.includes(choice.id)} disabled={disabled} onChange={() => { if (!disabled) onDraftChange(toggleQuestionnaireChoice(value, choices, choice.id, multiple)) }} className="relative inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-transparent px-3.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring data-[checked]:border-foreground/30 data-[checked]:bg-muted/50 data-[checked]:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50">
              <Primitive.ChoiceInput className="sr-only" />
              <Primitive.ChoiceLabel>{choice.label}</Primitive.ChoiceLabel>
              {selected.includes(choice.id) ? <Check className="size-3" aria-hidden /> : null}
            </Primitive.Choice>
          ))}
        </Primitive.Choices>
      </Primitive.Item>
    </Primitive.Root>
  )
}
