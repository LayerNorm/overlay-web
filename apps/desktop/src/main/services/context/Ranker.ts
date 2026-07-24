import { RetrievedMemory } from './Retriever'

interface RankingConfig {
  maxTokens: number
  diversityPenalty: number
  recencyBoost: number
  preferenceBoost: number
}

export interface RankedMemory extends RetrievedMemory {
  rank: number
  tokenEstimate: number
  diversityScore: number
}

export class Ranker {
  private config: RankingConfig = {
    maxTokens: 4000,
    diversityPenalty: 0.1,
    recencyBoost: 1.2,
    preferenceBoost: 1.5
  }

  constructor(config?: Partial<RankingConfig>) {
    this.config = { ...this.config, ...config }
  }

  rank(memories: RetrievedMemory[]): RankedMemory[] {
    if (memories.length === 0) return []

    // 1. Estimate tokens for each memory
    const withTokens: RankedMemory[] = memories.map((m) => ({
      ...m,
      tokenEstimate: this.estimateTokens(m.content),
      diversityScore: 1.0,
      rank: 0
    }))

    // 2. Apply MMR (Maximal Marginal Relevance) for diversity
    const ranked = this.applyMMR(withTokens)

    // 3. Apply type-based boosts
    this.applyTypeBoosts(ranked)

    // 4. Final sorting and ranking
    ranked.sort((a, b) => b.compositeScore - a.compositeScore)
    ranked.forEach((m, i) => (m.rank = i + 1))

    return ranked
  }

  selectForContext(ranked: RankedMemory[], maxTokens?: number): RankedMemory[] {
    const selected: RankedMemory[] = []
    let tokenBudget = maxTokens ?? this.config.maxTokens

    for (const memory of ranked) {
      if (memory.tokenEstimate <= tokenBudget) {
        selected.push(memory)
        tokenBudget -= memory.tokenEstimate
      }

      if (tokenBudget < 100) break // Leave some buffer
    }

    return selected
  }

  private applyMMR(memories: RankedMemory[]): RankedMemory[] {
    if (memories.length <= 1) return memories

    const selected: RankedMemory[] = [memories[0]]
    const remaining = memories.slice(1)

    while (remaining.length > 0 && selected.length < memories.length) {
      let bestIdx = 0
      let bestScore = -Infinity

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i]

        // Calculate max similarity to already selected items
        const maxSimilarity = this.maxSimilarityToSelected(candidate, selected)

        // MMR score: relevance - lambda * similarity
        const mmrScore = candidate.compositeScore - this.config.diversityPenalty * maxSimilarity

        if (mmrScore > bestScore) {
          bestScore = mmrScore
          bestIdx = i
        }
      }

      const chosen = remaining.splice(bestIdx, 1)[0]
      chosen.diversityScore = 1 - this.maxSimilarityToSelected(chosen, selected)
      selected.push(chosen)
    }

    return selected
  }

  private maxSimilarityToSelected(candidate: RankedMemory, selected: RankedMemory[]): number {
    // Use content overlap as similarity proxy
    let maxSim = 0

    const candidateWords = new Set(candidate.content.toLowerCase().split(/\s+/))

    for (const s of selected) {
      const selectedWords = new Set(s.content.toLowerCase().split(/\s+/))
      const intersection = [...candidateWords].filter((w) => selectedWords.has(w))
      const union = new Set([...candidateWords, ...selectedWords])

      const jaccard = union.size > 0 ? intersection.length / union.size : 0
      maxSim = Math.max(maxSim, jaccard)
    }

    return maxSim
  }

  private applyTypeBoosts(memories: RankedMemory[]): void {
    for (const memory of memories) {
      // Actor-based adjustments: agent memories rank lower by default
      if (memory.actor === 'agent') {
        memory.compositeScore *= 0.85 // Slight penalty vs user memories
      }

      switch (memory.type) {
        case 'preference':
          memory.compositeScore *= this.config.preferenceBoost
          break
        case 'conversation':
          // Recent conversations get recency boost
          if (memory.recencyScore > 0.8) {
            memory.compositeScore *= this.config.recencyBoost
          }
          break
        case 'agent':
          // Agent workflow memories rank high when task is similar (high relevance)
          if (memory.relevanceScore > 0.8) {
            // Boost agent memories with high task similarity — they're actionable procedures
            memory.compositeScore *= 1.3
          }
          break
      }

      // Same-folder/same-skill memories get an extra boost
      if (memory.folderId && memory.sourceTaskId) {
        memory.compositeScore *= 1.3
      }
    }
  }

  private estimateTokens(text: string): number {
    // ~4 characters per token for English text
    return Math.ceil(text.length / 4)
  }
}
