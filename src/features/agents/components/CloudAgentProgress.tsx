'use client'

import { Check, Loader2 } from 'lucide-react'
import { CLOUD_AGENT_STARTUP_STEPS, type CloudAgentPhase } from '@/shared/agents/cloud-agent'

/** The steps of a machine starting, with the current one marked. */
export function CloudAgentProgress({ phase }: { phase: CloudAgentPhase }) {
  const current = Math.max(0, CLOUD_AGENT_STARTUP_STEPS.findIndex((step) => step.phase === phase))
  return (
    <ol aria-label="Starting your agent" className="space-y-2.5 py-2">
      {CLOUD_AGENT_STARTUP_STEPS.map((step, index) => {
        const done = index < current || phase === 'ready'
        const active = index === current && phase !== 'ready'
        return (
          <li key={step.phase} className={`flex items-center gap-2.5 text-sm ${done || active ? 'text-[var(--foreground)]' : 'text-[var(--muted)]'}`}>
            <span className="flex h-5 w-5 items-center justify-center">
              {done ? <Check size={14} className="text-[var(--muted)]" /> : active ? <Loader2 size={14} className="animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-[var(--border)]" />}
            </span>
            {step.label}
          </li>
        )
      })}
    </ol>
  )
}
