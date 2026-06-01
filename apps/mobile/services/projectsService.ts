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
