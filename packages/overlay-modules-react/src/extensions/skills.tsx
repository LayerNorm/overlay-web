'use client'
import type {
SkillFormValues,
SkillSummary
} from '@overlay/app-core'
import { skillToFormValues } from '@overlay/app-core/extensions'
import { Check, Loader2, PenLine } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button, Input, Textarea } from '@overlay/ui'

import { DeleteExtensionButton, ExtensionDialog, Field } from './shared'

export interface SkillDialogProps {
  /** `preset` fills a new skill from a template. */
  state: { mode: 'create' | 'edit'; skill?: SkillSummary; preset?: Partial<SkillFormValues> }
  onClose: () => void
  onSave: (values: SkillFormValues) => Promise<boolean | void>
  onDelete: (skill: SkillSummary) => Promise<boolean | void>
  /** Move and archive controls for an existing skill, supplied by the host (they depend on who is viewing). */
  scopeActions?: ReactNode
  /** The viewer may read but not change this skill: fields are read-only and there is no Save or Delete. */
  readOnly?: boolean
}

export function SkillDialog({ state, onClose, onSave, onDelete, scopeActions, readOnly = false }: SkillDialogProps) {
  const isEdit = state.mode === 'edit'
  const initial = state.skill
  const [values, setValues] = useState<SkillFormValues>(() => ({ ...skillToFormValues(initial), ...state.preset }))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = <Key extends keyof SkillFormValues>(key: Key, value: SkillFormValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  async function handleSave() {
    if (saving || deleting || saved) return
    setError(null)
    setSaving(true)
    try {
      const ok = await onSave(values)
      if (ok === false) { setError('Could not save this skill.'); return }
      setSaved(true)
      window.setTimeout(() => {
        setSaved(false)
        onClose()
      }, 800)
    } catch {
      setError('Could not save this skill.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!isEdit || !initial || deleting || saving || saved) return
    setError(null)
    setDeleting(true)
    try {
      const ok = await onDelete(initial)
      if (ok !== false) onClose()
      else setError('Could not delete this skill.')
    } catch {
      setError('Could not delete this skill.')
    } finally {
      setDeleting(false)
    }
  }

  const scopeLabel = initial?.archivedAt !== undefined ? 'Archived' : (initial?.scope ?? 'personal') === 'workspace' ? 'Shared with the workspace' : 'Only you'

  const busy = saving || deleting || saved

  return (
    <ExtensionDialog
      title={isEdit ? initial?.name || 'Edit skill' : 'New skill'}
      description="Instructions your agents can use."
      icon={<PenLine size={20} strokeWidth={1.6} />}
      onClose={onClose} busy={busy} locked={readOnly}
      enabled={values.enabled} onEnabledChange={enabled => update('enabled', enabled)}
      activeDescription="Make this skill available to your agents."
      scopeActions={isEdit && !readOnly ? scopeActions : undefined} scopeLabel={readOnly ? `${scopeLabel} · View only` : scopeLabel}
      footer={<>
        <div>{isEdit && initial && !readOnly ? <DeleteExtensionButton name={initial.name || 'this skill'} kind="skill" disabled={busy} onConfirm={() => void handleDelete()} /> : null}</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {readOnly ? null : <Button variant="primary" onClick={() => void handleSave()} disabled={busy || !values.name.trim()}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
            {saving ? 'Saving...' : saved ? 'Saved' : isEdit ? 'Save changes' : 'Create skill'}
          </Button>}
        </div>
      </>}
    >
      <Field label="Name"><Input aria-label="Name" readOnly={readOnly} value={values.name} onChange={event => update('name', event.target.value)} placeholder="My skill" /></Field>
      <Field label="Description"><Input aria-label="Description" readOnly={readOnly} value={values.description} onChange={event => update('description', event.target.value)} placeholder="What should this skill help with?" /></Field>
      <Field label="Instructions"><Textarea aria-label="Instructions" readOnly={readOnly} value={values.instructions} onChange={event => update('instructions', event.target.value)} placeholder="Describe how your agent should approach this work." className="min-h-50 resize-y rounded-md text-sm leading-relaxed" /></Field>
      <p className="text-xs text-(--muted)">Markdown is supported.</p>
      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
    </ExtensionDialog>
  )
}
