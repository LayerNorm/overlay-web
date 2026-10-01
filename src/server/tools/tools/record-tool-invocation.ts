import 'server-only'

import { shouldPersistToolInvocation, toolCostBucketForId } from './tool-buckets'

export function fireAndForgetRecordToolInvocation(args: {
  accessToken?: string
  serverSecret?: string
  userId: string
  toolName: string
  mode: 'act'
  modelId?: string
  conversationId?: string
  turnId?: string
  success: boolean
  durationMs?: number
  error?: unknown
}): void {
  const bucket = toolCostBucketForId(args.toolName)
  if (!shouldPersistToolInvocation(bucket)) return

  const errorMessage = args.success
    ? undefined
    : args.error instanceof Error
      ? args.error.message.slice(0, 2000)
      : String(args.error ?? '').slice(0, 2000)

  void recordToolInvocation({ ...args, bucket, errorMessage }).catch((_error) => undefined)
}

async function recordToolInvocation(args: Parameters<typeof fireAndForgetRecordToolInvocation>[0] & {
  bucket: ReturnType<typeof toolCostBucketForId>
  errorMessage?: string
}): Promise<void> {
  const { convex } = await import('@/server/database/convex')
  await convex.mutation(
    'platform/usage:recordToolInvocation',
    {
      accessToken: args.accessToken,
      serverSecret: args.serverSecret,
      userId: args.userId,
      toolId: args.toolName,
      mode: args.mode,
      modelId: args.modelId,
      conversationId: args.conversationId,
      turnId: args.turnId,
      success: args.success,
      durationMs: args.durationMs,
      costBucket: args.bucket,
      errorMessage: args.errorMessage,
    },
    { background: true, suppressNetworkConsoleError: true },
  )
}
