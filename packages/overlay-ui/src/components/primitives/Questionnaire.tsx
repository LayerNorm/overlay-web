'use client'

import { Questionnaire as Primitive } from '@shadcn/react/questionnaire'
import { Check } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from './Button'
import { Input } from './Input'
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

export type QuestionnairePanelItem = {
  name: string
  prompt: string
  description?: string
  required?: boolean
  multiple?: boolean
  choices?: ReadonlyArray<{ value: string; label: string; description?: string }>
  input?: { label: string; placeholder?: string }
}

const navButton = 'h-8 rounded-md px-3 text-[13px] font-medium'
const WRITTEN_ANSWER = '__written_answer__'

/**
 * @shadcn/react 0.3.1 hits React's update limit when Questionnaire.Input shares
 * an item with Questionnaire.Choice. A hidden choice stands in for the written
 * answer instead, so the primitive still sees the question as answered.
 */
function WrittenAnswer({ label, placeholder, value, onChange }: {
  label: string
  placeholder?: string
  value: string
  onChange(value: string): void
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <Primitive.Choice value={WRITTEN_ANSWER} checked={value.trim().length > 0} className="sr-only">
        <Primitive.ChoiceInput aria-label={label} onFocus={() => input.current?.focus()} />
      </Primitive.Choice>
      <label className="mt-1 block">
        <span className="mb-1 block text-xs leading-[18px] text-muted-foreground">{label}</span>
        <Input
          ref={input}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            event.currentTarget.form?.querySelector<HTMLButtonElement>('button[aria-keyshortcuts="Enter"]')?.click()
          }}
          className="h-9 text-[13px]"
        />
      </label>
    </>
  )
}

/**
 * A multi-step set of questions. `onAnswers` gets each item's answers by name.
 * `disabled` covers only the buttons: the primitive treats a disabled answer as
 * unanswered, which would send people back to a question they already answered.
 */
export function QuestionnairePanel({
  items, onAnswers, disabled = false, submitLabel = 'Send',
}: {
  items: readonly QuestionnairePanelItem[]
  onAnswers(answers: Record<string, string[]>): void
  disabled?: boolean
  submitLabel?: string
}) {
  const [written, setWritten] = useState<Record<string, string>>({})
  return (
    <Primitive.Root
      shortcuts="letters"
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        onAnswers(Object.fromEntries(items.map(({ name }) => {
          const chosen = data.getAll(name).map(String).filter(value => value !== WRITTEN_ANSWER)
          const own = written[name]?.trim()
          return [name, own ? [...chosen, own] : chosen]
        })))
      }}
      className="w-full rounded-xl border border-(--border) bg-card p-4 text-foreground"
    >
      {items.length > 1 ? <Primitive.Progress className="mb-2.5 text-xs text-muted-foreground" /> : null}
      {items.map((item) => (
        <Primitive.Item key={item.name} name={item.name} required={item.required} multiple={item.multiple} className="min-w-0 border-0 p-0">
          <Primitive.Title className="p-0 text-[15px] leading-[22px] font-medium">{item.prompt}</Primitive.Title>
          {item.description ? <Primitive.Description className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{item.description}</Primitive.Description> : null}
          <Primitive.Choices
            className="mt-3 flex flex-col gap-1.5"
            onChange={(event) => {
              // Picking a choice replaces a written answer, unless several can apply.
              const { type, value } = event.target as HTMLInputElement
              if (type === 'radio' && value !== WRITTEN_ANSWER) setWritten(current => ({ ...current, [item.name]: '' }))
            }}
          >
            {item.choices?.map((choice) => (
              <Primitive.Choice key={choice.value} value={choice.value} className="relative flex cursor-pointer items-center gap-2.5 rounded-lg border border-(--border) py-2 pr-2 pl-3 transition-colors hover:bg-(--surface-muted) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring data-[checked]:border-(--muted-light) data-[checked]:bg-(--surface-subtle)">
                <Primitive.ChoiceInput className="sr-only" />
                <span className="min-w-0 flex-1">
                  <Primitive.ChoiceLabel className="block text-[13px] leading-5 font-medium">{choice.label}</Primitive.ChoiceLabel>
                  {choice.description ? <span className="block text-xs leading-[18px] text-muted-foreground">{choice.description}</span> : null}
                </span>
                <Primitive.ChoiceShortcut className="grid size-5 shrink-0 place-items-center rounded bg-(--surface-subtle) text-[11px] leading-none text-muted-foreground" />
              </Primitive.Choice>
            ))}
            {item.input ? (
              <WrittenAnswer
                label={item.input.label}
                placeholder={item.input.placeholder}
                value={written[item.name] ?? ''}
                onChange={(value) => setWritten(current => ({ ...current, [item.name]: value }))}
              />
            ) : null}
          </Primitive.Choices>
          <Primitive.Error className="mt-2 text-xs text-destructive" />
        </Primitive.Item>
      ))}
      <div className="mt-3.5 flex items-center gap-2">
        <Primitive.Previous render={<Button variant="ghost" className={navButton} />} disabled={disabled}>Previous</Primitive.Previous>
        <Primitive.Skip render={<Button variant="ghost" className={navButton} />} disabled={disabled}>Skip</Primitive.Skip>
        <span className="flex-1" />
        <Primitive.Next render={<Button className={navButton} />} disabled={disabled}>Next</Primitive.Next>
        <Primitive.Submit render={<Button className={navButton} />} disabled={disabled}>{submitLabel}</Primitive.Submit>
      </div>
    </Primitive.Root>
  )
}
