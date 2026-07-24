import * as path from 'path'
import { app } from 'electron'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

export interface SkillFrontmatter {
  version: number
  status: 'draft' | 'active' | 'archived'
  triggers: string[]
  description: string
  scope: { global: boolean; folderIds: string[] }
  inputs: Array<{ name: string; description: string; required: boolean }>
  source: {
    kind: 'manual' | 'agent-run' | 'marketplace'
    chatId?: string
    messageId?: string
    runId?: string
  }
  executionMode: 'prompt-procedure' | 'tool-guided'
  enabled: boolean
  usageCount: number
  lastUsedAt: number
  previousVersions?: Array<{ content: string; updatedAt: number }>
}

export interface MatchedSkill {
  noteId: string
  title: string
  description: string
  triggers: string[]
  content: string
  score: number
  isPinned: boolean
}

export class SkillMatcherService {
  private getNotesDir(): string {
    return path.join(app.getPath('userData'), 'notes')
  }

  private loadNote(
    noteId: string
  ): { title: string; content: string; skill?: SkillFrontmatter } | null {
    const filePath = path.join(this.getNotesDir(), `${noteId}.md`)
    if (!existsSync(filePath)) return null
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n/)
      if (!frontmatterMatch) return null
      const metadata = JSON.parse(frontmatterMatch[1])
      const noteContent = raw.slice(frontmatterMatch[0].length)
      return {
        title: metadata.title ?? '',
        content: noteContent,
        skill: metadata.skill as SkillFrontmatter | undefined
      }
    } catch {
      return null
    }
  }

  async matchSkills(query: string, limit = 3): Promise<MatchedSkill[]> {
    try {
      // Detect explicit @SkillName mentions for pinning
      const mentionMatches = query.match(/@([\w\s]+?)(?=[\s,.]|$)/g)
      const mentionedNames = mentionMatches?.map((m) => m.slice(1).trim().toLowerCase()) ?? []

      const matched: MatchedSkill[] = []
      const notesDir = this.getNotesDir()
      const files = existsSync(notesDir)
        ? readdirSync(notesDir).filter((f) => f.endsWith('.md'))
        : []
      const queryLower = query.toLowerCase()

      for (const file of files) {
        const noteId = file.replace(/\.md$/, '')
        const noteData = this.loadNote(noteId)
        if (!noteData) continue

        const skill = noteData.skill

        // Skip notes that have no skill metadata (they're regular notes, not skills)
        if (!skill) continue

        // Skip disabled or archived skills
        if (!skill.enabled || skill.status === 'archived') continue

        const titleLower = noteData.title.toLowerCase()
        const isPinned = mentionedNames.some((m) => titleLower.includes(m))

        let score = titleLower.includes(queryLower) ? 0.7 : 0.2
        if (isPinned) {
          score = 1.0
        } else if (skill?.triggers?.length) {
          const triggerMatches = skill.triggers.filter((t) => queryLower.includes(t.toLowerCase()))
          if (triggerMatches.length > 0) {
            score = Math.min(1.0, score * (1 + 0.25 * triggerMatches.length))
          }
        }

        // Skip very low relevance results (unless explicitly pinned by @mention)
        if (score < 0.1 && !isPinned) continue

        matched.push({
          noteId,
          title: noteData.title,
          description:
            skill?.description ??
            noteData.content
              .replace(/<[^>]*>/g, ' ')
              .trim()
              .slice(0, 120),
          triggers: skill?.triggers ?? [],
          content: noteData.content,
          score,
          isPinned
        })
      }

      return matched
        .sort((a, b) => {
          if (a.isPinned && !b.isPinned) return -1
          if (!a.isPinned && b.isPinned) return 1
          return b.score - a.score
        })
        .slice(0, limit)
    } catch (err) {
      console.warn('[SkillMatcher] matchSkills failed:', err)
      return []
    }
  }
}

let instance: SkillMatcherService | null = null

export function getSkillMatcherService(): SkillMatcherService {
  if (!instance) instance = new SkillMatcherService()
  return instance
}
