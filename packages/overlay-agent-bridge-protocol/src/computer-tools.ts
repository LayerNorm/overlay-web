import { z } from 'zod/v3'

/**
 * The computer tools' inputs, approval rules and result text, shared by Overlay's cloud harness
 * (src/server/tools/tools/build.ts) and private threads in the Agent Host, so a tool call is checked, approved and
 * described the same way wherever the agent loop runs. Descriptions stay with each runtime: they name the machine.
 */

const coordinate = z.number().int().min(0).max(8192)
export const computerPointSchema = z.object({ x: coordinate, y: coordinate }).strict()

export const computerBrowserUrlSchema = z.string().url().refine(
  (value) => /^https?:\/\//i.test(value),
  'URL must use HTTP or HTTPS.',
)

const scrollDirection = z.enum(['up', 'down', 'left', 'right'])
const scrollAmount = z.number().int().min(1).max(25)

export const computerInputVariants = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('click'),
    x: coordinate,
    y: coordinate,
    button: z.enum(['left', 'middle', 'right']).optional(),
    count: z.number().int().min(1).max(25).optional(),
    confirm: z.boolean().optional(),
  }).strict(),
  z.object({ action: z.literal('double_click'), x: coordinate, y: coordinate, confirm: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('right_click'), x: coordinate, y: coordinate, confirm: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('move'), x: coordinate, y: coordinate }).strict(),
  z.object({ action: z.literal('drag'), from: computerPointSchema, to: computerPointSchema }).strict(),
  z.object({ action: z.literal('type'), text: z.string().max(10000) }).strict(),
  z.object({ action: z.literal('key'), keys: z.string().min(1).max(100) }).strict(),
  z.object({
    action: z.literal('scroll'),
    x: coordinate.optional(),
    y: coordinate.optional(),
    direction: scrollDirection,
    amount: scrollAmount,
  }).strict(),
  z.object({ action: z.literal('wait'), ms: z.number().int().min(0).max(10000) }).strict(),
])
export type ComputerInputAction = z.infer<typeof computerInputVariants>

/** One flat object for the model (providers want an object schema); `computerInputVariants` checks each action. */
export const computerInputFields = {
  action: z.enum(['click', 'double_click', 'right_click', 'move', 'drag', 'type', 'key', 'scroll', 'wait']),
  x: coordinate.optional(),
  y: coordinate.optional(),
  button: z.enum(['left', 'middle', 'right']).optional(),
  count: z.number().int().min(1).max(25).optional(),
  confirm: z.boolean().optional(),
  from: computerPointSchema.optional(),
  to: computerPointSchema.optional(),
  text: z.string().max(10000).optional(),
  keys: z.string().min(1).max(100).optional(),
  direction: scrollDirection.optional(),
  amount: scrollAmount.optional(),
  ms: z.number().int().min(0).max(10000).optional(),
}

const BROWSER_KEYS = ['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageDown'] as const
const browserRef = z.string().min(1).max(64)

export const computerBrowserVariants = z.discriminatedUnion('action', [
  z.object({ action: z.literal('navigate'), url: computerBrowserUrlSchema }).strict(),
  z.object({ action: z.literal('back') }).strict(),
  z.object({ action: z.literal('forward') }).strict(),
  z.object({ action: z.literal('reload') }).strict(),
  z.object({ action: z.literal('snapshot') }).strict(),
  z.object({ action: z.literal('click'), ref: browserRef, confirm: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('type'), ref: browserRef, text: z.string().max(10000), submit: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('scroll'), direction: scrollDirection, amount: scrollAmount }).strict(),
  z.object({ action: z.literal('press'), keys: z.enum(BROWSER_KEYS) }).strict(),
  z.object({ action: z.literal('tabs') }).strict(),
  z.object({ action: z.literal('switch_tab'), index: z.number().int().min(0).max(49) }).strict(),
  z.object({ action: z.literal('new_tab'), url: computerBrowserUrlSchema }).strict(),
])
export type ComputerBrowserAction = z.infer<typeof computerBrowserVariants>

export const computerBrowserFields = {
  action: z.enum(['navigate', 'back', 'forward', 'reload', 'snapshot', 'click', 'type', 'scroll', 'press', 'tabs', 'switch_tab', 'new_tab']),
  url: computerBrowserUrlSchema.optional(),
  ref: browserRef.optional(),
  confirm: z.boolean().optional(),
  text: z.string().max(10000).optional(),
  submit: z.boolean().optional(),
  direction: scrollDirection.optional(),
  amount: scrollAmount.optional(),
  keys: z.enum(BROWSER_KEYS).optional(),
  index: z.number().int().min(0).max(49).optional(),
}

export const computerTerminalIdSchema = z.string().regex(/^t-[0-9a-f]{12}$/)

export const computerTerminalVariants = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), command: z.string().min(1).max(100000), cwd: z.string().max(4096).optional() }).strict(),
  z.object({
    action: z.literal('read'),
    id: computerTerminalIdSchema,
    offset: z.number().int().min(0).optional(),
    maxBytes: z.number().int().min(1).max(65536).optional(),
  }).strict(),
  z.object({ action: z.literal('cancel'), id: computerTerminalIdSchema, signal: z.enum(['INT', 'TERM', 'KILL']).optional() }).strict(),
  z.object({ action: z.literal('list') }).strict(),
])
export type ComputerTerminalAction = z.infer<typeof computerTerminalVariants>

export const computerTerminalFields = {
  action: z.enum(['start', 'read', 'cancel', 'list']),
  command: z.string().min(1).max(100000).optional(),
  cwd: z.string().max(4096).optional(),
  id: computerTerminalIdSchema.optional(),
  offset: z.number().int().min(0).optional(),
  maxBytes: z.number().int().min(1).max(65536).optional(),
  signal: z.enum(['INT', 'TERM', 'KILL']).optional(),
}

/**
 * A flat tool input schema whose fields are checked against the per-action variants. `omit` names fields a runtime
 * adds for itself (the cloud's `target`) that the variants do not know.
 */
export function computerToolInputSchema<Fields extends z.ZodRawShape>(
  fields: Fields,
  variants: z.ZodTypeAny,
  omit: readonly string[] = [],
) {
  return z.object(fields).strict().superRefine((input, ctx) => {
    const rest: Record<string, unknown> = { ...input }
    for (const key of omit) delete rest[key]
    const parsed = variants.safeParse(rest)
    if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue(issue)
  })
}

/** What `computer_input` sends to the desktop driver: double and right clicks are clicks. */
export function computerInputDriverCommand(input: ComputerInputAction): { command: string; args: Record<string, unknown> } {
  const { action, ...rest } = input
  const args: Record<string, unknown> = { ...rest }
  if (action === 'double_click') args.count = 2
  if (action === 'right_click') args.button = 'right'
  return { command: action === 'double_click' || action === 'right_click' ? 'click' : action, args }
}

/** Typing, keys and clicks marked consequential (`confirm: true`) wait for the person. */
export function computerActionRequiresApproval(toolName: string, input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const action = (input as { action?: unknown }).action
  const confirmed = (input as { confirm?: unknown }).confirm === true
  if (toolName === 'computer_input') {
    return action === 'type' || action === 'key' || (['click', 'double_click', 'right_click'].includes(String(action)) && confirmed)
  }
  if (toolName === 'computer_browser') {
    return action === 'type' || action === 'press' || (action === 'click' && confirmed)
  }
  return false
}

/** Whether a computer tool call asks the person first when the agent's permissions are "Ask". */
export function computerToolRequiresApproval(toolName: string, input: unknown): boolean {
  if (computerActionRequiresApproval(toolName, input)) return true
  if (toolName === 'computer_exec') return true
  const action = input && typeof input === 'object' && !Array.isArray(input) ? (input as { action?: unknown }).action : undefined
  if (toolName === 'computer_terminal') return action === 'start'
  // Recording itself is private; making it public shares the screen outside the workspace.
  if (toolName === 'computer_recording') return action === 'stop' && (input as { public?: unknown }).public === true
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The text the model reads for a browser action's result. */
export function browserActionText(action: string, args: Record<string, unknown>, result: Record<string, unknown>): string {
  if (action === 'snapshot') {
    const elements = Array.isArray(result.elements) ? result.elements.filter(isRecord) : []
    const lines = elements.map((element) => {
      const bbox = isRecord(element.bbox) ? element.bbox : {}
      return [
        `${String(element.ref ?? '')} ${String(element.role ?? '')}: ${String(element.name ?? '')}`,
        `  bbox x=${String(bbox.x ?? 0)} y=${String(bbox.y ?? 0)} width=${String(bbox.width ?? 0)} height=${String(bbox.height ?? 0)}`,
      ].join('\n')
    })
    return [
      `URL: ${String(result.url ?? '')}`,
      `Title: ${String(result.title ?? '')}`,
      'Visible text:',
      String(result.text ?? '').slice(0, 20_000),
      `Interactive elements (${elements.length}):`,
      ...lines,
    ].join('\n')
  }
  if (action === 'tabs') {
    const tabs = Array.isArray(result.tabs) ? result.tabs.filter(isRecord) : []
    return [
      `Open tabs (${tabs.length}):`,
      ...tabs.map((tab) => `${String(tab.index ?? '')}: ${String(tab.title ?? '')} ${String(tab.url ?? '')}`),
    ].join('\n')
  }
  if (action === 'navigate') return `Navigated to ${String(args.url ?? 'the requested URL')}.`
  if (action === 'switch_tab') return `Switched to browser tab ${String(result.index ?? args.index ?? '')}.`
  if (action === 'new_tab') return 'Opened a new browser tab.'
  return `Browser ${action.replaceAll('_', ' ')} completed.`
}
