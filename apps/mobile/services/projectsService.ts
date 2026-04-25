import { appJson } from './appApi'
import type {
  ConversationSummary,
  KnowledgeFile,
  NoteDoc,
  ProjectSummary,
  SkillSummary,
} from '@overlay/app-core'

export async function listProjects(): Promise<ProjectSummary[]> {
  return appJson<ProjectSummary[]>('/api/app/projects')
}

export async function getProject(projectId: string): Promise<ProjectSummary> {
  return appJson<ProjectSummary>('/api/app/projects', {
    query: { projectId },
  })
}

export async function createProject(input: {
  name: string
  instructions?: string
  parentId?: string | null
}): Promise<{ id: string; project: ProjectSummary }> {
  return appJson<{ id: string; project: ProjectSummary }>('/api/app/projects', {
    method: 'POST',
    json: input,
  })
}

export async function listProjectChats(projectId: string): Promise<ConversationSummary[]> {
  return appJson<ConversationSummary[]>('/api/app/conversations', {
    query: { projectId },
  })
}

export async function listProjectNotes(projectId: string): Promise<NoteDoc[]> {
  return appJson<NoteDoc[]>('/api/app/notes', {
    query: { projectId },
  })
}

export async function listProjectFiles(projectId: string): Promise<KnowledgeFile[]> {
  return appJson<KnowledgeFile[]>('/api/app/files', {
    query: { projectId },
  })
}

export async function listProjectSkills(projectId: string): Promise<SkillSummary[]> {
  return appJson<SkillSummary[]>('/api/app/skills', {
    query: { projectId },
  })
}
