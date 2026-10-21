'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import { Button, Input, Textarea } from '@overlay/ui/primitives'
import { AgentCreature } from '@/components/orb/Creature'
import { onboardingList, type OnboardingEmployee } from '@/shared/onboarding/session'

const COLORS = ['#6f8796', '#7a8b88']

export function OnboardingEmployees({ suggested, disabled, onConfirm, onSkip }: {
  suggested: OnboardingEmployee[]
  disabled: boolean
  onConfirm(employees: OnboardingEmployee[]): void
  onSkip(): void
}) {
  const [employees, setEmployees] = useState(suggested)
  const [included, setIncluded] = useState(() => suggested.map(() => true))
  const [editing, setEditing] = useState<number | null>(null)
  const chosen = employees.filter((_, index) => included[index])
  const valid = chosen.length > 0 && chosen.every((employee) => employee.name.trim() && employee.role.trim()) && editing === null
  const toggle = (index: number) => setIncluded((current) => current.map((value, i) => (i === index ? !value : value)))
  const update = (index: number, patch: Partial<OnboardingEmployee>) => setEmployees((current) => current.map((employee, i) => (i === index ? { ...employee, ...patch } : employee)))
  return (
    <div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {employees.map((employee, index) => (
          // The whole card toggles for pointer users; the corner checkbox stays the keyboard and screen-reader control.
          <div
            key={index}
            onClick={(event) => {
              if (disabled || editing === index || (event.target as HTMLElement).closest('button, input, textarea')) return
              toggle(index)
            }}
            className={`relative rounded-xl border bg-(--surface-elevated) p-3.5 transition-[opacity,border-color] ${editing === index ? '' : 'cursor-pointer'} ${included[index] ? 'border-(--muted-light)' : 'border-(--border) opacity-55 hover:opacity-80'}`}
          >
            <Button
              variant="outline"
              size="icon-xs"
              role="checkbox"
              aria-checked={included[index]}
              aria-label={`Include ${employee.name || 'this employee'}`}
              disabled={disabled}
              onClick={() => toggle(index)}
              className={`absolute top-3 right-3 size-[18px] rounded-full ${included[index] ? 'border-primary bg-primary text-primary-foreground hover:bg-primary' : ''}`}
            >
              {included[index] ? <Check className="size-3" strokeWidth={2.5} aria-hidden /> : null}
            </Button>
            <div className="flex items-center gap-2.5 pr-6">
              <AgentCreature agent={{ name: employee.name, avatarColor: COLORS[index % COLORS.length] }} size={28} />
              <span className="truncate text-sm font-medium">{employee.name}</span>
            </div>
            {editing === index ? (
              <div className="mt-2.5 grid gap-1.5">
                <Input aria-label="Name" value={employee.name} maxLength={60} onChange={(event) => update(index, { name: event.target.value })} className="h-8 text-[13px]" />
                <Textarea aria-label="Responsibilities" value={employee.role} maxLength={240} rows={3} onChange={(event) => update(index, { role: event.target.value })} className="text-[13px]" />
              </div>
            ) : <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{employee.role}</p>}
            <Button
              variant="ghost"
              size="xs"
              disabled={disabled || (editing === index && (!employee.name.trim() || !employee.role.trim()))}
              onClick={() => setEditing(editing === index ? null : index)}
              className="mt-2 -ml-2"
            >
              {editing === index ? 'Done' : 'Edit'}
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-3.5 flex items-center gap-2">
        <Button variant="primary" size="sm" disabled={disabled || !valid} onClick={() => onConfirm(chosen)}>
          {chosen.length === employees.length && chosen.length > 1 ? 'Add both' : chosen.length ? `Add ${onboardingList(chosen.map((employee) => employee.name))}` : 'Add employees'}
        </Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={onSkip}>Not now</Button>
      </div>
    </div>
  )
}
