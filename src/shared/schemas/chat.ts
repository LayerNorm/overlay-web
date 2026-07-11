import { z } from 'zod'
import { AuthFields, BooleanQueryValue, IdQuery, IntegerQueryValue, PaginationQuery, UnknownResponse } from './common'

export const ConversationListQuery = PaginationQuery.extend({
  conversationId: IdQuery,
  messages: BooleanQueryValue,
  projectId: IdQuery,
  updatedSince: IntegerQueryValue,
  includeDeleted: BooleanQueryValue,
  beforeCreatedAt: IntegerQueryValue,
  compactToolPayloads: BooleanQueryValue,
})

export const ConversationEventsQuery = z.object({
  after: IntegerQueryValue,
})

export const CreateConversationRequest = z.object({
  ...AuthFields,
  title: z.string().min(1).max(200).optional(),
  projectId: z.string().optional(),
  askModelIds: z.array(z.string()).optional(),
  actModelId: z.string().optional(),
  lastMode: z.enum(['ask', 'act']).optional(),
  clientId: z.string().optional(),
})

export const UpdateConversationRequest = CreateConversationRequest.partial().extend({
  ...AuthFields,
  conversationId: z.string().min(1),
  projectId: z.string().nullable().optional(),
})

export const DeleteConversationRequest = z.object({
  ...AuthFields,
  conversationId: z.string().min(1).optional(),
})

export const AddConversationMessageRequest = z.object({
  ...AuthFields,
  conversationId: z.string().min(1),
  content: z.string().optional(),
  role: z.string().optional(),
  message: z.unknown().optional(),
}).passthrough()

export const DeleteConversationMessageRequest = z.object({
  ...AuthFields,
  conversationId: z.string().min(1),
  messageId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
}).passthrough()

export const StopConversationRequest = z.object({
  ...AuthFields,
  conversationId: z.string().min(1),
  messageId: z.string().min(1).optional(),
  partialContent: z.string().optional(),
  partialParts: z.array(z.record(z.unknown())).optional(),
}).passthrough()

export const StreamAuthRequest = z.object({
  ...AuthFields,
  conversationId: z.string().min(1).optional(),
}).passthrough()

export const ShareConversationRequest = z.object({
  ...AuthFields,
  conversationId: z.string().min(1),
  visibility: z.enum(['private', 'public']).optional(),
}).passthrough()

export const ActConversationRequest = z.object({
  ...AuthFields,
  conversationId: z.string().optional(),
  conversationClientId: z.string().min(1).optional(),
  projectId: z.string().optional(),
  askModelIds: z.array(z.string()).optional(),
  messages: z.array(z.unknown()).optional(),
  prompt: z.string().optional(),
  systemPrompt: z.string().optional(),
  turnId: z.string().optional(),
  modelId: z.string().optional(),
  indexedFileNames: z.array(z.string()).optional(),
  indexedAttachments: z.unknown().optional(),
  attachmentNames: z.array(z.string()).optional(),
  replyContextForModel: z.string().optional(),
  historyBaseModelId: z.string().optional(),
  mode: z.enum(['chat', 'automate']).optional(),
  automationMode: z.boolean().optional(),
  automationExecution: z.boolean().optional(),
  automationId: z.string().optional(),
  mediaToolIntent: z.enum(['image', 'video']).nullable().optional(),
  requestedToolIds: z.unknown().optional(),
  memoryEnabled: z.boolean().optional(),
  actAbortTimeoutMs: z.number().finite().positive().optional(),
  streamPersistenceMode: z.enum(['cloudflare-mirror', 'direct']).optional(),
  mentions: z.array(z.object({
    type: z.string(),
    id: z.string(),
    name: z.string(),
    fileIds: z.array(z.string()).optional(),
  })).optional(),
  multiModelSlotIndex: z.number().int().min(0).optional(),
  multiModelTotal: z.number().int().min(1).optional(),
}).passthrough()

export const ChatSuggestionQuery = z.object({})

export const GenerateTitleRequest = z.object({
  ...AuthFields,
  conversationId: z.string().optional(),
  messages: z.array(z.unknown()).optional(),
  prompt: z.string().optional(),
}).passthrough()

export const GenerateImageRequest = z.object({
  ...AuthFields,
  prompt: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  aspectRatio: z.string().min(1).max(20).optional(),
  conversationId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
  imageUrl: z.string().min(1).optional(),
  temporaryChat: z.boolean().optional(),
}).passthrough()

export const GenerateVideoRequest = GenerateImageRequest.extend({
  duration: z.number().finite().positive().optional(),
  videoSubMode: z.enum([
    'text-to-video',
    'image-to-video',
    'reference-to-video',
    'motion-control',
    'video-editing',
  ]).optional(),
  imageUrl: z.string().min(1).nullable().optional(),
}).passthrough()

export const GenerateMediaRequest = GenerateImageRequest

export const GenerateTabGroupLabelRequest = z.object({
  ...AuthFields,
  tabs: z.array(z.unknown()).optional(),
}).passthrough()

export const ChatResponse = UnknownResponse

export type CreateConversationRequest = z.infer<typeof CreateConversationRequest>
