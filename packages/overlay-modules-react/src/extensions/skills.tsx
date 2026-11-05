'use client'
import type {
SkillFormValues,
SkillSummary
} from '@overlay/app-core'
import { skillToFormValues } from '@overlay/app-core/extensions'
import { Check, Loader2, Plus, Sparkles, BookOpen, PenLine } from 'lucide-react'
import { useState,type MouseEvent,type ReactNode } from 'react'
import { Button, Input, Textarea } from '@overlay/ui'

import { DeleteExtensionButton, ExtensionCard, ExtensionDialog, Field } from './shared'
import { AppScreenBody } from '../shell'

export interface SkillDialogProps {
  state: { mode: 'create' | 'edit'; skill?: SkillSummary }
  onClose: () => void
  onSave: (values: SkillFormValues) => Promise<boolean | void>
  onDelete: (skill: SkillSummary) => Promise<boolean | void>
  /** Move and archive controls for an existing skill, supplied by the host (they depend on who is viewing). */
  scopeActions?: ReactNode
  readOnly?: boolean
}

export function SkillDialog({ state, onClose, onSave, onDelete, scopeActions, readOnly = false }: SkillDialogProps) {
  const isEdit = state.mode === 'edit'
  const initial = state.skill
  const [values, setValues] = useState<SkillFormValues>(() => skillToFormValues(initial))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = <Key extends keyof SkillFormValues>(key: Key, value: SkillFormValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  async function handleSave() {
    if (readOnly || saving || deleting || saved) return
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
    if (readOnly || !isEdit || !initial || deleting || saving || saved) return
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
      onClose={onClose} busy={busy}
      enabled={values.enabled} onEnabledChange={enabled => { if (!readOnly) update('enabled', enabled) }}
      activeDescription="Make this skill available to your agents."
      scopeActions={isEdit ? scopeActions : undefined} scopeLabel={scopeLabel}
      footer={<>
        <div>{isEdit && initial && !readOnly ? <DeleteExtensionButton name={initial.name || 'this skill'} kind="skill" disabled={busy} onConfirm={() => void handleDelete()} /> : null}</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={readOnly || busy || !values.name.trim()}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
            {saving ? 'Saving...' : saved ? 'Saved' : isEdit ? 'Save changes' : 'Create skill'}
          </Button>
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

export interface SkillsPanelProps {
  loading: boolean
  skills: readonly SkillSummary[]
  filteredSkills: readonly SkillSummary[]
  /** Omitted when the person may not create here (the empty state then offers no button). */
  onCreate?: () => void
  onEdit: (skill: SkillSummary) => void
  onToggle: (skill: SkillSummary, event: MouseEvent) => void
}

export function SkillsPanel({ loading, skills, filteredSkills, onCreate, onEdit }: SkillsPanelProps) {
  if (loading) {
    return (
      <AppScreenBody padding="none" maxWidth="none" className="flex h-full items-center justify-center">
        <Loader2 size={20} className="animate-spin text-(--muted)" />
      </AppScreenBody>
    )
  }

  if (skills.length === 0) {
    return (
      <AppScreenBody padding="none" maxWidth="none" className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <Sparkles size={40} strokeWidth={1} className="text-(--muted-light)" />
        <div className="space-y-1 text-center">
          <p className="text-sm font-medium text-(--foreground)">No skills yet</p>
          <p className="text-xs text-(--muted-light)">Create reusable instructions that are automatically injected into every conversation</p>
        </div>
        {onCreate ? (
          <Button variant="secondary" size="md" type="button"
            onClick={onCreate}
          >
            <Plus size={14} />
            New Skill
          </Button>
        ) : null}
      </AppScreenBody>
    )
  }

  return (
    <AppScreenBody padding="none" maxWidth="none" className="h-full">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredSkills.map((skill) => (
            <SkillCard key={skill._id} skill={skill} onEdit={onEdit} />
          ))}
        </div>
      </div>
    </AppScreenBody>
  )
}

function SkillCard({ skill, onEdit }: { skill: SkillSummary; onEdit: (skill: SkillSummary) => void }) {
  return <ExtensionCard
    icon={<PenLine size={20} strokeWidth={1.6} />}
    title={skill.name || 'Untitled'}
    description={skill.description}
    status={skill.enabled !== false ? 'Active' : 'Inactive'}
    statusTone={skill.enabled !== false ? 'active' : 'muted'}
    metadata={<><BookOpen size={14} />Agent instructions</>}
    detail={(skill.scope ?? 'personal') === 'workspace' ? 'Workspace skill' : 'Personal skill'}
    onEdit={() => onEdit(skill)}
  />
}
