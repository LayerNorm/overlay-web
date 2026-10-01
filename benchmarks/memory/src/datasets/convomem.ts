import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { config } from '../config'
import type { BenchTurn } from '../extractor'
import type { BenchCase, BenchDataset } from './types'

/**
 * ConvoMem (SalesforceAIResearch/ConvoMem): evidence questions across six
 * categories — user_evidence, preference_evidence, assistant_facts_evidence,
 * changing_evidence, implicit_connection_evidence, abstention_evidence.
 *
 * Each downloaded file holds ~100 evidence_items; we take a bounded subset per
 * category. Evidence conversations go through real per-message extraction;
 * a fixed number of filler conversations are bulk-ingested as transcript
 * memories to create a retrieval haystack.
 */

type ConvomemMessage = { speaker: string; text: string }
type ConvomemConversation = { messages: ConvomemMessage[]; id?: string; containsEvidence?: boolean }
type ConvomemEvidenceItem = {
  question: string
  answer: string
  message_evidences?: Array<{ speaker: string; text: string }>
  conversations?: ConvomemConversation[]
  category?: string
  scenario_description?: string
}
type ConvomemFile = { evidence_items?: ConvomemEvidenceItem[] } | ConvomemEvidenceItem[]

const CATEGORY_LABEL: Record<string, string> = {
  user_evidence: 'user-facts',
  preference_evidence: 'preferences',
  assistant_facts_evidence: 'assistant-facts',
  changing_evidence: 'changing-facts',
  implicit_connection_evidence: 'implicit-connection',
  abstention_evidence: 'abstention',
}

export function loadConvomem(opts?: {
  itemsPerCategory?: number
  fillerConvosPerCase?: number
}): BenchDataset {
  const itemsPerCategory = opts?.itemsPerCategory ?? 15
  const fillerPerCase = opts?.fillerConvosPerCase ?? 3
  const root = path.join(config.datasetsDir, 'convomem')
  if (!existsSync(root)) throw new Error('convomem dataset missing — run: npx tsx benchmarks/memory/src/download.ts convomem')

  const fillers = loadFillers(root)
  const cases: BenchCase[] = []

  for (const dir of readdirSync(root)) {
    const catDir = path.join(root, dir)
    if (!existsSync(catDir) || dir === 'filler' || !CATEGORY_LABEL[dir]) continue
    for (const file of readdirSync(catDir).filter((f) => f.endsWith('.json'))) {
      const raw = JSON.parse(readFileSync(path.join(catDir, file), 'utf8')) as ConvomemFile
      const items = Array.isArray(raw) ? raw : raw.evidence_items ?? []
      for (const [idx, item] of items.slice(0, itemsPerCategory).entries()) {
        const messages: BenchTurn[] = []
        let t = 0
        for (const convo of item.conversations ?? []) {
          for (const m of convo.messages ?? []) {
            messages.push({
              turnId: `${convo.id ?? 'c'}:${t++}`,
              role: m.speaker === 'User' ? 'user' : 'assistant',
              speaker: m.speaker,
              text: m.text,
            })
          }
        }
        const bulkMessages = fillers.slice(0, fillerPerCase).flatMap((convo, ci) => [
          {
            turnId: `filler-${ci}`,
            role: 'speaker' as const,
            speaker: 'Filler',
            text: `Conversation transcript:\n${convo.messages.map((m) => `${m.speaker}: ${m.text}`).join('\n')}`,
          },
        ])
        cases.push({
          caseId: `convomem-${dir}-${path.basename(file, '.json').slice(0, 8)}-${idx}`,
          messages,
          bulkMessages,
          questions: [{
            questionId: `convomem-${dir}-${path.basename(file, '.json').slice(0, 8)}-q${idx}`,
            question: item.question,
            goldAnswer: String(item.answer),
            category: CATEGORY_LABEL[dir]!,
            expectsAbstention: dir === 'abstention_evidence',
          }],
        })
      }
    }
  }
  return { name: 'convomem', cases }
}

function loadFillers(root: string): ConvomemConversation[] {
  const dir = path.join(root, 'filler')
  if (!existsSync(dir)) return []
  const out: ConvomemConversation[] = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      const raw = JSON.parse(readFileSync(path.join(dir, file), 'utf8'))
      // Filler files share the evidence_items shape: each item carries its own
      // conversations list. Take a couple per file as haystack noise.
      const items: ConvomemEvidenceItem[] = Array.isArray(raw) ? raw : raw?.evidence_items ?? []
      for (const item of items.slice(0, 3)) {
        for (const convo of item.conversations ?? []) {
          if (convo?.messages) out.push(convo)
        }
      }
    } catch {
      // skip malformed filler
    }
  }
  return out
}
