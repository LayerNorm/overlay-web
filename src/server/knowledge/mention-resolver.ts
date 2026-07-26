import 'server-only'

/**
 * Resolve incoming @-mention metadata into a compact system-prompt block. Used by the
 * chat agent (act/route), the notebook agent, and the automations runner so they all
 * share one resolution policy.
 *
 * Policy: lightweight metadata only. We include the entity ID so downstream tools can
 * read/write directly without searching, plus a single-line summary per entity.
 */

import { convex } from '@/server/database/convex'
import { getOverlayServerContext } from '@/server/bootstrap'

export interface IncomingMention {
  type: string
  id: string
  name: string
  fileIds?: string[]
}

export interface ResolveOptions {
  userId: string
  serverSecret: string
  /** Pass already-loaded skills if the caller has them; resolver matches by name first. */
  enabledSkills?: Array<{ name: string; instructions: string }>
}

interface FileDoc {
  _id: string
  name?: string
  kind?: string
  mimeType?: string
  byteSize?: number
  indexed?: boolean
}

interface AutomationDoc {
  _id: string
  name?: string
  description?: string
  enabled?: boolean
  schedule?: { kind?: string }
}

interface ConversationDoc {
  _id: string
  title?: string
  lastModified?: number
}

const HEADER =
  '<overlay_user_mentions>\n' +
  'The user @-referenced these Overlay entities. They are part of the Overlay operating system. ' +
  'Treat them as in-scope: use the provided IDs directly with read/list/run tools — do not search ' +
  'for them. Each line gives the entity type, its canonical ID, and a brief metadata summary.\n'

function fmtFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

async function resolveOne(
  m: IncomingMention,
  opts: ResolveOptions,
): Promise<string> {
  const { userId, serverSecret, enabledSkills } = opts
  const safeName = m.name?.trim() || '(unnamed)'

  try {
    switch (m.type) {
      case 'file': {
        const file = await convex
          .query<FileDoc | null>('files/files:get', { fileId: m.id, userId, serverSecret })
          .catch((_error) => null)
        if (!file) {
          return `- file id=${m.id} name="${safeName}" — (not found)`
        }
        const parts = [
          file.kind || file.mimeType,
          fmtFileSize(file.byteSize),
          file.indexed ? 'indexed' : 'not-indexed',
        ].filter(Boolean)
        const fileIdsHint = m.fileIds?.length ? ` chunkIds=[${m.fileIds.join(',')}]` : ''
        return `- file id=${file._id} name="${file.name || safeName}" — ${parts.join(', ') || 'file'}${fileIdsHint}`
      }
      case 'automation': {
        const a = await convex
          .query<AutomationDoc | null>('automations/automations:get', {
            automationId: m.id,
            userId,
            serverSecret,
          })
          .catch((_error) => null)
        if (!a) return `- automation id=${m.id} name="${safeName}" — (not found)`
        const sched = a.schedule?.kind ? `schedule=${a.schedule.kind}` : ''
        const en = a.enabled === false ? 'disabled' : 'enabled'
        const desc = a.description ? `desc="${a.description.slice(0, 80)}"` : ''
        return `- automation id=${a._id} name="${a.name || safeName}" — ${[en, sched, desc]
          .filter(Boolean)
          .join(', ')}`
      }
      case 'skill': {
        // Match skills by name from the already-loaded enabledSkills (saves a round-trip).
        const skill = enabledSkills?.find((s) => s.name === m.name)
        if (skill) {
          const brief = skill.instructions.trim().split('\n').slice(0, 2).join(' ').slice(0, 200)
          return `- skill name="${skill.name}" — instructions="${brief}${
            skill.instructions.length > brief.length ? '…' : ''
          }"`
        }
        return `- skill id=${m.id} name="${safeName}"`
      }
      case 'mcp': {
        const mcp = await getOverlayServerContext().appData.repositories.mcpServers
          .get({
            mcpServerId: m.id,
            userId,
          })
          .catch((_error) => null)
        if (!mcp) return `- mcp id=${m.id} name="${safeName}" — (not found)`
        const toolNames = mcp.toolCatalog.map((tool) => tool.name)
        const tools = toolNames.length
          ? `tools=[${toolNames.slice(0, 8).join(',')}${toolNames.length > 8 ? '…' : ''}]`
          : ''
        const url = mcp.url ? `url=${mcp.url}` : ''
        return `- mcp id=${mcp._id} name="${mcp.name || safeName}" — ${[url, tools]
          .filter(Boolean)
          .join(', ')}`
      }
      case 'connector': {
        return `- connector slug=${m.id} name="${safeName}" — Composio tools for this app are available; prefer them over generic web tools.`
      }
      case 'knowledge': {
        const knowledgeBase = await getOverlayServerContext().knowledgeBaseService
          .getKnowledgeBase({
            knowledgeBaseId: m.id,
            userId,
          })
          .catch((_error) => null)
        if (!knowledgeBase) {
          return `- knowledge id=${m.id} name="${safeName}" — (not found or inaccessible)`
        }
        const description = knowledgeBase.description
          ? `description="${knowledgeBase.description.slice(0, 160)}"`
          : 'curated retrieval corpus'
        return `- knowledge id=${knowledgeBase.id} name="${knowledgeBase.title || safeName}" — ${description}`
      }
      case 'chat': {
        const c = await convex
          .query<ConversationDoc | null>('chat/conversations:get', {
            conversationId: m.id,
            userId,
            serverSecret,
          })
          .catch((_error) => null)
        if (!c) return `- chat id=${m.id} name="${safeName}" — (not found)`
        const when = c.lastModified
          ? `lastActive=${new Date(c.lastModified).toISOString().slice(0, 10)}`
          : ''
        return `- chat id=${c._id} title="${c.title || safeName}" — ${when}`
      }
      default:
        return `- ${m.type} id=${m.id} name="${safeName}"`
    }
  } catch (_error) {
    return `- ${m.type} id=${m.id} name="${safeName}"`
  }
}

export async function resolveMentionsContext(
  mentions: IncomingMention[] | undefined,
  opts: ResolveOptions,
): Promise<string> {
  if (!mentions || mentions.length === 0) return ''
  // Dedupe by type+id to avoid double-resolving the same entity.
  const seen = new Set<string>()
  const unique: IncomingMention[] = []
  for (const m of mentions) {
    if (!m?.type || !m?.id) continue
    const key = `${m.type}::${m.id}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(m)
  }
  if (unique.length === 0) return ''

  const lines = await Promise.all(unique.map((m) => resolveOne(m, opts)))
  return `\n\n${HEADER}${lines.join('\n')}\n</overlay_user_mentions>`
}
