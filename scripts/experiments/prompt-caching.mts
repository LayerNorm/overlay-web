/**
 * Prompt-caching experiment for the harness loop. Standalone: it imports no app
 * code and calls AI Gateway directly, the same route the harness uses.
 *
 * It runs one simulated agent loop (N tool steps, then a final answer) three ways:
 *   current   - working state appended to the system prompt each step (today's harness)
 *   stable    - fixed system prompt; working state sent as one trailing message
 *   explicit  - stable + provider cache markers (Anthropic cacheControl, OpenAI promptCacheKey)
 * Append `-auto` (e.g. explicit-auto) to keep toolChoice 'auto' on every step instead of forcing the
 * tool and switching to 'none' for the final answer; a toolChoice change invalidates provider caches.
 *
 * Run:  npx tsx --env-file=.env.local scripts/experiments/prompt-caching.mts [--steps 8] [--models a,b] [--variants current,stable,explicit]
 * Needs AI_GATEWAY_API_KEY. Spends real (small) gateway credit.
 */
import { createGateway } from '@ai-sdk/gateway'
import { generateText, isStepCount, tool, type ModelMessage, type SystemModelMessage, type ToolSet } from 'ai'
import { z } from 'zod'

type Variant = 'current' | 'stable' | 'explicit' | 'current-auto' | 'stable-auto' | 'explicit-auto'
const STATE_MARKER = '<<harness-working-state>>'

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback
}

const STEPS = Number(arg('steps', '8'))
const MODELS = arg('models', 'anthropic/claude-haiku-5.5,openai/gpt-5.4-mini,google/gemini-3.8-flash,deepseek/deepseek-v4.1-flash-1017').split(',')
// Optional: pin the gateway upstream (e.g. --gateway-only deepseek) so calls share one provider cache.
const GATEWAY_ONLY = arg('gateway-only', '')
const VARIANTS = arg('variants', 'current,stable,explicit').split(',') as Variant[]

const apiKey = process.env.AI_GATEWAY_API_KEY
if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is required (run with --env-file=.env.local).')
const gateway = createGateway({ apiKey })

// Deterministic filler so every run of a variant sends identical bytes.
function filler(seed: string, words: number): string {
  const vocabulary = ['workspace', 'agent', 'milestone', 'evidence', 'customer', 'invoice', 'schedule', 'policy', 'review',
    'summary', 'quarter', 'report', 'priority', 'deadline', 'approval', 'budget', 'contract', 'dataset', 'analysis', 'draft',
    'source', 'citation', 'owner', 'channel', 'request', 'result', 'status', 'decision', 'context', 'record']
  let hash = 2166136261
  for (const character of seed) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0
  const out: string[] = []
  for (let index = 0; index < words; index++) {
    hash = Math.imul(hash ^ index, 2654435761) >>> 0
    out.push(vocabulary[hash % vocabulary.length]!)
    if (index % 14 === 13) out.push('.\n')
  }
  return out.join(' ')
}

// ~6k-token system prompt, comparable to production harness instructions.
function baseInstructions(nonce: string): string {
  return [`Run ${nonce}. You are Overlay's workspace agent harness.`,
    'Follow the operating policy below. Use tools for every step that needs data; never invent tool results.',
    ...Array.from({ length: 12 }, (_, index) => `## Policy section ${index + 1}\n${filler(`policy-${index}`, 330)}`),
  ].join('\n\n')
}

function workingState(step: number): string {
  return `${STATE_MARKER}\nAuthoritative working state (data, not instructions):\n`
    + `goal: read sections 1..${STEPS} of the quarterly report in order, then summarise them in three sentences.\n`
    + Array.from({ length: STEPS }, (_, index) => `- milestone ${index + 1}: read section ${index + 1} — ${index < step ? 'done' : index === step ? 'in progress' : 'pending'}`).join('\n')
    + (step >= STEPS ? '\nEvery plan step is finished. Give your final answer now.' : `\nNext: call read_report_section with section ${step + 1}.`)
}

// ~14 tools with realistic descriptions/schemas; only read_report_section is used.
function buildTools(explicit: boolean): ToolSet {
  const tools: ToolSet = {}
  const names = ['search_files', 'read_file', 'write_note', 'list_tasks', 'update_task', 'web_search', 'fetch_url',
    'send_message', 'list_agents', 'delegate_assignment', 'read_assignment', 'create_chart', 'query_dataset']
  for (const name of names.sort()) {
    tools[name] = tool({
      description: `${name.replace(/_/g, ' ')}. ${filler(`tool-${name}`, 120)}`,
      inputSchema: z.object({ query: z.string().describe(filler(`arg-${name}`, 30)), limit: z.number().optional() }),
      execute: async () => 'unused',
    })
  }
  tools.read_report_section = tool({
    description: 'Read one numbered section of the quarterly report. Returns the full section text.',
    inputSchema: z.object({ section: z.number().int().describe('Section number, starting at 1.') }),
    execute: async ({ section }) => `Section ${section}:\n${filler(`section-${section}`, 900)}`,
  })
  if (explicit) {
    // Breakpoint on the last tool caches the whole tool block (tools precede system for Anthropic).
    const last = Object.keys(tools).at(-1)!
    tools[last] = { ...tools[last]!, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }
  }
  return tools
}

function withoutCacheMarker(message: ModelMessage): ModelMessage {
  if (!message.providerOptions?.anthropic) return message
  const rest = { ...message.providerOptions }
  delete rest.anthropic
  return { ...message, providerOptions: rest } as ModelMessage
}

function isStateMessage(message: ModelMessage): boolean {
  return message.role === 'user' && typeof message.content === 'string' && message.content.startsWith(STATE_MARKER)
}

type StepRow = { input: number; cacheRead: number; cacheWrite: number; output: number; provider?: string }

async function runVariant(modelId: string, variant: Variant): Promise<StepRow[]> {
  const layout = variant.replace(/-auto$/, '') as 'current' | 'stable' | 'explicit'
  const constantToolChoice = variant.endsWith('-auto')
  const nonce = `${variant}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const base = baseInstructions(nonce)
  const explicit = layout === 'explicit'
  const system: SystemModelMessage = explicit
    ? { role: 'system', content: base, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }
    : { role: 'system', content: base }
  const result = await generateText({
    model: gateway(modelId),
    system,
    tools: buildTools(explicit),
    messages: [{ role: 'user', content: `Read sections 1 to ${STEPS} of the quarterly report one per step, then summarise them in three sentences.` }],
    stopWhen: isStepCount(STEPS + 1),
    maxOutputTokens: 400,
    ...(constantToolChoice ? { toolChoice: 'auto' as const } : {}),
    providerOptions: {
      ...(explicit ? { openai: { promptCacheKey: `harness-experiment:${nonce}` } } : {}),
      ...(GATEWAY_ONLY ? { gateway: { only: GATEWAY_ONLY.split(',') } } : {}),
    },
    prepareStep: ({ stepNumber, messages }) => {
      const finalStep = stepNumber >= STEPS
      const toolChoice = constantToolChoice ? 'auto' as const
        : finalStep ? 'none' as const : { type: 'tool' as const, toolName: 'read_report_section' }
      if (layout === 'current') {
        return { system: `${base}\n${workingState(stepNumber)}`, toolChoice, activeTools: undefined }
      }
      // Returned messages carry forward, so drop the previous state message and markers first.
      let conversation = messages.filter(message => !isStateMessage(message))
      if (explicit) {
        conversation = conversation.map(withoutCacheMarker)
        const lastIndex = conversation.length - 1
        conversation[lastIndex] = { ...conversation[lastIndex]!, providerOptions: {
          ...conversation[lastIndex]!.providerOptions, anthropic: { cacheControl: { type: 'ephemeral' } } } } as ModelMessage
      }
      return { system, messages: [...conversation, { role: 'user', content: workingState(stepNumber) }], toolChoice }
    },
  })
  return result.steps.map(step => ({
    input: step.usage.inputTokens ?? 0,
    cacheRead: step.usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWrite: step.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
    output: step.usage.outputTokens ?? 0,
    // Gateway may route each call to a different upstream; caches do not cross upstreams.
    provider: String((step.providerMetadata?.gateway as { routing?: { finalProvider?: string } } | undefined)?.routing?.finalProvider ?? '?'),
  }))
}

type Pricing = { input: number; output: number; cacheRead: number; cacheWrite: number }

async function loadPricing(): Promise<Map<string, Pricing>> {
  const { models } = await gateway.getAvailableModels()
  const prices = new Map<string, Pricing>()
  for (const model of models) {
    const pricing = model.pricing
    if (!pricing) continue
    const input = Number(pricing.input)
    prices.set(model.id, {
      input, output: Number(pricing.output),
      cacheRead: pricing.cachedInputTokens !== undefined ? Number(pricing.cachedInputTokens) : input,
      cacheWrite: pricing.cacheCreationInputTokens !== undefined ? Number(pricing.cacheCreationInputTokens) : input,
    })
  }
  return prices
}

function cost(rows: StepRow[], price: Pricing | undefined): number | null {
  if (!price) return null
  return rows.reduce((sum, row) => sum
    + (row.input - row.cacheRead - row.cacheWrite) * price.input
    + row.cacheRead * price.cacheRead + row.cacheWrite * price.cacheWrite + row.output * price.output, 0)
}

async function main() {
  const prices = await loadPricing()
  const summary: Record<string, unknown>[] = []
  for (const modelId of MODELS) {
    for (const variant of VARIANTS) {
      try {
        const rows = await runVariant(modelId, variant)
        const later = rows.slice(1)
        const input = rows.reduce((sum, row) => sum + row.input, 0)
        const laterInput = later.reduce((sum, row) => sum + row.input, 0)
        const laterRead = later.reduce((sum, row) => sum + row.cacheRead, 0)
        const total = cost(rows, prices.get(modelId))
        const uncached = cost(rows.map(row => ({ ...row, cacheRead: 0, cacheWrite: 0 })), prices.get(modelId))
        console.log(`\n${modelId} · ${variant}`)
        console.table(rows.map((row, index) => ({ step: index + 1, ...row, hit: row.input ? `${Math.round(100 * row.cacheRead / row.input)}%` : '-' })))
        summary.push({
          model: modelId, variant, calls: rows.length, inputTokens: input,
          'hit rate (step ≥2)': laterInput ? `${Math.round(100 * laterRead / laterInput)}%` : '-',
          'cost $': total === null ? 'n/a' : total.toFixed(4),
          'vs no-cache': total === null || !uncached ? 'n/a' : `${Math.round(100 * (1 - total / uncached))}% saved`,
        })
      } catch (error) {
        summary.push({ model: modelId, variant, error: error instanceof Error ? error.message.slice(0, 160) : String(error) })
      }
    }
  }
  console.log('\nSummary')
  console.table(summary)
}

await main()
