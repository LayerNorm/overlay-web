import type { BenchTurn } from '../extractor'

/** Normalized benchmark unit: one memory owner, one history, N questions. */
export type BenchCase = {
  caseId: string
  /** Ordered messages to run through extraction/ingestion. */
  messages: BenchTurn[]
  questions: BenchQuestion[]
  /**
   * When set, messages outside evidence turns are bulk-ingested as transcript
   * memories instead of per-message extraction (ConvoMem filler convos).
   */
  bulkMessages?: BenchTurn[]
  /** True when the case's haystack exceeded ingestion caps (LME trajectories). */
  truncated?: boolean
}

export type BenchQuestion = {
  questionId: string
  question: string
  goldAnswer: string
  category: string
  expectsAbstention?: boolean
  /** ISO date the question is asked at (temporal anchoring). */
  questionDate?: string
  /** Source turn ids carrying gold evidence — for retrieval-recall diagnostics. */
  evidenceTurnIds?: string[]
  /** LongMemEval-V2 declarative eval function (e.g. "norm_phrase_set_match|..."). */
  evalFunction?: string
}

export type BenchDataset = {
  name: 'locomo' | 'convomem' | 'longmemeval-v2'
  cases: BenchCase[]
}
