'use client'

import { useState, type ReactNode } from 'react'
import { Check, Copy, LockKeyhole, X } from 'lucide-react'
import { Button, Input, Textarea } from '@overlay/ui/primitives'

export const CONTEXT_IMPORT_PROMPT = 'Help me prepare a context brief for a new work assistant. Summarize my role, current projects, goals, working preferences, and recurring tasks. Separate facts I told you from your inferences. Leave out passwords, keys, financial or health details, and private information about other people. Do not invent missing information.'

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[20px_1fr] gap-2.5">
      <span className="grid size-5 place-items-center rounded-full bg-(--surface-subtle) text-[11px] font-medium text-muted-foreground">{number}</span>
      <div className="min-w-0"><p className="text-sm">{title}</p>{children}</div>
    </div>
  )
}

export function OnboardingContext({ disabled, onSave, onSkip }: { disabled: boolean; onSave(text: string): void; onSkip(): void }) {
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(CONTEXT_IMPORT_PROMPT).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }, () => setCopied(false))
  }
  return (
    <div>
      <div className="space-y-3.5 rounded-xl border border-(--border) bg-(--surface-elevated) p-3.5">
        <Step number={1} title="Ask ChatGPT, Claude, or Gemini this">
          <p className="mt-2 line-clamp-2 rounded-lg bg-(--surface-muted) px-3 py-2.5 text-xs leading-[18px] text-muted-foreground">{CONTEXT_IMPORT_PROMPT}</p>
          <Button variant="secondary" size="xs" className="mt-2 h-7 px-2.5" onClick={copy}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? 'Copied' : 'Copy prompt'}</Button>
        </Step>
        <Step number={2} title="Paste its reply">
          <Textarea aria-label="Context to save as Personal memories" value={text} onChange={(event) => setText(event.target.value)} maxLength={20000} disabled={disabled} rows={4} placeholder="Review it before saving. You can remove anything." className="mt-2 text-[13px]" />
        </Step>
      </div>
      <p className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground"><LockKeyhole className="size-3.5 shrink-0" aria-hidden />Saved as Personal memories. Only you can see them.</p>
      <div className="mt-3.5 flex items-center gap-2">
        <Button variant="primary" size="sm" disabled={disabled || !text.trim()} onClick={() => onSave(text.trim())}>Save context</Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={onSkip}>Not now</Button>
      </div>
    </div>
  )
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_INVITES = 5

export function OnboardingInvites({ disabled, onInvite, onSkip }: { disabled: boolean; onInvite(emails: string[]): void; onSkip(): void }) {
  const [emails, setEmails] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [invalid, setInvalid] = useState<string | null>(null)
  /** Moves valid addresses from the draft into tokens; returns the full list, or null if something needs fixing. */
  const commit = (): string[] | null => {
    const parts = draft.split(/[,;\s]+/).map((value) => value.trim().toLowerCase()).filter(Boolean)
    const bad = parts.filter((value) => !EMAIL.test(value))
    const next = [...new Set([...emails, ...parts.filter((value) => EMAIL.test(value))])].slice(0, MAX_INVITES)
    setEmails(next)
    setDraft(bad.join(' '))
    setInvalid(bad[0] ?? null)
    return bad.length ? null : next
  }
  return (
    <div>
      <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-xl border border-(--border) bg-(--surface-elevated) p-1.5 focus-within:border-(--muted-light)">
        {emails.map((email) => (
          <span key={email} className="inline-flex h-[26px] items-center gap-1 rounded-full bg-(--surface-subtle) pr-1 pl-2.5 text-xs">
            {email}
            <Button variant="ghost" size="icon-xs" className="size-[18px] rounded-full" aria-label={`Remove ${email}`} disabled={disabled} onClick={() => setEmails((current) => current.filter((value) => value !== email))}><X className="size-3" /></Button>
          </span>
        ))}
        <Input
          type="email"
          aria-label="Teammate email addresses"
          placeholder={emails.length ? '' : 'name@company.com'}
          value={draft}
          disabled={disabled || emails.length >= MAX_INVITES}
          onChange={(event) => { setDraft(event.target.value); setInvalid(null) }}
          onBlur={() => { commit() }}
          onKeyDown={(event) => {
            if (['Enter', ',', ' ', 'Tab'].includes(event.key) && draft.trim()) { event.preventDefault(); commit() }
            if (event.key === 'Backspace' && !draft && emails.length) setEmails((current) => current.slice(0, -1))
          }}
          className="h-7 min-w-40 flex-1 border-0 bg-transparent px-1.5 text-[13px] shadow-none focus-visible:ring-0"
        />
      </div>
      {invalid ? <p role="alert" className="mt-2 text-xs text-destructive">Check {invalid}</p> : null}
      <div className="mt-3.5 flex items-center gap-2">
        <Button variant="primary" size="sm" disabled={disabled || (!emails.length && !EMAIL.test(draft.trim()))} onClick={() => { const list = commit(); if (list?.length) onInvite(list) }}>Send invites</Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={onSkip}>Not now</Button>
      </div>
    </div>
  )
}

export function OnboardingTaskPreview({ title, disabled, onCreate, onChange }: { title: string; disabled: boolean; onCreate(): void; onChange(): void }) {
  return (
    <div>
      <div className="rounded-xl border border-(--border) bg-(--surface-elevated) p-3.5">
        <p className="text-[11px] font-medium text-muted-foreground">New task</p>
        <p className="mt-1 text-sm font-medium break-words">{title}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">Personal · Unassigned · Won&apos;t start until you assign it</p>
      </div>
      <div className="mt-3.5 flex items-center gap-2">
        <Button variant="primary" size="sm" disabled={disabled} onClick={onCreate}>Create task</Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={onChange}>Change</Button>
      </div>
    </div>
  )
}
