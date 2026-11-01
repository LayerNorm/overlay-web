'use client'

import { useRef, useState } from 'react'
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationBody, ConfirmationIcon, ConfirmationRequest, ConfirmationTitle } from '@overlay/chat-react'
import { Textarea, toast } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

export function RunInputRequest({ conversationId, runId, token, question, refresh, canRespond = true }: {
  conversationId: string
  runId: string
  token: string
  question: string
  refresh?: () => Promise<unknown>
  canRespond?: boolean
}) {
  const [reply, setReply] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const pending = useRef(false)
  const submit = async () => {
    const text = reply.trim()
    if (!canRespond || !text || pending.current || submitted) return
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

  return (
    <Confirmation className="mb-2">
      <ConfirmationIcon running={submitting} />
      <ConfirmationBody>
        <ConfirmationTitle>Your input is needed</ConfirmationTitle>
        <ConfirmationRequest className="whitespace-pre-wrap">{question}</ConfirmationRequest>
        {canRespond ? <>
          <Textarea
            aria-label="Your reply"
            className="mt-2 min-h-16"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            maxLength={32_000}
            disabled={submitting || submitted}
          />
          <ConfirmationActions>
            <ConfirmationAction
              tone="primary"
              disabled={!reply.trim() || submitting || submitted}
              onClick={() => void submit()}
            >
              {submitted ? 'Reply sent' : 'Send reply'}
            </ConfirmationAction>
          </ConfirmationActions>
        </> : <p className="mt-2 text-xs text-(--muted)" role="status">Waiting for the person who started this run.</p>}
      </ConfirmationBody>
    </Confirmation>
  )
}
