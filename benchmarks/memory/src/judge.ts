import { config } from './config'
import { benchText, withRetry } from './gateway'

export type Verdict = 'correct' | 'incorrect' | 'abstained' | 'error'

export type JudgeInput = {
  question: string
  goldAnswer: string
  modelAnswer: string
  /**
   * True for categories where the correct behavior is to decline (LoCoMo
   * adversarial, unanswerable items). Abstention then counts as correct.
   */
  expectsAbstention?: boolean
  category?: string
}

/**
 * One judge prompt family for all three benchmarks — each repo's official
 * judge is a correctness rubric of this shape; we keep a single constant so
 * pre/post runs are identical. Abstention detection is substring + judge.
 */
export async function judgeAnswer(input: JudgeInput): Promise<{ verdict: Verdict; raw: string }> {
  const abstained = looksLikeAbstention(input.modelAnswer)

  if (input.expectsAbstention) {
    // For adversarial/unanswerable items the gold is some form of "not shared".
    // A clean abstention is correct without needing the judge.
    if (abstained) return { verdict: 'correct', raw: 'auto:abstention-accepted' }
  }

  const system = [
    'You are a strict grading assistant. Grade whether the MODEL ANSWER correctly answers the QUESTION given the GOLD ANSWER.',
    'Credit equivalent phrasing, synonyms, and partial dates when the fact is right.',
    'If the model abstains but the question is answerable from the gold answer, grade INCORRECT.',
    input.expectsAbstention
      ? 'This question is intentionally unanswerable/adversarial: the model should decline rather than fabricate. Grade CORRECT only if it declines or clearly states the information was not shared.'
      : '',
    'Reply with exactly one word: CORRECT or INCORRECT.',
  ]
    .filter(Boolean)
    .join(' ')

  const prompt = [
    `QUESTION: ${input.question}`,
    `GOLD ANSWER: ${input.goldAnswer}`,
    `MODEL ANSWER: ${input.modelAnswer}`,
  ].join('\n')

  try {
    const raw = await withRetry(
      () => benchText(config.judgeModel, prompt, system),
      `judge:${input.question.slice(0, 40)}`,
    )
    const verdict: Verdict = /\bCORRECT\b/i.test(raw)
      ? 'correct'
      : /\bINCORRECT\b/i.test(raw)
        ? abstained && input.expectsAbstention
          ? 'correct'
          : 'incorrect'
        : abstained
          ? 'abstained'
          : 'incorrect'
    return { verdict, raw: raw.slice(0, 200) }
  } catch (err) {
    return { verdict: 'error', raw: err instanceof Error ? err.message : 'judge failed' }
  }
}

const ABSTENTION_PATTERNS = [
  /i don'?t have that information/i,
  /i don'?t know/i,
  /not (?:enough |sufficient )?information/i,
  /(?:no|not) (?:information|mention|record|evidence)/i,
  /wasn'?t (?:mentioned|shared|discussed)/i,
  /was not (?:mentioned|shared|discussed)/i,
  /cannot (?:determine|answer)/i,
]

export function looksLikeAbstention(text: string): boolean {
  return ABSTENTION_PATTERNS.some((p) => p.test(text))
}

/**
 * LongMemEval-V2 ships declarative eval functions instead of a judge prompt.
 * Dispatch on `eval_function` — deterministic matchers for ~70% of questions,
 * the free model for llm_* checkers. Mirrors the official semantics closely
 * enough for a pre/post baseline; document as "official-comparable, ling-judge".
 */
export async function judgeLongMemEval(input: {
  question: string
  goldAnswer: string
  modelAnswer: string
  evalFunction: string
}): Promise<{ verdict: Verdict; raw: string }> {
  const [fn = '', ...paramPairs] = input.evalFunction.split('|')
  const params = Object.fromEntries(
    paramPairs.map((p) => p.split('=') as [string, string]),
  )

  switch (fn) {
    case 'norm_phrase_set_match':
      return phraseSetMatch(input.goldAnswer, input.modelAnswer, params, false)
    case 'norm_phrase_set_match_ordered':
      return phraseSetMatch(input.goldAnswer, input.modelAnswer, params, true)
    case 'mc_choice_match':
      return mcChoiceMatch(input.goldAnswer, input.modelAnswer)
    case 'mc_choice_set_match':
      return mcChoiceSetMatch(input.goldAnswer, input.modelAnswer)
    case 'llm_abstention_checker':
      return llmChecker(input, 'abstention')
    case 'llm_gotchas_checker':
      return llmChecker(input, 'gotchas')
    default:
      return judgeAnswer({ ...input })
  }
}

function norm(text: string, params: Record<string, string>): string {
  let t = text
  if (params.lower === 'true') t = t.toLowerCase()
  if (params.normalize_hyphen === 'true') t = t.replace(/-/g, ' ')
  if (params.strip_punct === 'true') t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ')
  return t.replace(/\s+/g, ' ').trim()
}

function phraseSetMatch(
  gold: string,
  model: string,
  params: Record<string, string>,
  ordered: boolean,
): { verdict: Verdict; raw: string } {
  const separators = (params.separators ?? ',;').split('')
  const sepRe = new RegExp(`[${separators.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')}]`)
  const phrases = gold.split(sepRe).map((p) => norm(p, params)).filter(Boolean)
  const modelNorm = ` ${norm(model, params)} `
  if (params.require_non_empty === 'true' && !modelNorm.trim()) {
    return { verdict: 'incorrect', raw: 'empty answer' }
  }
  if (ordered) {
    let pos = 0
    for (const p of phrases) {
      const idx = modelNorm.indexOf(` ${p} `, pos)
      const fallback = modelNorm.indexOf(p, pos)
      const hit = idx !== -1 ? idx : fallback
      if (hit === -1) return { verdict: 'incorrect', raw: `missing/out-of-order phrase: ${p}` }
      pos = hit + p.length
    }
    return { verdict: 'correct', raw: 'ordered match' }
  }
  const missing = phrases.filter((p) => !modelNorm.includes(p))
  return missing.length === 0
    ? { verdict: 'correct', raw: 'all phrases matched' }
    : { verdict: 'incorrect', raw: `missing: ${missing.join(' | ')}` }
}

function mcChoiceMatch(gold: string, model: string): { verdict: Verdict; raw: string } {
  const goldLetter = gold.trim().match(/\(?([A-J])\)?/)?.[1]
  const modelLetter = model.match(/\(?([A-J])\)?[.):]?/)?.[1] ?? model.trim().match(/^([A-J])\b/)?.[1]
  return {
    verdict: goldLetter && modelLetter === goldLetter ? 'correct' : 'incorrect',
    raw: `gold=${goldLetter} model=${modelLetter ?? 'none'}`,
  }
}

function mcChoiceSetMatch(gold: string, model: string): { verdict: Verdict; raw: string } {
  const goldSet = new Set(gold.match(/[A-J]/g) ?? [])
  const modelSet = new Set(model.match(/[A-J]/g) ?? [])
  const missing = [...goldSet].filter((g) => !modelSet.has(g))
  return { verdict: missing.length === 0 ? 'correct' : 'incorrect', raw: `missing choices: ${missing.join(',')}` }
}

async function llmChecker(
  input: { question: string; goldAnswer: string; modelAnswer: string },
  kind: 'abstention' | 'gotchas',
): Promise<{ verdict: Verdict; raw: string }> {
  const system =
    kind === 'abstention'
      ? 'The question cannot be answered from the available history. Grade CORRECT if the model appropriately declines/acknowledges missing information; INCORRECT if it fabricates an answer. One word: CORRECT or INCORRECT.'
      : 'Grade whether the model correctly identified the error, gotcha, or caveat the question is probing. One word: CORRECT or INCORRECT.'
  try {
    const raw = await withRetry(
      () =>
        benchText(
          config.judgeModel,
          `QUESTION: ${input.question}\nGOLD: ${input.goldAnswer}\nMODEL ANSWER: ${input.modelAnswer}`,
          system,
        ),
      'judge:lme',
    )
    return { verdict: /\bCORRECT\b/i.test(raw) ? 'correct' : 'incorrect', raw: raw.slice(0, 200) }
  } catch (err) {
    return { verdict: 'error', raw: err instanceof Error ? err.message : 'judge failed' }
  }
}
