import { v } from 'convex/values'

export const nativePolicySnapshotValidator = v.object({
  version: v.literal(1),
  backendUrl: v.string(),
  revision: v.string(),
  features: v.record(v.string(), v.boolean()),
  rollout: v.object({
    stage: v.union(v.literal('off'), v.literal('internal'), v.literal('invited'), v.literal('general')),
    internalWorkspaceIds: v.string(),
    invitedWorkspaceIds: v.string(),
  }),
})
