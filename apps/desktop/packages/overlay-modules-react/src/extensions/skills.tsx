'use client'

import type {
SkillFormValues,
SkillSummary
} from '@overlay/app-core'
import { skillToFormValues } from '@overlay/app-core/extensions'
import {
Check,
Loader2,
Pencil,
Plus,
Sparkles,
ToggleLeft,
ToggleRight,
Trash2,
X
} from 'lucide-react'
import { useEffect,useRef,useState,type MouseEvent } from 'react'

import { Field } from './shared'
import { AppScreenBody } from '../shell'

export interface SkillDialogProps {
  state: { mode: 'create' | 'edit'; skill?: SkillSummary }
  onClose: () => void
  onSave: (values: SkillFormValues) => Promise<boolean | void>
  onDelete: (skill: SkillSummary) => Promise<boolean | void>
}

export function SkillDialog({ state, onClose, onSave, onDelete }: SkillDialogProps) {
  const isEdit = state.mode === 'edit'
  const initial = state.skill
  const [values, setValues] = useState<SkillFormValues>(() => skillToFormValues(initial))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saved, setSaved] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [])

  const update = <Key extends keyof SkillFormValues>(key: Key, value: SkillFormValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      const ok = await onSave(values)
      if (ok === false) return
      setSaved(true)
      window.setTimeout(() => {
        setSaved(false)
        onClose()
      }, 800)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!isEdit || !initial || deleting) return
    setDeleting(true)
    try {
      const ok = await onDelete(initial)
      if (ok !== false) onClose()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="overlay-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="overlay-dialog-in flex w-full max-w-xl flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-xl" style={{ maxHeight: 'calc(100vh - 80px)' }}>
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h3 className="text-sm font-medium text-[var(--foreground)]">{isEdit ? 'Edit Skill' : 'New Skill'}</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <Field label="Name">
            <input
              ref={nameRef}
              value={values.name}
              onChange={(event) => update('name', event.target.value)}
              placeholder="e.g. Concise Responder"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-light)] focus:border-[var(--muted)] focus:bg-[var(--surface-elevated)]"
            />
          </Field>

          <Field label="Description">
            <input
              value={values.description}
              onChange={(event) => update('description', event.target.value)}
              placeholder="Brief description of what this skill does"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-light)] focus:border-[var(--muted)] focus:bg-[var(--surface-elevated)]"
            />
          </Field>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--muted-light)]">Instructions</label>
              <span className="text-[10px] text-[var(--muted-light)]">Markdown supported</span>
            </div>
            <textarea
              value={values.instructions}
              onChange={(event) => update('instructions', event.target.value)}
              placeholder={'Describe what the AI should do differently when this skill is active.\n\nExample:\n- Always respond in bullet points\n- Keep answers under 3 sentences\n- Use a formal tone'}
              rows={12}
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 font-mono text-xs leading-relaxed text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-light)] focus:border-[var(--muted)] focus:bg-[var(--surface-elevated)]"
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] px-5 py-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => update('enabled', !values.enabled)} className="flex items-center gap-1.5 text-xs text-[var(--muted)] transition-colors hover:text-[var(--foreground)]">
              {values.enabled
                ? <ToggleRight size={18} className="text-[var(--foreground)]" />
                : <ToggleLeft size={18} className="text-[var(--muted-light)]" />}
              <span>{values.enabled ? 'Active' : 'Disabled'}</span>
            </button>
            {isEdit && initial ? (
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="flex items-center gap-1 text-xs text-[var(--muted)] transition-colors hover:text-red-400 disabled:opacity-50"
              >
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Delete
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-1.5 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--border)] disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <Check size={12} /> : null}
            {saving ? 'Saving…' : saved ? 'Saved' : isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

export interface SkillsPanelProps {
  loading: boolean
  skills: readonly SkillSummary[]
  filteredSkills: readonly SkillSummary[]
  onCreate: () => void
  onEdit: (skill: SkillSummary) => void
  onToggle: (skill: SkillSummary, event: MouseEvent) => void
}

export function SkillsPanel({ loading, skills, filteredSkills, onCreate, onEdit, onToggle }: SkillsPanelProps) {
  if (loading) {
    return (
      <AppScreenBody padding="none" maxWidth="none" className="flex h-full items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--muted)]" />
      </AppScreenBody>
    )
  }

  if (skills.length === 0) {
    return (
      <AppScreenBody padding="none" maxWidth="none" className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <Sparkles size={40} strokeWidth={1} className="text-[var(--muted-light)]" />
        <div className="space-y-1 text-center">
          <p className="text-sm font-medium text-[var(--foreground)]">No skills yet</p>
          <p className="text-xs text-[var(--muted-light)]">Create reusable instructions that are automatically injected into every conversation</p>
        </div>
        <button
          onClick={onCreate}
          className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--border)]"
        >
          <Plus size={14} />
          New Skill
        </button>
      </AppScreenBody>
    )
  }

  return (
    <AppScreenBody padding="none" maxWidth="none" className="h-full">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSkills.map((skill) => (
            <SkillCard key={skill._id} skill={skill} onEdit={onEdit} onToggle={onToggle} />
          ))}
        </div>
      </div>
    </AppScreenBody>
  )
}

function SkillCard({
  skill,
  onEdit,
  onToggle,
}: {
  skill: SkillSummary
  onEdit: (skill: SkillSummary) => void
  onToggle: (skill: SkillSummary, event: MouseEvent) => void
}) {
  return (
    <div
      onClick={() => onEdit(skill)}
      className="group relative cursor-pointer rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4 transition-all hover:bg-[var(--surface-muted)] hover:shadow-sm"
    >
      <span
        className={`absolute right-4 top-4 h-2 w-2 rounded-full transition-colors ${skill.enabled !== false ? 'bg-[var(--foreground)]' : 'bg-[var(--muted-light)]'}`}
        title={skill.enabled !== false ? 'Active' : 'Disabled'}
      />

      <div className="mb-3 flex items-start gap-2 pr-6">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--surface-subtle)]">
          <Sparkles size={13} className="text-[var(--muted)]" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--foreground)]">{skill.name || 'Untitled'}</p>
          {skill.description ? (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--muted)]">{skill.description}</p>
          ) : null}
        </div>
      </div>

      {skill.instructions ? (
        <p className="line-clamp-2 font-mono text-[10px] text-[var(--muted-light)]">{skill.instructions}</p>
      ) : null}

      <div className="absolute bottom-3 right-3 hidden items-center gap-1 group-hover:flex">
        <button
          type="button"
          onClick={(event) => onToggle(skill, event)}
          className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
          title={skill.enabled !== false ? 'Disable' : 'Enable'}
        >
          {skill.enabled !== false ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onEdit(skill)
          }}
          className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
          title="Edit"
        >
          <Pencil size={13} />
        </button>
      </div>
    </div>
  )
}
