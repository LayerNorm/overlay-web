import { RankedMemory } from './Ranker'

export interface ContextSection {
  title: string
  content: string
  priority: number
  tokenCount: number
  sources: string[]
}

export interface ExplicitMentionContent {
  id: string
  type: 'note' | 'chat' | 'document' | 'folder'
  title: string
  content: string
}

export interface AssembledContext {
  systemContext: string
  totalTokens: number
  sections: ContextSection[]
  truncated: boolean
  memoriesUsed: number
}

interface AssemblyConfig {
  maxSystemTokens: number
  includeSourceCitations: boolean
  formatStyle: 'markdown' | 'xml' | 'plain'
}

export class ContextAssembler {
  private config: AssemblyConfig = {
    maxSystemTokens: 3000,
    includeSourceCitations: false,
    formatStyle: 'xml'
  }

  constructor(config?: Partial<AssemblyConfig>) {
    this.config = { ...this.config, ...config }
  }

  assemble(
    memories: RankedMemory[],
    projectInstructions?: string,
    explicitMentions?: ExplicitMentionContent[]
  ): AssembledContext {
    if (memories.length === 0 && !projectInstructions && !explicitMentions?.length) {
      return {
        systemContext: '',
        totalTokens: 0,
        sections: [],
        truncated: false,
        memoriesUsed: 0
      }
    }

    // 1. Group memories by type
    const grouped = this.groupByType(memories)

    // 2. Build sections with priorities
    const sections: ContextSection[] = []

    // Explicit mentions (highest priority - user explicitly referenced these)
    if (explicitMentions?.length) {
      const mentionsByType = this.groupExplicitMentions(explicitMentions)

      if (mentionsByType.note?.length) {
        sections.push(this.buildExplicitSection('Referenced Notes', mentionsByType.note, 12))
      }
      if (mentionsByType.chat?.length) {
        sections.push(this.buildExplicitSection('Referenced Chats', mentionsByType.chat, 12))
      }
      if (mentionsByType.document?.length) {
        sections.push(
          this.buildExplicitSection('Referenced Documents', mentionsByType.document, 12)
        )
      }
      if (mentionsByType.folder?.length) {
        sections.push(this.buildExplicitSection('Folder Context', mentionsByType.folder, 11))
      }
    }

    // Project instructions (high priority)
    if (projectInstructions?.trim()) {
      sections.push({
        title: 'Project Instructions',
        content: projectInstructions.trim(),
        priority: 10,
        tokenCount: this.countTokens(projectInstructions),
        sources: ['project']
      })
    }

    // User preferences
    if (grouped.preference?.length) {
      sections.push(this.buildSection('User Preferences', grouped.preference, 9))
    }

    // Relevant facts
    if (grouped.fact?.length) {
      sections.push(this.buildSection('Relevant Context', grouped.fact, 8))
    }

    // Project context
    if (grouped.project?.length) {
      sections.push(this.buildSection('Project Context', grouped.project, 8))
    }

    // Decisions & conclusions
    if (grouped.decision?.length) {
      sections.push(this.buildSection('Key Decisions', grouped.decision, 7))
    }

    // Code snippets
    if (grouped.code?.length) {
      sections.push(this.buildSection('Code Context', grouped.code, 7))
    }

    // Previous tasks
    if (grouped.task?.length) {
      sections.push(this.buildSection('Related Tasks', grouped.task, 5))
    }

    // Conversation memories
    if (grouped.conversation?.length) {
      sections.push(this.buildSection('Previous Conversations', grouped.conversation, 4))
    }

    // Correction memories (to avoid repeating mistakes)
    if (grouped.correction?.length) {
      sections.push(this.buildSection('Important Corrections', grouped.correction, 6))
    }

    // 3. Budget tokens
    const { selectedSections, truncated } = this.budgetTokens(sections)

    // 4. Format output
    const systemContext = this.formatSections(selectedSections)

    return {
      systemContext,
      totalTokens: this.countTokens(systemContext),
      sections: selectedSections,
      truncated,
      memoriesUsed: memories.length
    }
  }

  private groupByType(memories: RankedMemory[]): Record<string, RankedMemory[]> {
    const grouped: Record<string, RankedMemory[]> = {}

    for (const memory of memories) {
      const type = memory.type
      if (!grouped[type]) grouped[type] = []
      grouped[type].push(memory)
    }

    return grouped
  }

  private buildSection(title: string, memories: RankedMemory[], priority: number): ContextSection {
    const content = memories
      .map((m) => {
        if (this.config.includeSourceCitations) {
          return `- ${m.content} [${m.source}]`
        }
        return `- ${m.content}`
      })
      .join('\n')

    return {
      title,
      content,
      priority,
      tokenCount: this.countTokens(content),
      sources: memories.map((m) => m.id)
    }
  }

  private budgetTokens(sections: ContextSection[]): {
    selectedSections: ContextSection[]
    truncated: boolean
  } {
    // Sort by priority (highest first)
    const sorted = [...sections].sort((a, b) => b.priority - a.priority)

    const selectedSections: ContextSection[] = []
    let budget = this.config.maxSystemTokens
    let truncated = false

    for (const section of sorted) {
      if (section.tokenCount <= budget) {
        selectedSections.push(section)
        budget -= section.tokenCount
      } else {
        // Try to compress the section
        const compressed = this.compressSection(section, budget)
        if (compressed) {
          selectedSections.push(compressed)
          budget -= compressed.tokenCount
        }
        truncated = true
      }
    }

    return { selectedSections, truncated }
  }

  private compressSection(section: ContextSection, maxTokens: number): ContextSection | null {
    // Simple compression: take first N items that fit
    const lines = section.content.split('\n')
    const compressed: string[] = []
    let tokens = 0

    for (const line of lines) {
      const lineTokens = this.countTokens(line)
      if (tokens + lineTokens > maxTokens) break
      compressed.push(line)
      tokens += lineTokens
    }

    if (compressed.length === 0) return null

    return {
      ...section,
      content: compressed.join('\n'),
      tokenCount: tokens
    }
  }

  private formatSections(sections: ContextSection[]): string {
    if (sections.length === 0) return ''

    if (this.config.formatStyle === 'xml') {
      return sections
        .map((s) => {
          const tag = s.title.toLowerCase().replace(/\s+/g, '_')
          return `<${tag}>\n${s.content}\n</${tag}>`
        })
        .join('\n\n')
    }

    if (this.config.formatStyle === 'markdown') {
      return sections.map((s) => `## ${s.title}\n\n${s.content}`).join('\n\n')
    }

    return sections.map((s) => `${s.title}:\n${s.content}`).join('\n\n')
  }

  private countTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  private groupExplicitMentions(
    mentions: ExplicitMentionContent[]
  ): Record<string, ExplicitMentionContent[]> {
    const grouped: Record<string, ExplicitMentionContent[]> = {}

    for (const mention of mentions) {
      if (!grouped[mention.type]) grouped[mention.type] = []
      grouped[mention.type].push(mention)
    }

    return grouped
  }

  private buildExplicitSection(
    title: string,
    mentions: ExplicitMentionContent[],
    priority: number
  ): ContextSection {
    const content = mentions
      .map((m) => {
        return `### ${m.title}\n${m.content}`
      })
      .join('\n\n')

    return {
      title,
      content,
      priority,
      tokenCount: this.countTokens(content),
      sources: mentions.map((m) => m.id)
    }
  }
}
