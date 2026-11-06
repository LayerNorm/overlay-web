import { v } from 'convex/values'

export const userMessageMetadata = v.object({
  indexedDocuments: v.optional(v.array(v.string())),
  indexedAttachments: v.optional(v.array(v.object({ name: v.string(), fileIds: v.array(v.string()) }))),
  mentions: v.optional(v.array(v.object({ type: v.string(), id: v.string(), name: v.string(), fileIds: v.optional(v.array(v.string())) }))),
})
