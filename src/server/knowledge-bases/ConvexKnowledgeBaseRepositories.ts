import 'server-only'

import type {
  GroupKnowledgeBaseDefault,
  KnowledgeBase,
  KnowledgeBaseConversation,
  KnowledgeBaseRepositories,
  KnowledgeBaseSource,
  KnowledgeSource,
  KnowledgeSourceIndexStats,
  KnowledgeSourceVersion,
  ProjectKnowledgeBase,
} from '@overlay/app-core'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

type ConvexBase = KnowledgeBase & { knowledgeBaseId?: string }
type ConvexSource = KnowledgeSource & { sourceId?: string }
type ConvexVersion = KnowledgeSourceVersion & { sourceVersionId?: string }

export function createConvexKnowledgeBaseRepositories(): KnowledgeBaseRepositories {
  return {
    bases: {
      async create(input) {
        return base(await requiredMutation<ConvexBase>('createBaseByServer', {
          knowledgeBaseId: input.id,
          ...input,
          id: undefined,
        }))
      },
      async get(id) {
        const row = await query<ConvexBase | null>('getBaseByServer', { knowledgeBaseId: id })
        return row ? base(row) : null
      },
      async listAll(options = {}) {
        const rows = await query<ConvexBase[]>('listBasesByServer', {
          includeArchived: options.includeArchived ?? false,
        }) ?? []
        return rows.map(base)
      },
      async listForOwner(ownerUserId, options = {}) {
        const rows = await query<ConvexBase[]>('listBasesForOwnerByServer', {
          ownerUserId,
          includeArchived: options.includeArchived ?? false,
        }) ?? []
        return rows.map(base)
      },
      async update(input) {
        const row = await mutation<ConvexBase | null>('updateBaseByServer', {
          knowledgeBaseId: input.id,
          title: input.title,
          description: input.description,
          kind: input.kind,
        })
        return row ? base(row) : null
      },
      async archive(id) {
        return (await mutation<{ archived: boolean }>('archiveBaseByServer', { knowledgeBaseId: id }))?.archived === true
      },
      async remove(id) {
        return (await mutation<{ removed: boolean }>('removeBaseByServer', { knowledgeBaseId: id }))?.removed === true
      },
    },
    sources: {
      async create(input) {
        return source(await requiredMutation<ConvexSource>('createSourceByServer', {
          sourceId: input.id,
          ...input,
          id: undefined,
        }))
      },
      async get(id) {
        const row = await query<ConvexSource | null>('getSourceByServer', { sourceId: id })
        return row ? source(row) : null
      },
      async update(input) {
        const row = await mutation<ConvexSource | null>('updateSourceByServer', {
          sourceId: input.id,
          title: input.title,
          mimeType: input.mimeType,
          contentHash: input.contentHash,
          status: input.status,
          statusMessage: input.statusMessage,
          metadata: input.metadata,
        })
        return row ? source(row) : null
      },
      async markDeleted(id) {
        return (await mutation<{ removed: boolean }>('markSourceDeletedByServer', { sourceId: id }))?.removed === true
      },
      async createVersion(input) {
        return version(await requiredMutation<ConvexVersion>('createSourceVersionByServer', {
          sourceVersionId: input.id,
          ...input,
          id: undefined,
        }))
      },
      async updateVersion(input) {
        const row = await mutation<ConvexVersion | null>('updateSourceVersionByServer', {
          sourceVersionId: input.id,
          status: input.status,
          metadata: input.metadata,
        })
        return row ? version(row) : null
      },
      async listVersions(sourceId) {
        const rows = await query<ConvexVersion[]>('listSourceVersionsByServer', { sourceId }) ?? []
        return rows.map(version)
      },
    },
    memberships: {
      async add(input) {
        return membership(await requiredMutation<KnowledgeBaseSource>('addSourceToBaseByServer', input))
      },
      async remove(input) {
        return (await mutation<{ removed: boolean }>('removeSourceFromBaseByServer', input))?.removed === true
      },
      async setEnabled(input) {
        return (await mutation<{ updated: boolean }>('setBaseSourceEnabledByServer', input))?.updated === true
      },
      async listForBase(knowledgeBaseId) {
        const rows = await query<KnowledgeBaseSource[]>('listSourcesForBaseByServer', { knowledgeBaseId }) ?? []
        return rows.map(membership)
      },
      async listBasesForSource(sourceId) {
        const rows = await query<KnowledgeBaseSource[]>('listBasesForSourceByServer', { sourceId }) ?? []
        return rows.map(membership)
      },
    },
    conversations: {
      async attach(input) {
        return conversation(await requiredMutation<KnowledgeBaseConversation>('attachConversationByServer', input))
      },
      async detach(conversationId) {
        return (await mutation<{ removed: boolean }>('detachConversationByServer', { conversationId }))?.removed === true
      },
      async detachOne({ conversationId, knowledgeBaseId }) {
        const result = await mutation<{ removed: boolean }>('detachConversationBaseByServer', {
          conversationId,
          knowledgeBaseId,
        })
        return result?.removed === true
      },
      async getForConversation(conversationId) {
        const row = await query<KnowledgeBaseConversation | null>('getConversationBaseByServer', { conversationId })
        return row ? conversation(row) : null
      },
      async listForConversation(conversationId) {
        const rows = await query<KnowledgeBaseConversation[]>('listConversationBasesByServer', { conversationId }) ?? []
        return rows.map(conversation)
      },
      async listForBase(knowledgeBaseId) {
        const rows = await query<KnowledgeBaseConversation[]>('listConversationsForBaseByServer', { knowledgeBaseId }) ?? []
        return rows.map(conversation)
      },
    },
    diagnostics: {
      async statsForSources(sourceIds) {
        if (sourceIds.length === 0) return []
        return await query<KnowledgeSourceIndexStats[]>('indexStatsForSourcesByServer', {
          sourceIds,
        }) ?? []
      },
      async extractionPreview({ sourceId, limit }) {
        return await query<{ text: string; totalChars: number; truncated: boolean } | null>(
          'extractionPreviewByServer',
          { sourceId, limit },
        )
      },
    },
    projects: {
      async attach(input) {
        return projectAttachment(await requiredMutation<ProjectKnowledgeBase>('attachProjectBaseByServer', {
          knowledgeBaseId: input.knowledgeBaseId,
          projectId: input.projectId,
          attachedBy: input.attachedBy,
        }))
      },
      async detach({ projectId, knowledgeBaseId }) {
        const result = await mutation<{ removed: boolean }>('detachProjectBaseByServer', {
          projectId,
          knowledgeBaseId,
        })
        return result?.removed === true
      },
      async detachAll(projectId) {
        const result = await mutation<{ removed: boolean }>('detachAllProjectBasesByServer', { projectId })
        return result?.removed === true
      },
      async listForProject(projectId) {
        const rows = await query<ProjectKnowledgeBase[]>('listProjectBasesByServer', { projectId }) ?? []
        return rows.map(projectAttachment)
      },
      async listForBase(knowledgeBaseId) {
        const rows = await query<ProjectKnowledgeBase[]>('listProjectsForBaseByServer', { knowledgeBaseId }) ?? []
        return rows.map(projectAttachment)
      },
    },
    groupDefaults: {
      async set(input) {
        return groupDefault(await requiredMutation<GroupKnowledgeBaseDefault>(
          'setGroupDefaultByServer',
          input,
        ))
      },
      async remove(input) {
        const result = await mutation<{ removed: boolean }>('removeGroupDefaultByServer', input)
        return result?.removed === true
      },
      async listForGroup(groupId) {
        const rows = await query<GroupKnowledgeBaseDefault[]>('listGroupDefaultsByServer', {
          groupId,
        }) ?? []
        return rows.map(groupDefault)
      },
      async listForGroups(groupIds) {
        if (groupIds.length === 0) return []
        const rows = await query<GroupKnowledgeBaseDefault[]>('listGroupsDefaultsByServer', {
          groupIds,
        }) ?? []
        return rows.map(groupDefault)
      },
      async listForBase(knowledgeBaseId) {
        const rows = await query<GroupKnowledgeBaseDefault[]>('listBaseGroupDefaultsByServer', {
          knowledgeBaseId,
        }) ?? []
        return rows.map(groupDefault)
      },
    },
  }
}

function query<T>(operation: string, args: Record<string, unknown>): Promise<T | null> {
  return convex.query<T>(
    `knowledge/bases:${operation}`,
    { ...stripUndefined(args), serverSecret: getInternalApiSecret() },
    { throwOnError: true },
  )
}

function mutation<T>(operation: string, args: Record<string, unknown>): Promise<T | null> {
  return convex.mutation<T>(
    `knowledge/bases:${operation}`,
    { ...stripUndefined(args), serverSecret: getInternalApiSecret() },
    { throwOnError: true },
  )
}

async function requiredMutation<T>(operation: string, args: Record<string, unknown>): Promise<T> {
  const result = await mutation<T>(operation, args)
  if (!result) throw new Error(`Convex knowledge-base operation ${operation} returned no result`)
  return result
}

function base(row: ConvexBase): KnowledgeBase {
  const { knowledgeBaseId, ...value } = clean(row)
  return { ...value, id: knowledgeBaseId ?? row.id }
}
function source(row: ConvexSource): KnowledgeSource {
  const { sourceId, ...value } = clean(row)
  return { ...value, id: sourceId ?? row.id, metadata: value.metadata ?? {} }
}
function version(row: ConvexVersion): KnowledgeSourceVersion {
  const { sourceVersionId, ...value } = clean(row)
  return { ...value, id: sourceVersionId ?? row.id, metadata: value.metadata ?? {} }
}
function membership(row: KnowledgeBaseSource): KnowledgeBaseSource { return clean(row) }
function conversation(row: KnowledgeBaseConversation): KnowledgeBaseConversation { return clean(row) }
function projectAttachment(row: ProjectKnowledgeBase): ProjectKnowledgeBase { return clean(row) }
function groupDefault(row: GroupKnowledgeBaseDefault): GroupKnowledgeBaseDefault { return clean(row) }
function clean<T>(row: T): T {
  const { _id: _, _creationTime: __, ...value } = row as T & { _id?: string; _creationTime?: number }
  return value as T
}
function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}
