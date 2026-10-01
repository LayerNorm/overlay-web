import { createReadStream, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { config } from '../config'
import type { BenchTurn } from '../extractor'
import type { BenchCase, BenchDataset } from './types'

/**
 * LongMemEval-V2 (xiaowu0162/longmemeval-v2): 451 questions over web-agent
 * trajectories (up to ~115M tokens each — huge). Trajectories join to
 * questions by `id`.
 *
 * Faithful per-state ingestion is impractical (100-200 states × 10KB a11y
 * trees), so each trajectory is compacted into step-blocks
 * (LME_STEPS_PER_BLOCK states → one text block) and ingested as bulk
 * transcript memories — this is the RAG-style baseline interpretation.
 * Questions with `image != 'None'` are skipped (text-only run).
 * `*-abs` question types expect abstention.
 */

type LmeQuestion = {
  id: string
  domain: string
  environment: string
  question_type: string
  question: string
  image: string
  answer: string
  eval_function: string
}
type LmeState = { step?: number; url?: string; action?: unknown; thought?: string; accessibility_tree?: string }
type LmeTrajectory = { id: string; goal?: string; outcome?: string; states?: LmeState[] }

const A11Y_CHAR_CAP = 800

export async function loadLongMemEval(opts?: {
  limitCases?: number
  maxTrajectoryChars?: number
  stepsPerBlock?: number
}): Promise<BenchDataset> {
  const limit = opts?.limitCases ?? 25
  const maxTrajChars = opts?.maxTrajectoryChars ?? 2_000_000
  const stepsPerBlock = opts?.stepsPerBlock ?? 20
  const root = path.join(config.datasetsDir, 'longmemeval-v2')
  const qFile = path.join(root, 'questions.jsonl')
  const tFile = path.join(root, 'trajectories.jsonl')
  if (!existsSync(qFile) || !existsSync(tFile)) {
    throw new Error('longmemeval-v2 dataset missing — run: npx tsx benchmarks/memory/src/download.ts longmemeval')
  }

  const questions = (await readJsonl(qFile)) as LmeQuestion[]
  const wanted = new Map<string, LmeQuestion>()
  for (const q of questions) {
    if (wanted.size >= limit) break
    if (q.image && q.image !== 'None') continue
    wanted.set(q.id, q)
  }

  // Stream the 1.2GB trajectories file; keep only wanted ids, in-file order.
  const trajectories = new Map<string, LmeTrajectory>()
  const rl = createInterface({ input: createReadStream(tFile), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    let t: LmeTrajectory
    try {
      t = JSON.parse(line) as LmeTrajectory
    } catch {
      continue // torn tail from partial download
    }
    if (wanted.has(t.id)) {
      trajectories.set(t.id, t)
      if (trajectories.size >= wanted.size) break
    }
  }
  rl.close()

  const cases: BenchCase[] = []
  for (const [id, q] of wanted) {
    const traj = trajectories.get(id)
    if (!traj) continue
    const bulkMessages = trajectoryToBlocks(traj, stepsPerBlock, maxTrajChars)
    const truncated = (traj.states?.length ?? 0) > 0 && bulkMessages.length > 0 &&
      bulkMessages[bulkMessages.length - 1]!.text.endsWith('[truncated]')
    cases.push({
      caseId: `lme-${id}`,
      messages: [],
      bulkMessages,
      truncated,
      questions: [{
        questionId: `lme-${id}`,
        question: `${q.question}\n\n(Original goal: ${traj.goal ?? 'n/a'})`,
        goldAnswer: String(q.answer),
        category: q.question_type,
        expectsAbstention: q.question_type.endsWith('-abs'),
        evalFunction: q.eval_function,
      }],
    })
  }
  return { name: 'longmemeval-v2', cases }
}

function trajectoryToBlocks(traj: LmeTrajectory, stepsPerBlock: number, maxChars: number): BenchTurn[] {
  const states = traj.states ?? []
  const out: BenchTurn[] = []
  let used = 0
  for (let i = 0; i < states.length; i += stepsPerBlock) {
    const block = states.slice(i, i + stepsPerBlock)
    const lines = block.map((s) => {
      const tree = (s.accessibility_tree ?? '').slice(0, A11Y_CHAR_CAP)
      return `[step ${s.step ?? ''}] url=${s.url ?? ''}\nthought: ${s.thought ?? ''}\naction: ${JSON.stringify(s.action ?? null)}\npage: ${tree}`
    })
    let text = `Trajectory block (steps ${i}–${i + block.length - 1}) for goal "${(traj.goal ?? '').slice(0, 200)}":\n${lines.join('\n---\n')}`
    if (used + text.length > maxChars) {
      text = `${text.slice(0, Math.max(0, maxChars - used))}\n[truncated]`
      out.push({ turnId: `block-${i}`, role: 'speaker', speaker: 'AgentTrajectory', text })
      break
    }
    used += text.length
    out.push({ turnId: `block-${i}`, role: 'speaker', speaker: 'AgentTrajectory', text })
  }
  return out
}

async function readJsonl(file: string): Promise<unknown[]> {
  const out: unknown[] = []
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  for await (const line of rl) {
    if (line.trim()) out.push(JSON.parse(line))
  }
  rl.close()
  return out
}
