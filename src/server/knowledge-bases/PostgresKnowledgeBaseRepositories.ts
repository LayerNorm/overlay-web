import 'server-only'

import { sql } from 'drizzle-orm'
import type {
  CreateKnowledgeBaseInput,
  CreateKnowledgeSourceInput,
  KnowledgeBase,
  KnowledgeBaseConversation,
  KnowledgeBaseRepositories,
  KnowledgeBaseSource,
  KnowledgeSource,
  KnowledgeSourceIndexStats,
  KnowledgeSourceVersion,
  ProjectKnowledgeBase,
  UpdateKnowledgeBaseInput,
  UpdateKnowledgeSourceInput,
} from '@overlay/app-core'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'

type DateValue = Date | string
type BaseRow = Omit<KnowledgeBase, 'createdAt' | 'updatedAt' | 'archivedAt'> & {
  createdAt: DateValue
  updatedAt: DateValue
  archivedAt: DateValue | null
}
type SourceRow = Omit<KnowledgeSource, 'createdAt' | 'updatedAt' | 'deletedAt'> & {
  createdAt: DateValue
  updatedAt: DateValue
  deletedAt: DateValue | null
}
type VersionRow = Omit<KnowledgeSourceVersion, 'createdAt' | 'updatedAt'> & {
  createdAt: DateValue
  updatedAt: DateValue
}
type MembershipRow = Omit<KnowledgeBaseSource, 'createdAt'> & { createdAt: DateValue }
type ConversationRow = Omit<KnowledgeBaseConversation, 'createdAt'> & { createdAt: DateValue }
type ProjectAttachmentRow = Omit<ProjectKnowledgeBase, 'createdAt'> & { createdAt: DateValue }

export function createPostgresKnowledgeBaseRepositories(
  db: OverlayPostgresDb,
): KnowledgeBaseRepositories {
  return {
    bases: {
      async create(input: CreateKnowledgeBaseInput) {
        const result = await db.execute<BaseRow>(sql`
          INSERT INTO knowledge_bases (
            id, owner_user_id, title, description, kind, status, created_by
          ) VALUES (
            ${input.id}, ${input.ownerUserId}, ${input.title}, ${input.description ?? null},
            ${input.kind ?? 'personal'}, 'active', ${input.createdBy ?? null}
          )
          RETURNING ${baseColumns}
        `)
        return baseFromRow(required(result.rows[0], 'create knowledge base'))
      },
      async get(id: string) {
        const result = await db.execute<BaseRow>(sql`
          SELECT ${baseColumns} FROM knowledge_bases WHERE id = ${id} LIMIT 1
        `)
        return result.rows[0] ? baseFromRow(result.rows[0]) : null
      },
      async listAll(options = {}) {
        const result = await db.execute<BaseRow>(sql`
          SELECT ${baseColumns}
          FROM knowledge_bases
          WHERE ${options.includeArchived ? sql`true` : sql`status = 'active'`}
          ORDER BY updated_at DESC, id
        `)
        return result.rows.map(baseFromRow)
      },
      async listForOwner(ownerUserId: string, options = {}) {
        const result = await db.execute<BaseRow>(sql`
          SELECT ${baseColumns}
          FROM knowledge_bases
          WHERE owner_user_id = ${ownerUserId}
            AND ${options.includeArchived ? sql`true` : sql`status = 'active'`}
          ORDER BY updated_at DESC, id
        `)
        return result.rows.map(baseFromRow)
      },
      async update(input: UpdateKnowledgeBaseInput) {
        const current = await this.get(input.id)
        if (!current) return null
        const result = await db.execute<BaseRow>(sql`
          UPDATE knowledge_bases SET
            title = ${input.title ?? current.title},
            description = ${input.description ?? current.description ?? null},
            kind = ${input.kind ?? current.kind},
            updated_at = now()
          WHERE id = ${input.id}
          RETURNING ${baseColumns}
        `)
        return baseFromRow(required(result.rows[0], 'update knowledge base'))
      },
      async archive(id: string) {
        const result = await db.execute(sql`
          UPDATE knowledge_bases
          SET status = 'archived', archived_at = COALESCE(archived_at, now()), updated_at = now()
          WHERE id = ${id}
        `)
        return result.rowCount === 1
      },
      async remove(id: string) {
        const result = await db.execute(sql`DELETE FROM knowledge_bases WHERE id = ${id}`)
        return result.rowCount === 1
      },
    },
    sources: {
      async create(input: CreateKnowledgeSourceInput) {
        const result = await db.execute<SourceRow>(sql`
          INSERT INTO knowledge_sources (
            id, owner_user_id, kind, source_ref, title, mime_type, content_hash,
            status, status_message, metadata, created_by
          ) VALUES (
            ${input.id}, ${input.ownerUserId}, ${input.kind}, ${input.sourceRef ?? null},
            ${input.title}, ${input.mimeType ?? null}, ${input.contentHash ?? null},
            ${input.status ?? 'pending'}, ${input.statusMessage ?? null},
            ${JSON.stringify(input.metadata ?? {})}::jsonb, ${input.createdBy ?? null}
          )
          RETURNING ${sourceColumns}
        `)
        return sourceFromRow(required(result.rows[0], 'create knowledge source'))
      },
      async get(id: string) {
        const result = await db.execute<SourceRow>(sql`
          SELECT ${sourceColumns}
          FROM knowledge_sources
          WHERE id = ${id} AND deleted_at IS NULL
          LIMIT 1
        `)
        return result.rows[0] ? sourceFromRow(result.rows[0]) : null
      },
      async update(input: UpdateKnowledgeSourceInput) {
        const current = await this.get(input.id)
        if (!current) return null
        const result = await db.execute<SourceRow>(sql`
          UPDATE knowledge_sources SET
            title = ${input.title ?? current.title},
            mime_type = ${input.mimeType ?? current.mimeType ?? null},
            content_hash = ${input.contentHash ?? current.contentHash ?? null},
            status = ${input.status ?? current.status},
            status_message = ${input.statusMessage ?? current.statusMessage ?? null},
            metadata = ${JSON.stringify(input.metadata ?? current.metadata)}::jsonb,
            updated_at = now()
          WHERE id = ${input.id} AND deleted_at IS NULL
          RETURNING ${sourceColumns}
        `)
        return result.rows[0] ? sourceFromRow(result.rows[0]) : null
      },
      async markDeleted(id: string) {
        const result = await db.execute(sql`
          UPDATE knowledge_sources
          SET status = 'deleting', deleted_at = COALESCE(deleted_at, now()), updated_at = now()
          WHERE id = ${id} AND deleted_at IS NULL
        `)
        return result.rowCount === 1
      },
      async createVersion(input) {
        const result = await db.execute<VersionRow>(sql`
          INSERT INTO knowledge_source_versions (
            id, source_id, version, content_hash, status, metadata
          ) VALUES (
            ${input.id}, ${input.sourceId}, ${input.version}, ${input.contentHash},
            ${input.status}, ${JSON.stringify(input.metadata)}::jsonb
          )
          ON CONFLICT (source_id, content_hash) DO UPDATE SET
            status = EXCLUDED.status,
            metadata = EXCLUDED.metadata,
            updated_at = now()
          RETURNING ${versionColumns}
        `)
        return versionFromRow(required(result.rows[0], 'create knowledge source version'))
      },
      async updateVersion(input) {
        const currentResult = await db.execute<VersionRow>(sql`
          SELECT ${versionColumns} FROM knowledge_source_versions WHERE id = ${input.id} LIMIT 1
        `)
        const current = currentResult.rows[0]
        if (!current) return null
        const result = await db.execute<VersionRow>(sql`
          UPDATE knowledge_source_versions SET
            status = ${input.status ?? current.status},
            metadata = ${JSON.stringify(input.metadata ?? current.metadata)}::jsonb,
            updated_at = now()
          WHERE id = ${input.id}
          RETURNING ${versionColumns}
        `)
        return result.rows[0] ? versionFromRow(result.rows[0]) : null
      },
      async listVersions(sourceId: string) {
        const result = await db.execute<VersionRow>(sql`
          SELECT ${versionColumns}
          FROM knowledge_source_versions
          WHERE source_id = ${sourceId}
          ORDER BY version DESC
        `)
        return result.rows.map(versionFromRow)
      },
    },
    memberships: {
      async add(input) {
        const result = await db.execute<MembershipRow>(sql`
          INSERT INTO knowledge_base_sources (knowledge_base_id, source_id, added_by, enabled)
          VALUES (${input.knowledgeBaseId}, ${input.sourceId}, ${input.addedBy ?? null}, ${input.enabled})
          ON CONFLICT (knowledge_base_id, source_id) DO UPDATE SET
            added_by = EXCLUDED.added_by,
            enabled = EXCLUDED.enabled
          RETURNING knowledge_base_id AS "knowledgeBaseId", source_id AS "sourceId",
                    added_by AS "addedBy", enabled, created_at AS "createdAt"
        `)
        return membershipFromRow(required(result.rows[0], 'add knowledge source to base'))
      },
      async remove(input) {
        const result = await db.execute(sql`
          DELETE FROM knowledge_base_sources
          WHERE knowledge_base_id = ${input.knowledgeBaseId} AND source_id = ${input.sourceId}
        `)
        return result.rowCount === 1
      },
      async setEnabled(input) {
        const result = await db.execute(sql`
          UPDATE knowledge_base_sources SET enabled = ${input.enabled}
          WHERE knowledge_base_id = ${input.knowledgeBaseId} AND source_id = ${input.sourceId}
        `)
        return result.rowCount === 1
      },
      async listForBase(knowledgeBaseId: string) {
        const result = await db.execute<MembershipRow>(sql`
          SELECT knowledge_base_id AS "knowledgeBaseId", source_id AS "sourceId",
                 added_by AS "addedBy", enabled, created_at AS "createdAt"
          FROM knowledge_base_sources
          WHERE knowledge_base_id = ${knowledgeBaseId}
          ORDER BY created_at, source_id
        `)
        return result.rows.map(membershipFromRow)
      },
      async listBasesForSource(sourceId: string) {
        const result = await db.execute<MembershipRow>(sql`
          SELECT knowledge_base_id AS "knowledgeBaseId", source_id AS "sourceId",
                 added_by AS "addedBy", enabled, created_at AS "createdAt"
          FROM knowledge_base_sources
          WHERE source_id = ${sourceId}
          ORDER BY created_at, knowledge_base_id
        `)
        return result.rows.map(membershipFromRow)
      },
    },
    conversations: {
      async attach(input) {
        const result = await db.execute<ConversationRow>(sql`
          INSERT INTO knowledge_base_conversations (knowledge_base_id, conversation_id, created_by)
          VALUES (${input.knowledgeBaseId}, ${input.conversationId}, ${input.createdBy ?? null})
          ON CONFLICT (conversation_id, knowledge_base_id) DO UPDATE SET
            created_by = EXCLUDED.created_by
          RETURNING ${conversationColumns}
        `)
        return conversationFromRow(required(result.rows[0], 'attach knowledge conversation'))
      },
      async detach(conversationId: string) {
        const result = await db.execute(sql`
          DELETE FROM knowledge_base_conversations WHERE conversation_id = ${conversationId}
        `)
        return (result.rowCount ?? 0) > 0
      },
      async detachOne(input) {
        const result = await db.execute(sql`
          DELETE FROM knowledge_base_conversations
          WHERE conversation_id = ${input.conversationId}
            AND knowledge_base_id = ${input.knowledgeBaseId}
        `)
        return result.rowCount === 1
      },
      async getForConversation(conversationId: string) {
        const result = await db.execute<ConversationRow>(sql`
          SELECT ${conversationColumns}
          FROM knowledge_base_conversations
          WHERE conversation_id = ${conversationId}
          ORDER BY created_at, knowledge_base_id
          LIMIT 1
        `)
        return result.rows[0] ? conversationFromRow(result.rows[0]) : null
      },
      async listForConversation(conversationId: string) {
        const result = await db.execute<ConversationRow>(sql`
          SELECT ${conversationColumns}
          FROM knowledge_base_conversations
          WHERE conversation_id = ${conversationId}
          ORDER BY created_at, knowledge_base_id
        `)
        return result.rows.map(conversationFromRow)
      },
      async listForBase(knowledgeBaseId: string) {
        const result = await db.execute<ConversationRow>(sql`
          SELECT ${conversationColumns}
          FROM knowledge_base_conversations
          WHERE knowledge_base_id = ${knowledgeBaseId}
          ORDER BY created_at, conversation_id
        `)
        return result.rows.map(conversationFromRow)
      },
    },
    diagnostics: {
      async statsForSources(sourceIds: string[]) {
        if (sourceIds.length === 0) return []
        const idList = sql.join(sourceIds.map((id) => sql`${id}`), sql`, `)
        const counts = await db.execute<{
          sourceId: string
          chunkCount: string
          indexedChars: string
          lastIndexedAt: DateValue | null
          indexedContentHash: string | null
        }>(sql`
          SELECT
            knowledge_source_id AS "sourceId",
            count(*)::text AS "chunkCount",
            coalesce(sum(length(text)), 0)::text AS "indexedChars",
            max(updated_at) AS "lastIndexedAt",
            (array_agg(content_hash ORDER BY chunk_index))[1] AS "indexedContentHash"
          FROM knowledge_chunks
          WHERE knowledge_source_id IN (${idList})
          GROUP BY knowledge_source_id
        `)
        const identities = await db.execute<{
          sourceId: string
          provider: string
          modelId: string
          modelVersion: string
          count: string
        }>(sql`
          SELECT
            chunk.knowledge_source_id AS "sourceId",
            embedding.provider AS "provider",
            embedding.model_id AS "modelId",
            embedding.model_version AS "modelVersion",
            count(*)::text AS "count"
          FROM knowledge_chunk_embeddings embedding
          JOIN knowledge_chunks chunk ON chunk.id = embedding.chunk_id
          WHERE chunk.knowledge_source_id IN (${idList})
          GROUP BY 1, 2, 3, 4
        `)
        const bySource = new Map<string, KnowledgeSourceIndexStats>()
        for (const row of counts.rows) {
          bySource.set(row.sourceId, {
            sourceId: row.sourceId,
            chunkCount: Number(row.chunkCount),
            embeddedCount: 0,
            indexedChars: Number(row.indexedChars),
            lastIndexedAt: row.lastIndexedAt ? time(row.lastIndexedAt) : undefined,
            indexedContentHash: row.indexedContentHash ?? undefined,
            indexedEmbeddingIdentities: [],
          })
        }
        for (const row of identities.rows) {
          const stats = bySource.get(row.sourceId)
          if (!stats) continue
          const count = Number(row.count)
          stats.embeddedCount += count
          stats.indexedEmbeddingIdentities.push({
            provider: row.provider,
            modelId: row.modelId,
            modelVersion: row.modelVersion,
            count,
          })
        }
        return [...bySource.values()]
      },
      async extractionPreview({ sourceId, limit }) {
        const result = await db.execute<{ text: string; totalChars: string }>(sql`
          SELECT
            string_agg(text, E'\n\n' ORDER BY chunk_index) AS "text",
            coalesce(sum(length(text)), 0)::text AS "totalChars"
          FROM knowledge_chunks
          WHERE knowledge_source_id = ${sourceId}
        `)
        const row = result.rows[0]
        if (!row?.text) return null
        const totalChars = Number(row.totalChars)
        return {
          text: row.text.slice(0, limit),
          totalChars,
          truncated: row.text.length > limit,
        }
      },
    },
    projects: {
      async attach(input) {
        const result = await db.execute<ProjectAttachmentRow>(sql`
          INSERT INTO project_knowledge_bases (project_id, knowledge_base_id, attached_by)
          VALUES (${input.projectId}, ${input.knowledgeBaseId}, ${input.attachedBy ?? null})
          ON CONFLICT (project_id, knowledge_base_id) DO UPDATE SET
            attached_by = EXCLUDED.attached_by
          RETURNING ${projectAttachmentColumns}
        `)
        return projectAttachmentFromRow(required(result.rows[0], 'attach project knowledge base'))
      },
      async detach(input) {
        const result = await db.execute(sql`
          DELETE FROM project_knowledge_bases
          WHERE project_id = ${input.projectId}
            AND knowledge_base_id = ${input.knowledgeBaseId}
        `)
        return result.rowCount === 1
      },
      async detachAll(projectId: string) {
        const result = await db.execute(sql`
          DELETE FROM project_knowledge_bases WHERE project_id = ${projectId}
        `)
        return (result.rowCount ?? 0) > 0
      },
      async listForProject(projectId: string) {
        const result = await db.execute<ProjectAttachmentRow>(sql`
          SELECT ${projectAttachmentColumns}
          FROM project_knowledge_bases
          WHERE project_id = ${projectId}
          ORDER BY created_at, knowledge_base_id
        `)
        return result.rows.map(projectAttachmentFromRow)
      },
      async listForBase(knowledgeBaseId: string) {
        const result = await db.execute<ProjectAttachmentRow>(sql`
          SELECT ${projectAttachmentColumns}
          FROM project_knowledge_bases
          WHERE knowledge_base_id = ${knowledgeBaseId}
          ORDER BY created_at, project_id
        `)
        return result.rows.map(projectAttachmentFromRow)
      },
    },
  }
}

const baseColumns = sql`
  id, owner_user_id AS "ownerUserId", title, description, kind, status,
  created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt",
  archived_at AS "archivedAt"
`
const sourceColumns = sql`
  id, owner_user_id AS "ownerUserId", kind, source_ref AS "sourceRef", title,
  mime_type AS "mimeType", content_hash AS "contentHash", status,
  status_message AS "statusMessage", metadata, created_by AS "createdBy",
  created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
`
const versionColumns = sql`
  id, source_id AS "sourceId", version, content_hash AS "contentHash", status, metadata,
  created_at AS "createdAt", updated_at AS "updatedAt"
`
const conversationColumns = sql`
  knowledge_base_id AS "knowledgeBaseId", conversation_id AS "conversationId",
  created_by AS "createdBy", created_at AS "createdAt"
`
const projectAttachmentColumns = sql`
  knowledge_base_id AS "knowledgeBaseId", project_id AS "projectId",
  attached_by AS "attachedBy", created_at AS "createdAt"
`

function baseFromRow(row: BaseRow): KnowledgeBase {
  return cleanOptional({ ...row, createdAt: time(row.createdAt), updatedAt: time(row.updatedAt), archivedAt: optionalTime(row.archivedAt) })
}
function sourceFromRow(row: SourceRow): KnowledgeSource {
  return cleanOptional({ ...row, metadata: row.metadata ?? {}, createdAt: time(row.createdAt), updatedAt: time(row.updatedAt), deletedAt: optionalTime(row.deletedAt) })
}
function versionFromRow(row: VersionRow): KnowledgeSourceVersion {
  return { ...row, metadata: row.metadata ?? {}, createdAt: time(row.createdAt), updatedAt: time(row.updatedAt) }
}
function membershipFromRow(row: MembershipRow): KnowledgeBaseSource {
  return cleanOptional({ ...row, createdAt: time(row.createdAt) })
}
function conversationFromRow(row: ConversationRow): KnowledgeBaseConversation {
  return cleanOptional({ ...row, createdAt: time(row.createdAt) })
}
function projectAttachmentFromRow(row: ProjectAttachmentRow): ProjectKnowledgeBase {
  return cleanOptional({ ...row, createdAt: time(row.createdAt) })
}
function time(value: DateValue): number { return new Date(value).getTime() }
function optionalTime(value: DateValue | null): number | undefined { return value ? time(value) : undefined }
function required<T>(row: T | undefined, operation: string): T {
  if (!row) throw new Error(`Postgres ${operation} returned no row`)
  return row
}
function cleanOptional<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined)) as T
}
