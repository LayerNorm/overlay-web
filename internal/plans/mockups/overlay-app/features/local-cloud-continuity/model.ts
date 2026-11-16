import { useSyncExternalStore } from 'react'

export const HANDOFF_THREAD_ID = 'k17convatlastable000000000000000'
export const DELEGATING_THREAD_ID = 'k17convatlascheckout000000000000'
export const PROJECT_AGENT_ID = 'agent_atlas'

export type Where = 'mac' | 'cloud'
export type Marker =
  | { kind: 'handoff'; to: Where; snapshot: string; files: number }
  | { kind: 'delegation' }

const MARKER_PREFIX = 'mockup-marker:'

/** A transcript row the feature draws itself: a handoff divider or a group of delegated tasks. */
export function mockupMarker(conversationId: string, ago: number, marker: Marker) {
  const at = Date.now() - ago
  return {
    id: `marker_${conversationId.slice(-6)}_${ago}`,
    conversationId,
    turnId: `marker_${ago}`,
    authorKind: 'system' as const,
    authorPrincipalId: 'system',
    content: MARKER_PREFIX + JSON.stringify(marker),
    parts: [],
    createdAt: at,
    updatedAt: at,
    status: 'complete',
  }
}

export function readMarker(content: unknown): Marker | null {
  if (typeof content !== 'string' || !content.startsWith(MARKER_PREFIX)) return null
  return JSON.parse(content.slice(MARKER_PREFIX.length)) as Marker
}

export const PROJECT = {
  name: 'northwind-web',
  path: '~/code/northwind-web',
  defaultBranch: 'main',
}

export const THREAD_BRANCH: Record<string, string> = {
  [HANDOFF_THREAD_ID]: 'fix/pricing-mobile',
  [DELEGATING_THREAD_ID]: 'feat/stripe-v2',
}

export type DelegatedTask = {
  id: string
  title: string
  status: 'done' | 'running'
  branch: string
  files: Array<{ path: string; added: number; removed: number }>
  minutes: number
  step?: string
}

export const DELEGATED_TASKS: DelegatedTask[] = [
  {
    id: 'stripe-api', title: 'Move checkout to the Payment Intents v2 API', status: 'done', branch: 'atlas/stripe-v2-api', minutes: 14,
    files: [
      { path: 'src/checkout/payment-intent.ts', added: 92, removed: 61 },
      { path: 'src/checkout/confirm.ts', added: 48, removed: 22 },
      { path: 'src/checkout/webhooks.ts', added: 37, removed: 9 },
      { path: 'src/checkout/types.ts', added: 18, removed: 4 },
      { path: 'package.json', added: 1, removed: 1 },
    ],
  },
  {
    id: 'stripe-e2e', title: 'Add end-to-end tests for the new checkout', status: 'running', branch: 'atlas/stripe-v2-e2e', minutes: 9,
    step: 'running the checkout tests', files: [],
  },
]

export const HANDOFF_FILES = [
  { path: 'src/components/PricingTable.tsx', added: 24, removed: 9 },
  { path: 'src/components/PricingTable.module.css', added: 31, removed: 4 },
  { path: 'src/components/PricingTable.test.tsx', added: 18, removed: 0 },
  { path: 'src/app/pricing/page.tsx', added: 3, removed: 2 },
]
export const HANDOFF_UNTRACKED = ['e2e/pricing-mobile.spec.ts', 'docs/pricing-breakpoints.md']
export const HANDOFF_EXCLUDED = ['.env.local', '.env.test', 'certs/dev.pem']

export const CLOUD_FILES = [
  { path: 'e2e/pricing-mobile.spec.ts', added: 12, removed: 3 },
  { path: 'src/components/PricingTable.tsx', added: 6, removed: 2 },
  { path: 'playwright.config.ts', added: 2, removed: 1 },
]

export const CONTEXT_PACKAGE = {
  version: 3,
  instructions: ['AGENTS.md', 'CLAUDE.md'],
  skills: ['run-e2e', 'release-notes'],
  mcpServers: ['Linear'],
  neededValues: [
    { name: 'STRIPE_SECRET_KEY', saved: false },
    { name: 'DATABASE_URL', saved: true },
  ],
}

// ---- Mockup state: where each thread runs and what has come back.

type State = {
  where: Record<string, Where>
  applied: Record<string, boolean>
}
let state: State = {
  where: { [HANDOFF_THREAD_ID]: 'cloud', [DELEGATING_THREAD_ID]: 'mac' },
  applied: {},
}
const listeners = new Set<() => void>()
function set(next: Partial<State>) {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useContinuity() {
  return useSyncExternalStore(subscribe, () => state, () => state)
}
export function moveThread(conversationId: string, where: Where) {
  set({ where: { ...state.where, [conversationId]: where } })
}
export function markApplied(taskId: string) {
  set({ applied: { ...state.applied, [taskId]: true } })
}
export function isProjectThread(conversationId: string | null | undefined): conversationId is string {
  return Boolean(conversationId && conversationId in THREAD_BRANCH)
}
