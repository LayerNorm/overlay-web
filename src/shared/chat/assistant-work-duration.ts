export function getAssistantWorkDurationMs(message: {
  createdAt?: number
  completedAt?: number
  updatedAt?: number
}): number | null {
  const finishedAt = message.completedAt ?? message.updatedAt
  if (message.createdAt === undefined || finishedAt === undefined || finishedAt <= message.createdAt) return null
  return finishedAt - message.createdAt
}
