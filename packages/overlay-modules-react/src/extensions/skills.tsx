'use client'
import { unstyledButton, unstyledInput, unstyledTextarea } from '@overlay/ui/control-reset'
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
import { useEffect,useRef,useState,type MouseEvent,type ReactNode } from 'react'
import { Tile, TileIcon, TileGrid, Button, Input, Textarea } from '@overlay/ui/primitives'
import { Dialog, DialogContent } from '@overlay/ui'

import { EnabledToggle, Field } from './shared'
import { AppScreenBody } from '../shell'

export interface SkillDialogProps {
  state: { mode: 'create' | 'edit'; skill?: SkillSummary }
  onClose: () => void
  onSave: (values: SkillFormValues) => Promise<boolean | void>
  onDelete: (skill: SkillSummary) => Promise<boolean | void>
  /** Move and archive controls for an existing skill, supplied by the host (they depend on who is viewing). */
  scopeActions?: ReactNode
}

export function SkillDialog({ state, onClose, onSave, onDelete, scopeActions }: SkillDialogProps) {
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

  const scopeLabel = initial?.archivedAt !== undefined ? 'Archived' : (initial?.scope ?? 'personal') === 'workspace' ? 'Shared with the workspace' : 'Only you'

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="overlay-backdrop-in z-50 bg-(--overlay-scrim) p-4"
        aria-labelledby="skill-dialog-title"
        className="overlay-dialog-in flex w-[calc(100%-2rem)] max-w-xl gap-0 flex-col p-0"
        style={{ maxHeight: 'calc(100vh - 80px)' }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-(--border) px-5 py-4">
          <h3 id="skill-dialog-title" className="text-sm font-medium text-(--foreground)">{isEdit ? 'Edit Skill' : 'New Skill'}</h3>
          <Button variant="ghost" type="button" aria-label="Close" onClick={onClose} className={unstyledButton("rounded-sm p-1 text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)")}>
            <X size={16} />
          </Button>
        </div>
        {isEdit && scopeActions ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-(--border) px-5 py-3">
            <span className="text-xs text-(--muted)">{scopeLabel}</span>
            {scopeActions}
          </div>
        ) : null}

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <Field label="Name">
            <Input
              ref={nameRef}
              aria-label="Name"
              value={values.name}
              onChange={(event) => update('name', event.target.value)}
              placeholder="e.g. Concise Responder"
              className={unstyledInput("w-full rounded-lg border border-(--border) bg-(--surface-muted) px-3 py-2 text-sm text-(--foreground) outline-hidden transition-colors placeholder:text-(--muted-light) focus:border-(--muted) focus:bg-(--surface-elevated)")}
            />
          </Field>

          <Field label="Description">
            <Input
              aria-label="Description"
              value={values.description}
              onChange={(event) => update('description', event.target.value)}
              placeholder="Brief description of what this skill does"
              className={unstyledInput("w-full rounded-lg border border-(--border) bg-(--surface-muted) px-3 py-2 text-sm text-(--foreground) outline-hidden transition-colors placeholder:text-(--muted-light) focus:border-(--muted) focus:bg-(--surface-elevated)")}
            />
          </Field>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="skill-instructions" className="text-[11px] font-medium uppercase tracking-[0.12em] text-(--muted-light)">Instructions</label>
              <span className="text-[10px] text-(--muted-light)">Markdown supported</span>
            </div>
            <Textarea
              id="skill-instructions"
              value={values.instructions}
              onChange={(event) => update('instructions', event.target.value)}
              placeholder={'Describe what the AI should do differently when this skill is active.\n\nExample:\n- Always respond in bullet points\n- Keep answers under 3 sentences\n- Use a formal tone'}
              rows={12}
              className={unstyledTextarea("w-full resize-none rounded-lg border border-(--border) bg-(--surface-muted) px-3 py-2.5 font-mono text-xs leading-relaxed text-(--foreground) outline-hidden transition-colors placeholder:text-(--muted-light) focus:border-(--muted) focus:bg-(--surface-elevated)")}
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-(--border) px-5 py-3">
          <div className="flex items-center gap-3">
            <EnabledToggle enabled={values.enabled} onChange={() => update('enabled', !values.enabled)} />
            {isEdit && initial ? (
              <Button variant="ghost"
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className={unstyledButton("flex items-center gap-1 text-xs text-(--muted) transition-colors hover:text-red-400 disabled:opacity-50")}
              >
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Delete
              </Button>
            ) : null}
          </div>
          <Button variant="ghost"
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className={unstyledButton("flex items-center gap-1.5 rounded-md border border-(--border) bg-(--surface-subtle) px-4 py-1.5 text-xs text-(--foreground) transition-colors hover:bg-(--border) disabled:opacity-50")}
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <Check size={12} /> : null}
            {saving ? 'Saving…' : saved ? 'Saved' : isEdit ? 'Save' : 'Create'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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

export function SkillsPanel({ loading, skills, filteredSkills, onCreate, onEdit, onToggle }: SkillsPanelProps) {
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
          <Button variant="ghost" type="submit"
            onClick={onCreate}
            className={unstyledButton("flex items-center gap-1.5 rounded-md border border-(--border) bg-(--surface-subtle) px-4 py-2 text-sm text-(--foreground) transition-colors hover:bg-(--border)")}
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
      <div className="mx-auto max-w-3xl px-6 py-6">
        <TileGrid columns={3}>
          {filteredSkills.map((skill) => (
            <SkillCard key={skill._id} skill={skill} onEdit={onEdit} onToggle={onToggle} />
          ))}
        </TileGrid>
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
    <Tile
      onClick={() => onEdit(skill)}
      leading={<TileIcon><Sparkles size={15} strokeWidth={1.75} /></TileIcon>}
      title={skill.name || 'Untitled'}
      description={skill.description}
      topRight={(
        <span
          className={`h-2 w-2 rounded-full transition-colors ${skill.enabled !== false ? 'bg-(--foreground)' : 'bg-(--muted-light)'}`}
          title={skill.enabled !== false ? 'Active' : 'Disabled'}
        />
      )}
      footer={skill.instructions ? (
        <span className="line-clamp-2 font-mono text-[10px] text-(--muted-light)">{skill.instructions}</span>
      ) : undefined}
    >
      <div className="absolute bottom-3 right-3 hidden items-center gap-1 group-hover:flex">
        <Button variant="ghost"
          type="button"
          onClick={(event) => onToggle(skill, event)}
          className={unstyledButton("rounded-sm p-1 text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)")}
          title={skill.enabled !== false ? 'Disable' : 'Enable'}
        >
          {skill.enabled !== false ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
        </Button>
        <Button variant="ghost"
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onEdit(skill)
          }}
          className={unstyledButton("rounded-sm p-1 text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)")}
          title="Edit"
        >
          <Pencil size={13} />
        </Button>
      </div>
    </Tile>
  )
}
