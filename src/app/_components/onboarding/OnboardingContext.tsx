'use client'

import { useState } from 'react'
import { Check, Copy, LockKeyhole } from 'lucide-react'
import { Button, Input, Textarea } from '@overlay/ui/primitives'

export const CONTEXT_IMPORT_PROMPT = 'Help me prepare a context brief for a new work assistant. Using information available to you, summarize my role, current projects, goals, working preferences, and recurring tasks. Separate facts I explicitly shared from your inferences. Exclude passwords, API keys, financial or health details, and private information about other people. Do not invent missing information. Format the brief so I can review and edit it before sharing.'

export function OnboardingContext({ disabled, onSave, onSkip }: { disabled: boolean; onSave(text: string): void; onSkip(): void }) {
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-muted/25 p-4">
        <p className="text-sm leading-6 text-muted-foreground">{CONTEXT_IMPORT_PROMPT}</p>
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => { void navigator.clipboard.writeText(CONTEXT_IMPORT_PROMPT).then(() => { setCopied(true); setCopyError(false) }, () => setCopyError(true)) }}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? 'Copied' : 'Copy prompt'}</Button>
        {copyError ? <p role="alert" className="mt-2 text-xs">Select the prompt above and copy it manually.</p> : null}
      </div>
      <Textarea aria-label="Context to save as Personal memories" value={text} onChange={(event) => setText(event.target.value)} maxLength={20000} disabled={disabled} placeholder="Paste the response here. Review and edit it before saving." rows={6} />
      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" />Saved as Personal memories, not shared with teammates or sent to MiniMax. Imported text is context, not permission to take action.</p>
      <div className="flex justify-end gap-2"><Button variant="ghost" disabled={disabled} onClick={onSkip}>Skip for now</Button><Button disabled={disabled || !text.trim()} onClick={() => onSave(text.trim())}>Save Personal context</Button></div>
    </div>
  )
}

export function OnboardingInvites({ disabled, onInvite, onSkip }: { disabled: boolean; onInvite(emails: string[]): void; onSkip(): void }) {
  const [emails, setEmails] = useState('')
  const values = [...new Set(emails.split(/[,;\s]+/).filter(Boolean).map((email) => email.toLowerCase()))]
  const valid = values.length > 0 && values.length <= 5 && values.every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  return (
    <div className="space-y-4">
      <Input aria-label="Teammate email addresses" placeholder="teammate@company.com" value={emails} onChange={(event) => setEmails(event.target.value)} disabled={disabled} maxLength={1600} />
      <p className="text-xs text-muted-foreground">Invite up to five teammates as members. Separate email addresses with commas. Your Personal memories stay private.</p>
      <div className="flex justify-end gap-2"><Button variant="ghost" disabled={disabled} onClick={onSkip}>Skip for now</Button><Button disabled={disabled || !valid} onClick={() => onInvite(values)}>Send invitations</Button></div>
    </div>
  )
}
