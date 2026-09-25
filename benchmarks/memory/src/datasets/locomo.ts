import { readFileSync } from 'node:fs'
import path from 'node:path'
import { config } from '../config'
import type { BenchTurn } from '../extractor'
import type { BenchCase, BenchDataset, BenchQuestion } from './types'

/**
 * LoCoMo (snap-research/locomo, ACL 2024): 10 conversations, ~26 sessions,
 * ~600 turns each; 1986 QA pairs with categories:
 *   1 single-hop · 2 temporal · 3 multi-hop · 4 open-domain · 5 adversarial
 */

const LOCOMO_CATEGORY: Record<string, string> = {
  '1': 'single-hop',
  '2': 'temporal',
  '3': 'multi-hop',
  '4': 'open-domain',
  '5': 'adversarial',
}

type LocomoTurn = { speaker: string; dia_id: string; text: string; img?: string; blip_caption?: string }
type LocomoConversation = {
  speaker_a: string
  speaker_b: string
  [key: `session_${number}`]: LocomoTurn[] | undefined
  [key: `session_${number}_date_time`]: string | undefined
}
type LocomoSample = {
  sample_id: string
  conversation: LocomoConversation
  qa: Array<{ question: string; answer: string | number; category: number; evidence: string | string[] }>
}

export function loadLocomo(limitCases?: number): BenchDataset {
  const file = path.join(config.datasetsDir, 'locomo10.json')
  const samples = JSON.parse(readFileSync(file, 'utf8')) as LocomoSample[]

  const cases: BenchCase[] = samples.slice(0, limitCases).map((sample) => {
    const conv = sample.conversation
    const messages: BenchTurn[] = []

    const sessionNums = Object.keys(conv)
      .filter((k) => /^session_\d+$/.test(k) && Array.isArray(conv[k as `session_${number}`]))
      .map((k) => Number(k.split('_')[1]))
      .sort((a, b) => a - b)

    let lastDate: string | undefined
    for (const n of sessionNums) {
      const dateTime = conv[`session_${n}_date_time` as `session_${number}_date_time`]
      const isoDate = parseLocomoDate(dateTime)
      if (isoDate) lastDate = isoDate
      for (const turn of conv[`session_${n}` as `session_${number}`] ?? []) {
        const imgNote = turn.img ? ` [shared an image${turn.blip_caption ? `: ${turn.blip_caption}` : ''}]` : ''
        messages.push({
          turnId: turn.dia_id,
          role: 'speaker',
          speaker: turn.speaker,
          text: `${turn.text}${imgNote}`,
          timestamp: isoDate,
        })
      }
    }

    const questions: BenchQuestion[] = sample.qa.map((q, i) => ({
      questionId: `${sample.sample_id}:q${i}`,
      question: q.question,
      goldAnswer: String(q.answer),
      category: LOCOMO_CATEGORY[String(q.category)] ?? `cat${q.category}`,
      expectsAbstention: q.category === 5,
      questionDate: lastDate,
      evidenceTurnIds: parseEvidence(q.evidence),
    }))

    return { caseId: `locomo-${sample.sample_id}`, messages, questions }
  })

  return { name: 'locomo', cases }
}

/** "1:56 pm on 8 May, 2023" → "2023-05-08" */
function parseLocomoDate(dateTime?: string): string | undefined {
  if (!dateTime) return undefined
  const m = dateTime.match(/on\s+(\d{1,2})\s+(\w+),?\s+(\d{4})/i)
  if (!m) return undefined
  const d = new Date(`${m[2]} ${m[1]}, ${m[3]}`)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10)
}

function parseEvidence(evidence: string | string[]): string[] {
  if (Array.isArray(evidence)) return evidence
  const trimmed = evidence.trim()
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed.replace(/'/g, '"')) as string[]
    } catch {
      return []
    }
  }
  return trimmed ? [trimmed] : []
}
