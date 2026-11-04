/**
 * Questions an agent asks the person during a run. They travel as JSON inside
 * the run's existing `question` string, so every stored wait and message part
 * carries them unchanged. A plain string is a single free-text question.
 */
export type RunQuestionChoice = {
  label: string
  description?: string
}

export type RunQuestion = {
  prompt: string
  description?: string
  choices?: RunQuestionChoice[]
  multiple?: boolean
  allowCustomAnswer?: boolean
  optional?: boolean
}

const PLACEHOLDER_PROMPT = /^(?:placeholder|question|todo|tbd|n\/?a|none|test|\?+|\.+)$/i
const MIN_PROMPT_LENGTH = 8

export function encodeRunQuestions(questions: readonly RunQuestion[]): string {
  return JSON.stringify({ overlayRunQuestions: 1, questions })
}

function readChoice(value: unknown): RunQuestionChoice | null {
  if (!value || typeof value !== 'object') return null
  const { label, description } = value as Record<string, unknown>
  if (typeof label !== 'string' || !label.trim()) return null
  return { label, ...(typeof description === 'string' && description ? { description } : {}) }
}

function readQuestion(value: unknown): RunQuestion | null {
  if (!value || typeof value !== 'object') return null
  const { prompt, description, choices, multiple, allowCustomAnswer, optional } = value as Record<string, unknown>
  if (typeof prompt !== 'string' || !prompt.trim()) return null
  const readChoices = Array.isArray(choices) ? choices.map(readChoice).filter(choice => choice !== null) : []
  return {
    prompt,
    ...(typeof description === 'string' && description ? { description } : {}),
    ...(readChoices.length ? { choices: readChoices } : {}),
    ...(multiple === true ? { multiple } : {}),
    ...(allowCustomAnswer === true ? { allowCustomAnswer } : {}),
    ...(optional === true ? { optional } : {}),
  }
}

export function decodeRunQuestions(question: string): RunQuestion[] {
  try {
    const parsed = JSON.parse(question) as { overlayRunQuestions?: unknown; questions?: unknown }
    if (parsed?.overlayRunQuestions === 1 && Array.isArray(parsed.questions)) {
      const questions = parsed.questions.map(readQuestion).filter(item => item !== null)
      if (questions.length) return questions
    }
  } catch {
    // Not encoded, so it's a plain question.
  }
  return [{ prompt: question }]
}

/** Why these questions can't be shown to a person, or null when they can. */
export function runQuestionIssue(questions: readonly RunQuestion[]): string | null {
  for (const { prompt } of questions) {
    const text = prompt.trim()
    if (text.length < MIN_PROMPT_LENGTH || PLACEHOLDER_PROMPT.test(text)) {
      return `"${text}" is not a real question. Ask the person something specific they can answer, or continue without asking.`
    }
  }
  return null
}

/** One question replies with just the answer; several pair each with its question. */
export function formatRunAnswers(questions: readonly RunQuestion[], answers: ReadonlyArray<readonly string[] | undefined>): string {
  if (questions.length === 1) return (answers[0] ?? []).join(', ')
  return questions.map((question, index) => `${question.prompt}\n${answers[index]?.join(', ') || '(skipped)'}`).join('\n\n')
}
