'use client'

import { useRef, useState } from 'react'
import { QuestionnairePanel, toast, type QuestionnairePanelItem } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { decodeRunQuestions, formatRunAnswers, type RunQuestion } from '@/shared/agents/run-questions'

function questionItem(question: RunQuestion, index: number): QuestionnairePanelItem {
  const choices = question.choices?.map(({ label, description }) => ({ value: label, label, description }))
  const writesOwn = question.allowCustomAnswer || !choices?.length
  return {
    name: `question-${index}`,
    prompt: question.prompt,
    description: question.description,
    required: !question.optional,
    multiple: question.multiple,
    choices,
    ...(writesOwn ? { input: { label: choices?.length ? 'Or write your own answer' : 'Your answer' } } : {}),
  }
}

export function RunInputRequest({ conversationId, runId, token, question, refresh, canRespond = true }: {
  conversationId: string
  runId: string
  token: string
  question: string
  refresh?: () => Promise<unknown>
  canRespond?: boolean
}) {
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const pending = useRef(false)
  const questions = decodeRunQuestions(question)
  const items = questions.map(questionItem)

  const submit = async (answers: Record<string, string[]>) => {
    const text = formatRunAnswers(questions, items.map(item => answers[item.name])).trim()
    if (!text || pending.current || submitted) return
    pending.current = true
    setSubmitting(true)
    try {
      const result = await overlayAppClient.conversations.submitRunInput({
        conversationId, agentRunId: runId, token, text,
      })
      if (!result.success) throw new Error('Could not send your reply.')
    } catch (error) {
      pending.current = false
      setSubmitting(false)
      toast.error(error instanceof Error ? error.message : 'Could not send your reply.')
      return
    }
    setSubmitted(true)
    setSubmitting(false)
    try {
      await refresh?.()
    } catch {
      toast.error('Your reply was sent, but the run could not be refreshed.')
    }
  }

  if (!canRespond) {
    return (
      <div className="mb-2 rounded-xl border border-(--border) bg-card p-4">
        {questions.map(({ prompt }) => <p key={prompt} className="text-[15px] leading-[22px] font-medium text-foreground">{prompt}</p>)}
        <p className="mt-2 text-xs text-(--muted)" role="status">Waiting for the person who started this run.</p>
      </div>
    )
  }
  if (submitted) return <p className="mb-2 text-xs text-(--muted)" role="status">Answer sent. Continuing…</p>
  return (
    <div className="mb-2">
      <QuestionnairePanel items={items} onAnswers={(answers) => void submit(answers)} disabled={submitting} />
    </div>
  )
}
