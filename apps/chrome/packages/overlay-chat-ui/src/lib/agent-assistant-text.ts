/**
 * Models often concatenate segments without a space after a period ("setup.Perfect!").
 * Insert a space when a lowercase letter is followed by `.` and an uppercase letter.
 */
export function normalizeAgentAssistantText(s: string): string {
  if (!s.trim()) return s
  return s.replace(/([a-z])\.([A-Z])/g, '$1. $2')
}

/**
 * Some models stream markdown like "- Thinking..." which renders as a bullet + label.
 * Strip those filler lines from the start of assistant markdown only.
 */
export function stripThinkingPlaceholderMarkdown(text: string): string {
  let t = text
  // Whole-line filler only (avoids touching "Thinking about …" mid-sentence).
  const linePattern = /^(\s*[-*•]\s*)?Thinking(?:\.{1,3}|…)?\s*(\r?\n|$)/i
  while (linePattern.test(t)) {
    t = t.replace(linePattern, '')
  }
  return t
}
