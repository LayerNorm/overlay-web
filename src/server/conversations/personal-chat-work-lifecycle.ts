import 'server-only'

import { agentRunService } from '@/server/conversations/http'

export async function persistPersonalChatWorkProgress(input: {
  agentRunId: string
  content: string
  resourceUserId: string
}) {
  'use step'
  if (!input.content) return
  await agentRunService.recordProgress({
    content: input.content,
    runId: input.agentRunId,
    userId: input.resourceUserId,
  }).catch((_error) => undefined)
}
