import 'server-only'

import type { MemoryExtractionProvider } from './MemoryExtractionProvider'
import { hashMemoryContent, PostgresMemoryRepository } from './PostgresMemoryRepository'
import { PostgresMemoryExtractionRepository } from './PostgresMemoryExtractionRepository'

const MIN_CONFIDENCE = 0.4
const MAX_CANDIDATES = 8
const MAX_DAILY_RUNS = 120

export class MemoryExtractionService {
  constructor(private readonly deps: {
    extractor: MemoryExtractionProvider
    memories: PostgresMemoryRepository
    runs: PostgresMemoryExtractionRepository
  }) {}

  async extractTurn(args: {
    conversationId: string
    messageId: string
    turnId: string
    userId: string
  }): Promise<{ duplicates: number; extracted: number; inserted: number; reason?: string }> {
    const turn = await this.deps.runs.getTurn(args)
    if (!turn) return { duplicates: 0, extracted: 0, inserted: 0, reason: 'no_user_message' }
    const runId = await this.deps.runs.startRun({
      ...args,
      modelId: this.deps.extractor.modelId,
    })
    const skipReason = extractionSkipReason(turn.targetText)
    if (skipReason) {
      await this.deps.runs.completeRun({
        duplicateCount: 0,
        extractedCount: 0,
        insertedCount: 0,
        reason: skipReason,
        runId,
        status: 'skipped',
      })
      return { duplicates: 0, extracted: 0, inserted: 0, reason: skipReason }
    }
    const startOfDay = new Date()
    startOfDay.setUTCHours(0, 0, 0, 0)
    if (await this.deps.runs.countRunsSince({ since: startOfDay, userId: args.userId }) > MAX_DAILY_RUNS) {
      await this.deps.runs.completeRun({
        duplicateCount: 0,
        extractedCount: 0,
        insertedCount: 0,
        reason: 'daily_limit',
        runId,
        status: 'skipped',
      })
      return { duplicates: 0, extracted: 0, inserted: 0, reason: 'daily_limit' }
    }

    try {
      const candidates = (await this.deps.extractor.extract({
        contextMessages: turn.contextMessages,
        targetText: turn.targetText,
      })).filter((candidate) => (
        candidate.content.trim().length > 5 && candidate.confidence >= MIN_CONFIDENCE
      )).slice(0, MAX_CANDIDATES)
      const existingHashes = new Set(
        (await this.deps.memories.list({ includeDeleted: false, userId: args.userId }))
          .map((memory) => hashMemoryContent(memory.content)),
      )
      let duplicates = 0
      let inserted = 0
      for (const candidate of candidates) {
        const content = candidate.content.trim()
        const hash = hashMemoryContent(content)
        if (existingHashes.has(hash)) {
          duplicates += 1
          continue
        }
        await this.deps.memories.create({
          actor: 'user',
          content,
          conversationId: args.conversationId,
          messageId: turn.messageId,
          projectId: turn.projectId,
          source: 'chat',
          turnId: turn.turnId,
          type: candidate.type,
          userId: args.userId,
        })
        existingHashes.add(hash)
        inserted += 1
      }
      await this.deps.runs.completeRun({
        duplicateCount: duplicates,
        extractedCount: candidates.length,
        insertedCount: inserted,
        reason: candidates.length === 0 ? 'no_candidates' : undefined,
        runId,
        status: candidates.length === 0 ? 'skipped' : 'succeeded',
      })
      return {
        duplicates,
        extracted: candidates.length,
        inserted,
        ...(candidates.length === 0 ? { reason: 'no_candidates' } : {}),
      }
    } catch (error) {
      await this.deps.runs.completeRun({
        duplicateCount: 0,
        error: error instanceof Error ? error.message : String(error),
        extractedCount: 0,
        insertedCount: 0,
        reason: 'error',
        runId,
        status: 'failed',
      })
      throw error
    }
  }
}

function extractionSkipReason(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.length < 20) return 'too_short'
  if (/^[`\s]*```/.test(trimmed) && trimmed.split('\n').length < 3) return 'likely_code'
  return null
}
