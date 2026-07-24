import Groq from 'groq-sdk'

// ── Model definitions ──────────────────────────────────────────────────────────

interface ExtractionModel {
  id: string
  backend: 'groq' | 'openrouter'
}

/**
 * Free-tier model order:
 *   1. openrouter/free  (OpenRouter — costs nothing, good quality via free router)
 *   2. openai/gpt-oss-20b (Groq — fast, free-tier friendly)
 * Falls back to paid models only if both are rate-limited.
 */
const FREE_TIER_MODELS: ExtractionModel[] = [
  { id: 'openrouter/free', backend: 'openrouter' },
  { id: 'openai/gpt-oss-20b', backend: 'groq' }
]

/**
 * Paid-tier (Pro/Max) model order — best quality first.
 */
const PAID_TIER_MODELS: ExtractionModel[] = [
  { id: 'openai/gpt-oss-20b', backend: 'groq' },
  { id: 'llama-3.3-70b-versatile', backend: 'groq' },
  { id: 'llama-3.1-8b-instant', backend: 'groq' },
]

// Per-tier starting index (persisted across calls to skip rate-limited models)
let freeModelIndex = 0
let paidModelIndex = 0

// ── Shared helpers ─────────────────────────────────────────────────────────────

/**
 * Call a single model for extraction. Returns the raw text response or null on failure.
 * Throws a rate-limit-tagged error so the loop can rotate models.
 */
async function callModel(
  model: ExtractionModel,
  prompt: string,
  groqKey: string,
  openrouterKey?: string
): Promise<string> {
  if (model.backend === 'openrouter') {
    const key = openrouterKey
    if (!key) throw new Error('No OpenRouter key available')

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://getoverlay.io',
        'X-Title': 'Overlay Memory Extraction'
      },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 2048
      })
    })

    if (!response.ok) {
      const text = await response.text()
      const rateLimitError = Object.assign(new Error(text), { status: response.status })
      throw rateLimitError
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>
    }
    return data.choices?.[0]?.message?.content || '[]'
  }

  // Groq backend
  const groq = new Groq({ apiKey: groqKey })
  const completion = await groq.chat.completions.create({
    model: model.id,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 2048
  })
  return completion.choices[0]?.message?.content || '[]'
}

/**
 * Attempt to salvage complete JSON objects from a truncated array string.
 * When a model hits max_tokens mid-response, the trailing object and closing
 * bracket are cut off. This finds the last fully-closed `}` and closes the array.
 */
function recoverPartialJsonArray(raw: string): string {
  const last = raw.lastIndexOf('}')
  if (last === -1) return '[]'
  return raw.slice(0, last + 1) + ']'
}

function isRateLimitError(err: unknown): boolean {
  const e = err as { status?: number; error?: { code?: string }; message?: string }
  return (
    e?.status === 429 ||
    e?.error?.code === 'rate_limit_exceeded' ||
    (typeof e?.message === 'string' &&
      (e.message.includes('429') || e.message.toLowerCase().includes('rate limit')))
  )
}

/**
 * Run extraction using a model list with automatic rate-limit rotation.
 * Returns the raw JSON string response from whichever model succeeded.
 */
async function runExtractionLoop(
  models: ExtractionModel[],
  startIndex: number,
  prompt: string,
  groqKey: string,
  openrouterKey: string | undefined,
  logPrefix: string
): Promise<{ response: string; model: string; nextIndex: number }> {
  let idx = startIndex % models.length

  for (let attempts = 0; attempts < models.length; attempts++) {
    const model = models[idx]
    console.log(`[${logPrefix}] Trying model: ${model.id} (${model.backend})`)

    try {
      const response = await callModel(model, prompt, groqKey, openrouterKey)
      return { response, model: model.id, nextIndex: idx }
    } catch (err) {
      if (isRateLimitError(err)) {
        console.warn(`[${logPrefix}] Rate limit on ${model.id}, rotating...`)
        idx = (idx + 1) % models.length
      } else {
        console.error(`[${logPrefix}] Error on ${model.id}:`, err)
        return { response: '[]', model: 'error', nextIndex: idx }
      }
    }
  }

  console.warn(`[${logPrefix}] All models rate-limited`)
  return { response: '[]', model: 'none', nextIndex: idx }
}

const EXTRACTION_PROMPT = `You are a memory extraction system. Your job is to extract ONLY facts, preferences, and decisions that the user has EXPLICITLY stated in their own words.

## CRITICAL RULES

1. You may ONLY extract information from the "User message to analyze" section below.
2. Conversation history is provided ONLY so you can understand what the user is referring to (e.g. if the user says "yes, let's do that", you can look at the history to understand what "that" means). You must NEVER extract information that only appears in assistant messages.
3. NEVER extract:
   - AI suggestions, recommendations, or proposals that the user has not explicitly agreed to
   - Information the user is merely asking about or exploring (e.g. "how do I build X?" is a question, NOT a decision to build X)
   - Paraphrases of what the AI said
   - Information from retrieved context (these are already stored)
4. ONLY extract when the user makes a clear, affirmative statement:
   - "I use TypeScript" → extract (explicit statement)
   - "I've decided to go with Postgres" → extract (explicit decision)
   - "how do I use TypeScript?" → do NOT extract (just a question)
   - "that sounds good, let's use Postgres" → extract (explicit agreement referencing prior suggestion)

## WHAT TO EXTRACT (only from user's explicit statements)

### PERSONAL FACTS (type: "fact")
The user explicitly states something about themselves:
- "I'm a software engineer at Google" → extract
- "I live in Tokyo" → extract
- "I have two kids" → extract

### PREFERENCES (type: "preference")
The user explicitly states a preference or habit:
- "I always use dark mode" → extract
- "I prefer Python over Java" → extract
- "please always use TypeScript in examples" → extract

### PROJECT CONTEXT (type: "project")
The user explicitly describes their own project:
- "I'm building a todo app with React" → extract
- "our project uses PostgreSQL" → extract
- "we're migrating to microservices" → extract

### DECISIONS (type: "decision")
The user explicitly makes or confirms a decision:
- "let's go with Redis for caching" → extract
- "I've decided to use Next.js" → extract
- "yes, that approach works, let's do it" → extract (use history to resolve what "it" means)

## WHAT TO NEVER EXTRACT
- Questions ("how do I...?", "what's the best way to...?", "can you help me with...?")
- The AI's suggestions or recommendations
- Hypotheticals ("if I were to use...", "what if we...")
- Already-stored memories listed below
- Information only present in assistant responses
- Exploration without commitment ("I'm looking into...", "I'm curious about...")

## OUTPUT FORMAT
Respond with a JSON array only. Each object:
- "content": Clear standalone statement in third person ("User..." / "User's project...")
- "type": One of "fact", "preference", "project", "decision"
- "importance": Float 0.0-1.0
  - 0.9-1.0: Core identity, explicit "remember this"
  - 0.7-0.8: Strong preferences, important decisions
  - 0.5-0.6: Useful context, confirmed project details
  - 0.3-0.4: Minor details

If the user message is just a question, greeting, or contains nothing worth remembering, return: []`

export interface ExtractedMemory {
  content: string
  type: 'preference' | 'fact' | 'project' | 'decision'
  importance: number
}

export interface ExtractedAgentMemory {
  content: string
  type: 'agent' | 'fact' | 'preference' | 'decision'
  importance: number
  taskFingerprint: string
}

export interface ExtractionResult {
  memories: ExtractedMemory[]
  model: string
}

export interface AgentRunExtractionResult {
  memories: ExtractedAgentMemory[]
  model: string
}

/**
 * Extract memories from a user message.
 *
 * IMPORTANT: Only the userMessage is used as the extraction source.
 * conversationContext (previous exchanges) is provided only so the LLM
 * can resolve references like "yes, let's do that".
 * The current assistant response is intentionally NOT passed.
 *
 * @param tier - 'free' uses openrouter/free → openai/gpt-oss-20b; 'pro'/'max' use llama models
 * @param openrouterKey - Required for free tier to call openrouter/free
 */
export async function extractMemories(
  userMessage: string,
  groqKey: string,
  conversationContext?: string[],
  existingMemories?: string[],
  tier: 'free' | 'pro' | 'max' = 'pro',
  openrouterKey?: string
): Promise<ExtractionResult> {
  // Build conversation history section (previous exchanges only, for reference)
  const contextStr = conversationContext?.slice(-5).join('\n') || ''

  // Build existing memories section so the LLM avoids re-extraction
  let existingMemoriesStr = ''
  if (existingMemories && existingMemories.length > 0) {
    const memoriesToShow = existingMemories.slice(-50)
    existingMemoriesStr = `\n## ALREADY STORED MEMORIES (DO NOT RE-EXTRACT)
${memoriesToShow.map((m) => `- ${m}`).join('\n')}
`
  }

  const prompt = `${EXTRACTION_PROMPT}
${existingMemoriesStr}
---
${contextStr ? `\nPrevious conversation (for reference only, DO NOT extract from assistant messages):\n${contextStr}\n` : ''}
User message to analyze (ONLY extract from this):
${userMessage}

Extract memories (respond with JSON array only):`

  const models = tier === 'free' ? FREE_TIER_MODELS : PAID_TIER_MODELS
  const startIdx = tier === 'free' ? freeModelIndex : paidModelIndex

  const { response, model, nextIndex } = await runExtractionLoop(
    models,
    startIdx,
    prompt,
    groqKey,
    openrouterKey,
    'Memory'
  )

  // Persist the next starting index for rate-limit avoidance
  if (tier === 'free') freeModelIndex = nextIndex
  else paidModelIndex = nextIndex

  if (model === 'error' || model === 'none') {
    return { memories: [], model }
  }

  let jsonStr = response
  const jsonMatch = response.match(/\[[\s\S]*\]/)
  if (jsonMatch) jsonStr = jsonMatch[0]

  let parsed: ExtractedMemory[] | null = null
  try {
    parsed = JSON.parse(jsonStr) as ExtractedMemory[]
  } catch {
    try {
      parsed = JSON.parse(recoverPartialJsonArray(jsonStr)) as ExtractedMemory[]
      console.warn(`[Memory] Recovered partial JSON from ${model}`)
    } catch (parseError) {
      console.warn(`[Memory] JSON parse error with ${model}:`, parseError)
      return { memories: [], model }
    }
  }
  const validMemories = (parsed ?? []).filter(
    (m) =>
      m.content &&
      typeof m.content === 'string' &&
      ['preference', 'fact', 'project', 'decision'].includes(m.type) &&
      typeof m.importance === 'number' &&
      m.importance >= 0 &&
      m.importance <= 1
  )
  console.log(`[Memory] Extracted ${validMemories.length} memories with ${model}`)
  return { memories: validMemories, model }
}

const AGENT_RUN_EXTRACTION_PROMPT = `You are a memory extraction system analyzing a completed AI agent run.
Extract reusable memories that would help with similar tasks in the future.

## WHAT TO EXTRACT

### WORKFLOW MEMORIES (type: "agent")
Effective multi-step procedures the agent completed successfully:
- "To book a flight on kayak.com: go to kayak.com, enter route/dates, sort by price, select cheapest option, proceed to booking"
- "To export data from Notion: Settings → Export → Markdown & CSV → download zip"
- "To create a GitHub PR: git checkout -b branch, make changes, git push, gh pr create"

### SITE-SPECIFIC FACTS (type: "fact")
Discovered UI patterns, selectors, or quirks:
- "On LinkedIn, the 'Connect' button is inside the profile card, not the main nav"
- "Google Sheets export: File → Download → CSV for current sheet only"

### USER PREFERENCES inferred from agent behavior (type: "preference")
Only if clearly demonstrated by the task outcome:
- "User prefers PDF format over Word for documents"

### DECISIONS made during the run (type: "decision")
Choices the agent made that should be remembered:
- "User chose to use Safari over Chrome for banking sites"

## OUTPUT FORMAT
Respond with a JSON array only. Each object:
- "content": Clear, reusable statement (start with action verb or context)
- "type": One of "agent", "fact", "preference", "decision"
- "importance": Float 0.0-1.0
  - 0.8-1.0: Multi-step procedure, critical site pattern
  - 0.5-0.7: Useful shortcut or preference
  - 0.3-0.4: Minor detail
- "taskFingerprint": 3-5 key words from the task (e.g. "book flight kayak travel")

If no reusable knowledge was gained, return: []`

/**
 * Extract reusable memories from a completed agent run.
 * Analyzes the command, tool trace, and result to produce agent memory candidates.
 *
 * @param tier - 'free' uses openrouter/free → openai/gpt-oss-20b; 'pro'/'max' use llama models
 * @param openrouterKey - Required for free tier
 */
export async function extractAgentRunMemories(
  command: string,
  toolTrace: Array<{ tool: string; input: string; result: string }>,
  groqKey: string,
  tier: 'free' | 'pro' | 'max' = 'pro',
  openrouterKey?: string
): Promise<AgentRunExtractionResult> {
  // Build a compact trace summary (avoid token explosion)
  const traceLines = toolTrace
    .slice(0, 20)
    .map((t) => {
      const inputPreview = t.input.length > 200 ? t.input.substring(0, 200) + '...' : t.input
      const resultPreview = t.result.length > 300 ? t.result.substring(0, 300) + '...' : t.result
      return `  [${t.tool}]\n    Input: ${inputPreview}\n    Result: ${resultPreview}`
    })
    .join('\n')

  const prompt = `${AGENT_RUN_EXTRACTION_PROMPT}

---
## Agent Run to Analyze

**User Command:** ${command}

**Tool Trace (${toolTrace.length} steps):**
${traceLines || '  (no tool calls recorded)'}

Extract reusable memories (respond with JSON array only):`

  const models = tier === 'free' ? FREE_TIER_MODELS : PAID_TIER_MODELS
  const startIdx = tier === 'free' ? freeModelIndex : paidModelIndex

  const { response, model, nextIndex } = await runExtractionLoop(
    models,
    startIdx,
    prompt,
    groqKey,
    openrouterKey,
    'AgentMemory'
  )

  if (tier === 'free') freeModelIndex = nextIndex
  else paidModelIndex = nextIndex

  if (model === 'error' || model === 'none') {
    return { memories: [], model }
  }

  let jsonStr = response
  const jsonMatch = response.match(/\[[\s\S]*\]/)
  if (jsonMatch) jsonStr = jsonMatch[0]

  type RawEntry = { content?: string; type?: string; importance?: number; taskFingerprint?: string }
  let raw: RawEntry[] | null = null
  try {
    raw = JSON.parse(jsonStr) as RawEntry[]
  } catch {
    try {
      raw = JSON.parse(recoverPartialJsonArray(jsonStr)) as RawEntry[]
      console.warn(`[AgentMemory] Recovered partial JSON from ${model}`)
    } catch (parseError) {
      console.warn(`[AgentMemory] JSON parse error with ${model}:`, parseError)
      return { memories: [], model }
    }
  }
  const memories = (raw ?? [])
    .filter(
      (m) =>
        m.content &&
        typeof m.content === 'string' &&
        ['agent', 'fact', 'preference', 'decision'].includes(m.type || '') &&
        typeof m.importance === 'number' &&
        m.importance >= 0 &&
        m.importance <= 1
    )
    .map((m) => ({
      content: m.content!,
      type: m.type as ExtractedAgentMemory['type'],
      importance: m.importance!,
      taskFingerprint: m.taskFingerprint || command.split(' ').slice(0, 5).join(' ')
    }))

  console.log(`[AgentMemory] Extracted ${memories.length} agent memories with ${model}`)
  return { memories, model }
}
