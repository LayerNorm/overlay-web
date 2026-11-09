import 'server-only'

import { tool, type ToolSet } from '@/server/ai/sdk'
import { z } from 'zod/v3'
import type { PersonalChatWorkToolDefinition, PersonalChatWorkToolingContext } from '@/shared/agents/personal-chat-work'
import { executeSearchKnowledge } from '@/server/tools/tools/overlay-executes'
import type { OverlayToolsOptions } from '@/server/tools/tools/types'
import { ConvexHarnessRepository } from '@/server/harness/ConvexHarnessRepository'
import { getOverlayServerContext } from '@/server/bootstrap'
import { NoteService } from '@/server/notes'
import { ConvexNoteRepository } from '@/server/notes/ConvexNoteRepository'
import { buildNotebookEditProposal, readFrozenNotebook } from './notebook-agent-utils'

const descriptions = {
  search_knowledge: "Search the user's saved knowledge: indexed files and memories. Uses hybrid semantic + keyword retrieval. Call when you need facts that are not already in the note text.",
  read_note: 'Read note title and content with line numbers.',
  propose_edit: 'Propose replacing a line range with new content. User can accept/reject each edit. Only use this when the user explicitly asks to modify the note.',
  finish: 'Signal notebook task completion with a summary.',
} as const

export function createNotebookToolSchemas(searchKnowledge: boolean): ToolSet {
  const tools: ToolSet = {
    read_note: tool({ description: descriptions.read_note, inputSchema: z.object({}) }),
    propose_edit: tool({
      description: descriptions.propose_edit,
      inputSchema: z.object({
        description: z.string().max(200).describe('Short edit label'),
        start_line: z.number().describe('First line to replace (1-based)'),
        end_line: z.number().describe('Last line to replace (1-based, inclusive)'),
        new_content: z.string().max(400_000).describe('Replacement content; empty string deletes lines'),
      }),
    }),
    finish: tool({
      description: descriptions.finish,
      inputSchema: z.object({ summary: z.string().max(1_000).describe('One sentence summary') }),
    }),
  }
  if (searchKnowledge) {
    tools.search_knowledge = tool({
      description: descriptions.search_knowledge,
      inputSchema: z.object({
        query: z.string().max(32_000).describe('Search query: keywords or a short natural-language question'),
        sourceKind: z.enum(['file', 'memory']).optional()
          .describe('Limit to files only or memories only (omit to search both)'),
      }),
    })
  }
  return tools
}

export async function describeNotebookTools(searchKnowledge: boolean): Promise<PersonalChatWorkToolDefinition[]> {
  const { describePersonalChatWorkTools } = await import('@/server/conversations/personal-chat-work-tools')
  return describePersonalChatWorkTools(createNotebookToolSchemas(searchKnowledge), false)
}

function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Notebook tool input.')
  return value as Record<string, unknown>
}

export async function executeNotebookHarnessTool(input: {
  toolName: string
  value: unknown
  toolCallId: string
  context: PersonalChatWorkToolingContext & { notebook: NonNullable<PersonalChatWorkToolingContext['notebook']> }
  runId: string
  toolOptions: OverlayToolsOptions
}): Promise<unknown> {
  const server = getOverlayServerContext()
  await server.authorizationService.assertCapability({
    capability: 'notes.edit',
    userId: input.context.userId,
  })
  const currentNote = await new NoteService({ noteRepository: new ConvexNoteRepository() }).getNote({
    noteId: input.context.notebook.noteId,
    userId: input.context.userId,
    workspaceId: input.context.workspaceId,
  })
  const state = await new ConvexHarnessRepository().get({
    actorUserId: input.context.userId,
    runId: input.runId,
  })
  if (!currentNote || !state || state.policy.surface?.kind !== 'notebook'
    || state.policy.surface.noteId !== input.context.notebook.noteId
    || state.policy.surface.turnId !== input.context.turnId
    || state.policy.surface.requestDigest !== input.context.notebook.requestDigest
    || state.policy.actorUserId !== input.context.userId
    || state.policy.workspaceId !== input.context.workspaceId
    || !state.policy.allowedToolIds.includes(input.toolName)) {
    throw new Error('Notebook harness authority is no longer valid.')
  }

  switch (input.toolName) {
    case 'read_note': {
      return readFrozenNotebook(input.context.notebook)
    }
    case 'propose_edit': {
      const value = objectInput(input.value)
      const { description, start_line, end_line, new_content } = value
      const edit = buildNotebookEditProposal({
        runId: input.runId,
        toolCallId: input.toolCallId,
        content: input.context.notebook.content,
        description,
        startLine: start_line,
        endLine: end_line,
        newContent: new_content,
      })
      return { success: true, editId: edit.id, edit, message: `Edit proposed (lines ${edit.startLine}-${edit.endLine})` }
    }
    case 'search_knowledge': {
      const value = objectInput(input.value)
      if (typeof value.query !== 'string' || !input.context.notebook) throw new Error('Invalid knowledge search.')
      const [toolGrant, memoryGrant, subject] = await Promise.all([
        server.authorizationService.checkCapability({ capability: 'tools.use', userId: input.context.userId }),
        server.authorizationService.checkCapability({ capability: 'memory.use', userId: input.context.userId }),
        server.authorizationService.resolveSubject(input.context.userId),
      ])
      const catalogGrant = await server.authorizationService.checkResolvedCatalogResourceAccess({
        capability: 'tools.use',
        resourceId: 'search_knowledge',
        resourceType: 'tool',
        subject,
      })
      if (!toolGrant.allowed || !catalogGrant.allowed
        || !input.context.accountAllowedToolIds?.includes('search_knowledge')) {
        throw new Error('Knowledge search is no longer authorized.')
      }
      return await executeSearchKnowledge({
        ...input.toolOptions,
        memoryEnabled: input.context.memoryEnabled && memoryGrant.allowed,
      }, {
        query: value.query,
        ...(value.sourceKind === 'file' || value.sourceKind === 'memory' ? { sourceKind: value.sourceKind } : {}),
      })
    }
    case 'finish': {
      const value = objectInput(input.value)
      if (typeof value.summary !== 'string') throw new Error('Invalid completion summary.')
      return { success: true, summary: value.summary }
    }
    default:
      throw new Error(`Notebook tool ${input.toolName} is unavailable.`)
  }
}
