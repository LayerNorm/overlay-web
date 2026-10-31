'use client'

import { useAuth } from '@/contexts/AuthContext'
import type { NativeAgentInput } from '@/shared/agents/native-agent-input'
import { RunInputRequest } from '../chat/RunInputRequest'

export function NativeAgentInputCard({ request }: { request: NativeAgentInput }) {
  const { user } = useAuth()
  return <RunInputRequest conversationId={request.conversationId} runId={request.runId}
    token={request.token} question={request.question} canRespond={user?.id === request.userId} />
}
