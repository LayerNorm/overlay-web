import { v } from 'convex/values'

export const agentMcpCallState = v.union(
  v.object({ kind: v.literal('pending') }),
  v.object({ kind: v.literal('executing'), executionId: v.string(), deadlineAt: v.number(), chunks: v.number(), bytes: v.number() }),
  v.object({ kind: v.literal('completed'), chunks: v.number(), bytes: v.number(), sha256: v.string() }),
)

export const agentMcpCallAuthority = {
  workspaceId: v.string(), environmentId: v.string(), runId: v.string(), sessionId: v.string(), expiresAt: v.number(),
  execution: v.optional(v.object({ attemptId: v.string(), generation: v.number() })),
}
