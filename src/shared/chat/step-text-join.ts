/**
 * Joining the public text of consecutive model calls.
 *
 * Separate model calls normally read as separate paragraphs, so their text is
 * joined with a blank line. A call that stopped because it reached its output-token
 * cap is different: the harness continues the same response in the next call, which
 * can start mid-line ("...\n23" then ". The Tagus..."). A blank line there splits the
 * sentence and breaks Markdown lists, so continued text is joined as written.
 */

export const STEP_TEXT_SEPARATOR = '\n\n'

type Part = Record<string, unknown>

/** A saved model step. `outputLimitReached` marks a call cut off by its output-token cap. */
export type JoinableStepTranscript = {
  content: string
  parts: readonly Part[]
  outputLimitReached?: boolean
}

export function joinStepText(previous: string, next: string, continuesPrevious: boolean): string {
  if (!previous) return next
  if (!next) return previous
  return `${previous}${continuesPrevious ? '' : STEP_TEXT_SEPARATOR}${next}`
}

function isTextPart(part: Part | undefined): part is Part & { text: string } {
  return part?.type === 'text' && typeof part.text === 'string'
}

/**
 * Appends one step's parts. When the step continues cut-off text, its first text
 * part extends the previous text part, so the UI renders one Markdown block.
 */
export function appendStepParts(parts: readonly Part[], next: readonly Part[], continuesPrevious: boolean): Part[] {
  const last = parts.at(-1)
  const first = next[0]
  if (!continuesPrevious || !isTextPart(last) || !isTextPart(first)) return [...parts, ...next]
  return [...parts.slice(0, -1), { ...last, text: `${last.text}${first.text}` }, ...next.slice(1)]
}

function hasPublicOutput(step: JoinableStepTranscript): boolean {
  return Boolean(step.content) || step.parts.length > 0
}

/** Whether text written after these steps continues the last step's cut-off output. */
export function stepsEndMidOutput(steps: readonly JoinableStepTranscript[]): boolean {
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index]!
    if (hasPublicOutput(step)) return step.outputLimitReached === true
  }
  return false
}

export function joinStepTranscripts(steps: readonly JoinableStepTranscript[]): {
  content: string
  parts: Part[]
  outputLimitReached: boolean
} {
  let content = ''
  let parts: Part[] = []
  let continues = false
  for (const step of steps) {
    if (!hasPublicOutput(step)) continue
    content = joinStepText(content, step.content, continues)
    parts = appendStepParts(parts, step.parts, continues)
    continues = step.outputLimitReached === true
  }
  return { content, parts, outputLimitReached: continues }
}

/**
 * Sanitizers trim step text. A cut-off step keeps its trailing whitespace, because
 * the call may have stopped right after a newline that the continuation relies on.
 */
export function keepCutOffTrailingWhitespace(raw: string, sanitized: string): string {
  if (!sanitized) return sanitized
  const trailing = /\s*$/.exec(raw)?.[0] ?? ''
  return trailing && !sanitized.endsWith(trailing) ? `${sanitized.trimEnd()}${trailing}` : sanitized
}
