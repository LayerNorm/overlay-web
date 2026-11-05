'use client'

import {
  Trace,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@overlay/ui/ai'
import { Circle, CircleCheck, CircleDot, CircleHelp, CircleMinus, CircleSlash, Route, type LucideIcon } from 'lucide-react'

export type RunPlanStep = {
  id: string
  title: string
  status: string
}

export type RunPlanPhase = 'active' | 'waiting' | 'ended'

type StepView = {
  Icon: LucideIcon
  line?: 'running' | 'pending'
  iconClassName?: string
  note?: string
}

function isSettled(step: RunPlanStep): boolean {
  return step.status === 'done' || step.status === 'skipped'
}

function stepView(step: RunPlanStep, current: boolean, phase: RunPlanPhase): StepView {
  if (step.status === 'done') return { Icon: CircleCheck, iconClassName: 'text-(--success)' }
  if (step.status === 'skipped') return { Icon: CircleMinus, note: 'skipped' }
  if (current && phase === 'waiting') return { Icon: CircleHelp, line: 'running', note: 'waiting for your answer' }
  if (current && phase === 'ended') return { Icon: CircleSlash, note: 'stopped' }
  if (current) return { Icon: CircleDot, line: 'running' }
  return { Icon: Circle, line: 'pending' }
}

function currentStepId(steps: readonly RunPlanStep[]): string | undefined {
  return (steps.find(step => step.status === 'running') ?? steps.find(step => !isSettled(step)))?.id
}

/** Once a response has ended with every step settled, the plan moves into the "Worked for" dropdown. */
export function isRunPlanSettled(steps: readonly RunPlanStep[], phase: RunPlanPhase): boolean {
  return phase === 'ended' && steps.length > 0 && steps.every(isSettled)
}

export function RunPlan({ steps, phase }: { steps: readonly RunPlanStep[]; phase: RunPlanPhase }) {
  const current = currentStepId(steps)
  return (
    <Trace className="max-w-[min(100%,36rem)] gap-1.5 py-2">
      <TraceLine>
        <TraceIcon><Route /></TraceIcon>
        <TraceTitle className="text-foreground">Plan</TraceTitle>
        <TraceDescription>{`${steps.filter(isSettled).length} of ${steps.length} done`}</TraceDescription>
      </TraceLine>
      <ol className="flex flex-col gap-1.5" aria-label="Plan steps">
        {steps.map((step) => {
          const { Icon, line, iconClassName, note } = stepView(step, step.id === current, phase)
          return (
            <li key={step.id}>
              <TraceLine status={line} className={line === 'running' ? 'text-foreground' : undefined}>
                <TraceIcon className={iconClassName}><Icon /></TraceIcon>
                <TraceTitle className="whitespace-normal">
                  {step.title}
                  {note ? <span className="text-(--muted)"> · {note}</span> : null}
                </TraceTitle>
              </TraceLine>
            </li>
          )
        })}
      </ol>
    </Trace>
  )
}
