/**
 * System-prompt text for models: the chat UI uses remark-math + KaTeX. Three
 * hard rules, no exceptions — the renderer repairs currency and stray fences,
 * but only well-formed delimiters render reliably.
 */
export const MATH_FORMAT_INSTRUCTION = [
  'Mathematical notation — three hard rules, no exceptions:',
  '1. Inline math lives inside a sentence: $x^2 + y^2 = r^2$.',
  '2. Display math is always three parts: a line containing only $$, then the equation lines, then a line containing only $$. Never put $$ at the end of an equation line.',
  '3. Never emit a $ character inside an equation or anywhere outside these two forms.',
].join('\n')
