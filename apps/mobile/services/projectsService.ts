import { appJson } from './appApi'
import type {
  ConversationSummary,
  KnowledgeFile,
  NoteDoc,
  ProjectSummary,
  SkillSummary,
} from '@overlay/app-core'

export async function listProjects(): Promise<ProjectSummary[]> {
  return appJson<ProjectSummary[]>('/api/v1/projects')
}

export async function getProject(projectId: string): Promise<ProjectSummary> {
  return appJson<ProjectSummary>('/api/v1/projects', {
    query: { projectId },
  })
}

export async function createProject(input: {
  name: string
  instructions?: string
  parentId?: string | null
}): Promise<{ id: string; project: ProjectSummary }> {
  return appJson<{ id: string; project: ProjectSummary }>('/api/v1/projects', {
    method: 'POST',
    json: input,
  })
}

export async function updateProject(
  projectId: string,
  patch: { name?: string; instructions?: string; parentId?: string | null },
): Promise<{ success: boolean; project?: ProjectSummary }> {
  return appJson<{ success: boolean; project?: ProjectSummary }>('/api/v1/projects', {
    method: 'PATCH',
    json: { projectId, ...patch },
  })
}

export async function deleteProject(projectId: string): Promise<void> {
  await appJson('/api/v1/projects', {
    method: 'DELETE',
    query: { projectId },
  })
}

export async function listProjectChats(projectId: string): Promise<ConversationSummary[]> {
  return appJson<ConversationSummary[]>('/api/v1/conversations', {
    query: { projectId },
  })
}

export async function listProjectNotes(projectId: string): Promise<NoteDoc[]> {
  return appJson<NoteDoc[]>('/api/v1/notes', {
    query: { projectId },
  })
}

export async function listProjectFiles(projectId: string): Promise<KnowledgeFile[]> {
  return appJson<KnowledgeFile[]>('/api/v1/files', {
    query: { projectId },
  })
}

export async function listProjectSkills(projectId: string): Promise<SkillSummary[]> {
  return appJson<SkillSummary[]>('/api/v1/skills', {
    query: { projectId },
  })
}

// ── Phase 5: export / duplicate / knowledge-base attachments / transfer ──

export interface ProjectExportPayload {
  project: unknown
  files?: unknown[]
  [key: string]: unknown
}

/** Portable JSON archive — GET /api/v1/projects/export?projectId=. */
export async function exportProject(projectId: string): Promise<ProjectExportPayload> {
  return appJson<ProjectExportPayload>('/api/v1/projects/export', {
    query: { projectId },
  })
}

/** Clones a project's configuration (never its working data). */
export async function duplicateProject(
  sourceProjectId: string,
  name: string,
): Promise<{ project?: ProjectSummary }> {
  return appJson<{ project?: ProjectSummary }>('/api/v1/projects/duplicate', {
    method: 'POST',
    json: { sourceProjectId, name },
  })
}

export interface ProjectKnowledgeBaseLink {
  knowledgeBaseId: string
  projectId: string
  attachedBy?: string
  createdAt: number
}

export async function listProjectKnowledgeBases(
  projectId: string,
): Promise<ProjectKnowledgeBaseLink[]> {
  const data = await appJson<{ knowledgeBases: ProjectKnowledgeBaseLink[] }>(
    '/api/v1/projects/knowledge-bases',
    { query: { projectId } },
  )
  return data.knowledgeBases
}

export async function attachProjectKnowledgeBase(
  projectId: string,
  knowledgeBaseId: string,
): Promise<void> {
  await appJson('/api/v1/projects/knowledge-bases', {
    method: 'POST',
    json: { projectId, knowledgeBaseId },
  })
}

export async function detachProjectKnowledgeBase(
  projectId: string,
  knowledgeBaseId: string,
): Promise<void> {
  await appJson('/api/v1/projects/knowledge-bases', {
    method: 'DELETE',
    json: { projectId, knowledgeBaseId },
  })
}

/** Moves material between a project and a knowledge base. */
export async function transferProjectKnowledge(body: {
  projectId?: string
  knowledgeBaseId?: string
  direction: 'promote' | 'copy' | 'save-answer'
  fileId?: string
  sourceId?: string
  conversationId?: string
  messageId?: string
  content?: string
  title?: string
}): Promise<Record<string, unknown>> {
  return appJson<Record<string, unknown>>('/api/v1/projects/knowledge-transfer', {
    method: 'POST',
    json: body,
  })
}
