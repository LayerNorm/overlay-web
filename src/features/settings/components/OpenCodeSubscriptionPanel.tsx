'use client'

import { useRef, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Button, Input } from '@overlay/ui/primitives'
import { getByokPreset } from '@overlay/llm-gateway'

/**
 * OpenCode sells access through an account API key rather than an OAuth
 * sign-in, so it is offered beside the subscription providers but saved as an
 * ordinary personal API-key connection on the locked OpenCode presets.
 */
export const OPENCODE_SUBSCRIPTION_ID = 'opencode'

export const OPENCODE_SUBSCRIPTION_OPTION = {
  id: OPENCODE_SUBSCRIPTION_ID,
  label: 'OpenCode',
  description: 'Connect an OpenCode Go or Zen API key.',
  enabled: true,
} as const

export type OpenCodePlan = 'opencode-go' | 'opencode-zen'

const PLANS: ReadonlyArray<{ id: OpenCodePlan; label: string; hint: string; keyUrl: string }> = [
  { id: 'opencode-go', label: 'Go', hint: 'Uses your OpenCode Go plan limits.', keyUrl: 'https://opencode.ai/go' },
  { id: 'opencode-zen', label: 'Zen', hint: 'Pay as you go from your OpenCode credit balance.', keyUrl: 'https://opencode.ai/zen' },
]

type TestResult = { ok: boolean; models?: Array<{ id: string; name: string }>; error?: string }

export async function connectOpenCodeKey(plan: OpenCodePlan, apiKey: string): Promise<{ displayName: string; enabledModelIds: string[] }> {
  const preset = getByokPreset(plan)
  if (!preset) throw new Error('OpenCode is not available on this deployment.')
  const testResponse = await fetch('/api/v1/providers/connections/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId: plan, endpoint: preset.defaultBaseURL, apiKey }),
  })
  const test = await testResponse.json().catch(() => null) as TestResult | null
  if (!test?.ok) throw new Error(test?.error ?? 'Could not check the OpenCode API key.')
  const models = test.models ?? []
  if (models.length === 0) throw new Error('OpenCode returned no chat models for this key.')
  const enabledModelIds = models.map((model) => model.id)

  const createResponse = await fetch('/api/v1/providers/connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ providerId: plan, endpoint: preset.defaultBaseURL, displayName: preset.label, apiKey, enabledModelIds }),
  })
  const created = await createResponse.json().catch(() => null) as { id?: string } | null
  if (!createResponse.ok || !created?.id) throw new Error('Could not save the OpenCode connection.')

  const now = Date.now()
  await fetch('/api/v1/providers/connections', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connectionId: created.id,
      status: 'active',
      lastTestedAt: now,
      discoveredModelsJson: JSON.stringify({ data: models }),
      discoveredAt: now,
    }),
  })
  return { displayName: preset.label, enabledModelIds }
}

export function useOpenCodeConnection(onConnected: () => Promise<void> | void) {
  const [plan, setPlan] = useState<OpenCodePlan>('opencode-go')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState<{ displayName: string; enabledModelIds: string[] } | null>(null)
  const working = useRef(false)

  const connect = async () => {
    const key = apiKey.trim()
    if (!key || working.current) return
    working.current = true
    setBusy(true)
    setError(null)
    try {
      setConnected(await connectOpenCodeKey(plan, key))
      setApiKey('')
      await onConnected()
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Could not connect OpenCode.')
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  return { plan, setPlan, apiKey, setApiKey, busy, error, connected, connect, canConnect: Boolean(apiKey.trim()) && !busy }
}

export function OpenCodeKeyPanel({ openCode }: { openCode: ReturnType<typeof useOpenCodeConnection> }) {
  const selected = PLANS.find((plan) => plan.id === openCode.plan) ?? PLANS[0]
  return <div className="space-y-3">
    <fieldset className="space-y-2" disabled={openCode.busy}>
      <legend className="mb-2 text-xs font-medium">Plan</legend>
      <div className="flex gap-1 rounded-lg bg-(--surface-muted) p-1">
        {PLANS.map((plan) => <Button key={plan.id} type="button" variant={openCode.plan === plan.id ? 'secondary' : 'ghost'} size="sm" className="flex-1" aria-pressed={openCode.plan === plan.id} disabled={openCode.busy} onClick={() => openCode.setPlan(plan.id)}>{plan.label}</Button>)}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{selected.hint} Only you can use this connection.</p>
    </fieldset>
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor="opencode-api-key" className="text-xs font-medium">API key</label>
        <a href={selected.keyUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">Get a key<ArrowUpRight size={12} /></a>
      </div>
      <Input
        id="opencode-api-key"
        type="password"
        autoComplete="off"
        spellCheck={false}
        maxLength={16384}
        value={openCode.apiKey}
        disabled={openCode.busy}
        placeholder="sk-..."
        onChange={(event) => openCode.setApiKey(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') void openCode.connect() }}
      />
    </div>
  </div>
}
