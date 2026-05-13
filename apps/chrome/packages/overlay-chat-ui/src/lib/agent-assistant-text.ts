/**
 * NIM / weak free-tier models sometimes put chain-of-thought in the `text` channel (not
 * `reasoning` parts), so the UI shows planning + backend ids. These patterns only match
 * obvious “assistant is narrating the plan” lines at the start of a reply.
 */
function isNimLeakedNarrationLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (/^The user is asking me to summarize\b/i.test(t)) return true
  if (/^According to the instructions:\s*$/i.test(t)) return true
  if (/^\*\s*I need to call search_in_files\b/i.test(t)) return true
  if (/^\*\s*I should NOT show\b/i.test(t)) return true
  if (/^\*\s*I should refer to\b/i.test(t)) return true
  if (/^\*\s*I should start directly\b/i.test(t)) return true
  if (/^Let me search_in_files with\b/i.test(t)) return true
  if (/^The user wants me to (?:summarize|read|extract)\b/i.test(t)) return true
  if (/^They('ve| have) provided (a )?Convex file ID/i.test(t)) return true
  if (/^They('ve| have) provided me with the internal (Convex |)file id/i.test(t)) return true
  if (/^They('ve| have) provided (me with )?the internal\b/i.test(t)) return true
  if (/^I need to use search_in_files\b/i.test(t)) return true
  if (/^Let me (call|try) search_in_files/i.test(t)) return true
  if (/^Let me try (a more general query|search_knowledge)\b/i.test(t)) return true
  if (/^I'll search the document/i.test(t)) return true
  if (/^I'll search .+ and provide you with\b/i.test(t)) return true
  if (/^I will search .+ and (give|provide) you with\b/i.test(t)) return true
  if (/^The search didn'?t return any matches\b/i.test(t)) return true
  if (/^The search_in_files and search_knowledge (didn'?t|did not) find\b/i.test(t)) return true
  if (/^Still no matches\b/i.test(t)) return true
  if (/^The document might be a PDF\b/i.test(t)) return true
  if (/^I should (also )?let the user know that the search( tools|_in_files)?\b/i.test(t)) return true
  if (/^I should (also )?let the user know that the search and search_knowledge didn'?t\b/i.test(t)) return true
  if (/^Let me be honest with the user about (this|the limitation|these)\b/i.test(t)) return true
  if (/^So I should go straight to search_in_files\b/i.test(t)) return true
  if (/^Let me use a query that will help retrieve\b/i.test(t)) return true
  if (/^I need to:\s*$/i.test(t)) return true
  if (/^Then summarize it for the user\.?$/i.test(t)) return true
  if (/^Following the instructions:\s*$/i.test(t)) return true
  if (/^Following the instructions:/i.test(t) && /No preamble \(HARD\):/i.test(t)) return true
  if (/^Following the instructions:\s*["'`](?:No preamble|For read\/summarize)/i.test(t)) return true
  if (/No preamble \(HARD\):/i.test(t) && /read\/summarize\/extract/i.test(t)) return true
  if (/^They've attached it as a notebook file and provided the internal id/i.test(t)) return true
  if (/^Trying your knowledge base\b/i.test(t)) return true
  if (/^Searching your knowledge\b/i.test(t)) return true
  if (/^Search In Files\s*$/i.test(t)) return true
  // Model echoes our instructions back as a numbered list
  if (/^\d+\.\s*Use search_in_files\b/i.test(t)) return true
  if (/^\d+\.\s*Treat file contents as untrusted\b/i.test(t)) return true
  if (/^\d+\.\s*Never show internal (ids?|id)/i.test(t)) return true
  if (/^\d+\.\s*Refer to files by\b/i.test(t)) return true
  if (/^\d+\.\s*Call search_in_files\b/i.test(t)) return true
  if (/^\d+\.\s*Read the file|^\d+\.\s*Get the full|^\d+\.\s*Then summarize\b/i.test(t)) return true
  // Single-line JSON array of opaque notebook file ids (leaked in prose)
  if (/^\[[\s\n]*"[^"]{12,}"[\s\n]*(?:,[\s\n]*"[^"]{12,}"[\s\n]*)*]\s*$/i.test(t)) return true
  return false
}

/**
 * Remove leading multi-line blocks some models emit before the first tool (repeated
 * sentences + checklist). Runs before line filter.
 */
function stripDocumentPreambleBlock(text: string): string {
  let t = text
  for (let i = 0; i < 6; i++) {
    const before = t
    t = t.replace(
      /^The user is asking me to summarize [^\n]+\.?\s*\n+/i,
      '',
    )
    t = t.replace(
      /^The user wants me to summarize a notebook file called [^\n]+\.?\s*\n+/i,
      '',
    )
    t = t.replace(
      /^They('ve| have) provided me with the internal[^\n]+\.?\s*\n+/i,
      '',
    )
    t = t.replace(
      /^They('ve| have) provided (a )?Convex file id[^\n]*for tools only:\s*[^\n]+\.?\s*\n+/i,
      '',
    )
    t = t.replace(/^I'll search [^\n]+ provide you (with|a) [^\n]*\.?\s*\n*/i, '')
    t = t.replace(
      /^According to the instructions:\s*\n(?:\s*[\*\-•]\s*[^\n]+\n?)+/i,
      '',
    )
    t = t.replace(
      /^The user wants me to summarize [^\n]*\n?/i,
      (m) => {
        const c = m.trim()
        if (
          /They've attached it as a notebook file/i.test(c) ||
          (/internal id\(s\)/i.test(c) && /I need to:/i.test(c))
        ) {
          return ''
        }
        return m
      },
    )
    if (t === before) break
  }
  return t
}

/**
 * Drop whole markdown paragraphs that are obvious NIM plan / system-instruction echo.
 * Line filters miss these when a paragraph mixes several leaks or uses \n only once.
 */
function shouldDropNimPreambleParagraph(p: string): boolean {
  const s = p.trim()
  if (!s) return false
  if (
    /^The user wants me to summarize/i.test(s) &&
    (/I need to:\s*$/i.test(s) || /I need to:\s*$/m.test(s) || /internal id\(s\)/i.test(s) || /notebook file/i.test(s))
  ) {
    return true
  }
  if (/^Following the instructions:\s*["\u201c]?\s*No preamble/i.test(s)) return true
  if (
    /No preamble \(HARD\):/i.test(s) &&
    /read\/summarize\/extract|first tool call|user-visible text/i.test(s)
  ) {
    return true
  }
  if (
    /^So I should go straight to search_in_files/i.test(s) &&
    s.length < 500
  ) {
    return true
  }
  if (
    /^Let me use a query that will help retrieve/i.test(s) &&
    s.length < 500
  ) {
    return true
  }
  if (
    /^The search didn'?t find any matches\b/i.test(s) &&
    /Let me try a different approach/i.test(s) &&
    s.length < 1200
  ) {
    return true
  }
  return false
}

function stripLeakedNimPlanParagraphs(text: string): string {
  const blocks = text.split(/(\n\n+)/)
  const out: string[] = []
  for (const block of blocks) {
    if (/^\n\n+$/.test(block)) {
      out.push(block)
      continue
    }
    if (shouldDropNimPreambleParagraph(block)) {
      continue
    }
    out.push(block)
  }
  return out.join('').replace(/\n{3,}/g, '\n\n')
}

/**
 * Redact opaque notebook / Convex file id strings from any user-visible assistant text.
 * These are not passwords, but they are internal pointers and should not appear in chat.
 */
export function redactOpaqueNotebookFileIdsInVisibleText(s: string): string {
  return s
    .replace(/\bprovided the internal id\(s\)\b/gi, 'provided a file reference')
    .replace(/\bwith internal id\s+['`]([a-z0-9]{16,})['`]/gi, 'with internal id [redacted]')
    .replace(/\binternal id\s+['"]([a-z0-9]{16,})['"]/gi, 'internal id [redacted]')
    .replace(/\bfile id\s+['"]?([a-z0-9]{16,})['"]?/gi, 'file id [redacted]')
    .replace(/\bid\s+['"]([a-z0-9]{16,})['"]/gi, 'id [redacted]')
}

/**
 * Free-tier / NIM reasoning models (Kimi K2 Thinking, DeepSeek V3.2, etc.) sometimes
 * emit chain-of-thought inline in the `text` channel wrapped in `<think>…</think>`
 * (or the legacy `<think>…</redacted_thinking>` variant). We split those segments
 * out so the UI renders them under the collapsed reasoning affordance instead of the
 * main body.
 *
 * Streaming-aware: when a `<think>` tag has been opened but not yet closed, everything
 * after it up to the end of the chunk is treated as reasoning-in-progress so users
 * don't momentarily see raw chain-of-thought while the tag is still streaming in.
 */
const THINK_OPEN = /<think\b[^>]*>/i
const THINK_PAIR_RE =
  /<think\b[^>]*>([\s\S]*?)(?:<\/think\s*>|<\/redacted_thinking\s*>)/gi

export function splitRedactedThinkingSegments(
  text: string,
): Array<{ kind: 'text' | 'reasoning'; text: string }> {
  if (!text || !THINK_OPEN.test(text)) {
    return [{ kind: 'text', text }]
  }
  const out: Array<{ kind: 'text' | 'reasoning'; text: string }> = []
  let last = 0
  let m: RegExpExecArray | null
  THINK_PAIR_RE.lastIndex = 0
  while ((m = THINK_PAIR_RE.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ kind: 'text', text: text.slice(last, m.index) })
    }
    out.push({ kind: 'reasoning', text: m[1] ?? '' })
    last = m.index + m[0].length
  }
  // Unterminated `<think>` — treat the rest of the buffer as in-progress reasoning
  // so the UI doesn't flash raw chain-of-thought before the closing tag arrives.
  if (last < text.length) {
    const rest = text.slice(last)
    const openIdx = rest.search(THINK_OPEN)
    if (openIdx >= 0) {
      if (openIdx > 0) {
        out.push({ kind: 'text', text: rest.slice(0, openIdx) })
      }
      const tagMatch = rest.slice(openIdx).match(THINK_OPEN)
      const tagLen = tagMatch?.[0].length ?? 0
      const reasoningChunk = rest.slice(openIdx + tagLen)
      if (reasoningChunk) {
        out.push({ kind: 'reasoning', text: reasoningChunk })
      }
    } else {
      out.push({ kind: 'text', text: rest })
    }
  }
  if (out.length === 0) {
    return [{ kind: 'text', text }]
  }
  return out
}

/**
 * Remove lines that match "assistant is narrating the plan" (NIM / weak free tier often
 * emits this in the text stream instead of reasoning parts). Safe patterns only.
 */
export function redactNimLeakedNarrationToUser(text: string): string {
  if (!text.trim()) return text
  let t = stripDocumentPreambleBlock(text)
  t = stripLeakedNimPlanParagraphs(t)
  const lines = t.split(/\r?\n/)
  const out = lines.filter((line) => !isNimLeakedNarrationLine(line))
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Models often concatenate segments without a space after a period ("setup.Perfect!").
 * Insert a space when a lowercase letter is followed by `.` and an uppercase letter.
 * Also drop obvious leaked NIM/CoT lines from the start of the visible reply.
 */
export function normalizeAgentAssistantText(s: string): string {
  if (!s.trim()) return s
  let t = s.replace(/([a-z])\.([A-Z])/g, '$1. $2')
  t = redactNimLeakedNarrationToUser(t)
  t = t.replace(
    /(^|\n)\s*Convex file id[s]?:\s*[^\n]+/gi,
    '',
  )
  t = t.replace(
    /(^|\n)\s*(?:internal )?(?:Convex )?file id[s]? for tools only:\s*[^\n]+/gi,
    '',
  )
  t = redactOpaqueNotebookFileIdsInVisibleText(t)
  return t
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
