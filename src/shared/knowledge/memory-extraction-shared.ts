import { z } from 'zod'

/**
 * Shared memory-extraction contract used by both the Convex extractor action
 * (`convex/knowledge/memoryExtractorNode.ts`) and the benchmark harness
 * (`benchmarks/memory/`). Keep this file isomorphic: no node builtins, no env,
 * no server-only imports.
 */

export const MIN_EXTRACTION_CONFIDENCE = 0.4
export const MAX_CANDIDATES_PER_MESSAGE = 8

/**
 * Semantic-dedup thresholds for the write path (extractFromTurn + tool saves).
 * A candidate whose nearest memory scores >= AUTO_NOOP is treated as a repeat
 * and only bumps freshness; scores in [MIN, AUTO_NOOP) get an LLM decision.
 */
export const DEDUP_MIN_VEC_SCORE = 0.88
export const DEDUP_AUTO_NOOP_VEC_SCORE = 0.95

export const HUMAN_MEMORY_EXTRACTION_SYSTEM_PROMPT = `You are a careful memory extraction assistant. Read the user's message and extract durable personal facts, preferences, goals, identity details, constraints, habits, or standing instructions that would be useful in future conversations.

Return a JSON object with this exact shape:
{
  "candidates": [
    {
      "content": "One short factual sentence about the user.",
      "type": "preference|fact|project|decision|agent",
      "confidence": 0.0 to 1.0,
      "rationale": "One sentence explaining why this is memorable.",
      "eventAt": "YYYY-MM-DD — when the fact/event happened or happens. Omit if not time-bound.",
      "expiresOn": "YYYY-MM-DD — the fact stops being true after this date. Omit if durable."
    }
  ]
}

Rules:
- Default to extracting. Only skip if the message is pure small talk ("how are you", "thanks") with zero personal content, a one-off task request with no personal detail, or ONLY code / API data with nothing about the user.
- Extract: food/style preferences, job/role, timezone/locale, "always do X", "never do Y", durable constraints, goals, ambitions, frustrations, relationships, learning preferences.
- type "preference" = tastes, style choices, UI preferences.
- type "fact" = identity, demographics, location, job title, company.
- type "project" = current work context, tech stack for a specific project, business stage.
- type "decision" = explicit rules, commitments, past choices that govern future behavior.
- type "agent" = instructions on how the assistant should behave toward this user.
- Keep each content to one concise sentence. Start with "User prefers...", "User is...", "User wants...", "User decided...", "Always...", "Never...".
- Facts about a named person other than the user (friend, colleague, family member, named speaker) MUST include that person's name in the memory text — e.g. "Gina launched an ad campaign", never "the user's friend launched...". Use "User ..." only when the fact is about the user.
- If the fact refers to a specific time (an event, a past occurrence, an upcoming date), keep the date in the content text (e.g. "on 2023-01-29") AND set eventAt to that date as YYYY-MM-DD.
- If the fact stops being true after a date (a deadline, an event that will have passed, a temporary state), set expiresOn to the date it expires as YYYY-MM-DD.
- If nothing is memorable, return {"candidates": []}.`

export const AGENT_MEMORY_EXTRACTION_SYSTEM_PROMPT = `Extract only durable workspace knowledge from the target agent message.
Return the same JSON candidates shape, using project, decision, fact, or agent types.
Save explicit decisions, verified task outcomes, stable project facts, and reusable constraints.
Do not save suggestions, speculation, conversational filler, secrets, credentials, private reasoning, or unverified claims that an action occurred.
Each memory must be one concise factual sentence about the workspace or completed work. Name the person when a fact is about a named person rather than the workspace. Keep dates in the memory text and set eventAt when the fact is time-bound; set expiresOn for facts that stop being true after a date. If nothing is durable, return {"candidates": []}.`

export const MemoryExtractionSchema = z.object({
  candidates: z.array(
    z.object({
      content: z.string().describe('One short factual sentence about the user.'),
      type: z
        .enum(['preference', 'fact', 'project', 'decision', 'agent'])
        .describe('Classify the memory type.'),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe('How confident you are that this is worth remembering (0-1).'),
      rationale: z
        .string()
        .describe('One sentence explaining why this is memorable.'),
      eventAt: z
        .string()
        .optional()
        .describe('YYYY-MM-DD when the fact/event happened or happens. Omit if not time-bound.'),
      expiresOn: z
        .string()
        .optional()
        .describe('YYYY-MM-DD after which this fact is no longer true (deadlines, passed events). Omit if durable.'),
    }),
  ),
})

export type MemoryExtractionResult = z.infer<typeof MemoryExtractionSchema>
export type MemoryExtractionTargetActor = 'human' | 'agent'

export function buildMemoryExtractionPrompt(
  targetText: string,
  contextMessages: Array<{ role: string; text: string }>,
  targetActor: MemoryExtractionTargetActor,
): string {
  const context = contextMessages
    .map((m) => `${m.role}: ${m.text.slice(0, 400)}`)
    .join('\n')

  return [
    context ? 'Recent conversation context:' : '',
    context,
    context
      ? `\n---\nTarget ${targetActor} message to extract memories from:`
      : `${targetActor === 'agent' ? 'Agent' : 'User'} message to extract memories from:`,
    targetText,
    '',
    targetActor === 'agent'
      ? 'Extract only durable workspace facts, decisions, constraints, or verified outcomes.'
      : 'Extract memorable personal facts, preferences, or standing instructions about the user.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Cheap guards the Convex extractor applies before spending an LLM call. */
export function isExtractableTargetText(targetText: string): 'ok' | 'too_short' | 'likely_code' {
  const text = targetText.trim()
  if (text.length < 20) return 'too_short'
  if (/^[`\s]*```/.test(text) && text.split('\n').length < 3) return 'likely_code'
  return 'ok'
}

export function filterExtractionCandidates(
  candidates: MemoryExtractionResult['candidates'],
): MemoryExtractionResult['candidates'] {
  return (candidates ?? []).filter(
    (c) =>
      typeof c.content === 'string' &&
      c.content.trim().length > 5 &&
      (c.confidence ?? 1) >= MIN_EXTRACTION_CONFIDENCE,
  )
}

// ─── Semantic dedup decision (M1) ────────────────────────────────────────────

/**
 * Given a new candidate and its nearest existing memories, the model decides
 * whether the candidate is new, a repeat, an in-place correction, or a
 * factual replacement. Shared by the Convex extractor and the benchmark
 * harness replica so both make identical decisions.
 */
export const MEMORY_DEDUP_DECISION_SYSTEM_PROMPT = `You are a memory deduplication assistant. You are given a NEW candidate memory and the most similar EXISTING memories.

Decide what to do with the candidate:
- "add": the candidate carries genuinely new information the neighbors do not cover.
- "noop": a neighbor already states the same fact; the candidate adds nothing new.
- "update": the candidate refines or slightly corrects a neighbor that is still the same fact (merge into that row, in place).
- "supersede": the candidate contradicts or replaces a neighbor that is now outdated (the old fact was true then but is no longer true).

Return a JSON object:
{"decision": "add|noop|update|supersede", "targetIndex": 0, "mergedContent": "..."}

Rules:
- targetIndex: 0-based index of the EXISTING memory the decision applies to. Required for noop/update/supersede; omit for add.
- mergedContent: the single final memory sentence. Required for update and supersede — for update it replaces the neighbor's text; for supersede it becomes the new row's text. Omit for add/noop.
- Prefer update over supersede for small refinements; prefer supersede when the old fact would now be wrong.
- Prefer noop over add when the candidate merely restates a neighbor.
- Keep mergedContent as one concise factual sentence, preserving names and dates.`

export const MemoryDedupDecisionSchema = z.object({
  decision: z
    .enum(['add', 'noop', 'update', 'supersede'])
    .describe('What to do with the candidate memory.'),
  targetIndex: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('0-based index of the existing memory this applies to (noop/update/supersede).'),
  mergedContent: z
    .string()
    .optional()
    .describe('Final memory text for update/supersede.'),
})

export type MemoryDedupDecision = z.infer<typeof MemoryDedupDecisionSchema>

export function buildMemoryDedupDecisionPrompt(
  candidateContent: string,
  neighbors: Array<{ content: string }>,
): string {
  const existing = neighbors
    .map((n, i) => `[${i}] ${n.content}`)
    .join('\n')
  return [
    'EXISTING memories (most similar first):',
    existing,
    '',
    `NEW candidate: ${candidateContent}`,
    '',
    'Decide what to do with the candidate.',
  ].join('\n')
}

/** Lenient ISO-date parse for model-emitted eventAt/expiresOn strings. */
export function parseMemoryDate(value: string | undefined | null): number | undefined {
  if (!value) return undefined
  const t = Date.parse(value.trim())
  if (Number.isNaN(t)) return undefined
  // Sanity bound: 2000-01-01 .. 2100-01-01
  if (t < 946_684_800_000 || t > 4_102_444_800_000) return undefined
  return t
}
