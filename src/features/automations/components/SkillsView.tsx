'use client'

// Compatibility wrapper: skill contracts/controllers live in @overlay/app-core;
// shared React presentation lives in @overlay/modules-react.
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Plus } from 'lucide-react'
import {
  EXTENSIONS_CHANGED_EVENT,
  SKILLS_CHANGED_EVENT,
  createSkillCreateRequest,
  createSkillSummaryFromForm,
  createSkillUpdateRequest,
  filterSkillSummaries,
  removeSkillSummary,
  setSkillEnabled,
  updateSkillSummaryFromForm,
  upsertSkillSummary,
  type SkillFormValues,
  type SkillSummary,
} from '@overlay/app-core'
import { AppScreenShell } from '@overlay/modules-react/shell'
import { ExtensionPageHeader, SkillDialog, SkillsPanel } from '@overlay/modules-react/extensions'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useWorkspaceChanged } from '@/hooks/use-workspace-changed'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { ScopeItemActions } from '@/components/layout/ScopeItemActions'
import { useWorkspaceCreateAccess } from '@/hooks/use-workspace-create-access'
import { newItemScope, scopeForNewItem } from '@/shared/workspaces/panel-scope'

interface DialogState {
  mode: 'create' | 'edit'
  skill?: SkillSummary
}

export default function SkillsView({ userId: _userId }: { userId: string; selectedSkillId?: string }) {
  void _userId

  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const scope = usePanelScope()
  const { canCreate } = useWorkspaceCreateAccess()
  const canAdd = canCreate('extension', scopeForNewItem(scope))

  const dispatchSkillsChanged = useCallback(() => {
    window.dispatchEvent(new CustomEvent(SKILLS_CHANGED_EVENT))
    window.dispatchEvent(new CustomEvent(EXTENSIONS_CHANGED_EVENT))
  }, [])

  const loadSkills = useCallback(async () => {
    try {
      setSkills(await overlayAppClient.skills.get<SkillSummary[]>({ limit: 100, view: scope }))
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => {
    setLoading(true)
    void loadSkills()
  }, [loadSkills])

  useWorkspaceChanged(loadSkills)

  const filteredSkills = useMemo(
    () => filterSkillSummaries(skills, searchQuery),
    [skills, searchQuery],
  )

  async function handleSaveSkill(values: SkillFormValues): Promise<boolean> {
    if (dialog?.mode === 'edit' && dialog.skill) {
      const res = await overlayAppClient.skills.updateResponse(createSkillUpdateRequest(dialog.skill._id, values))
      if (!res.ok) return false
      const next = updateSkillSummaryFromForm(dialog.skill, values)
      setSkills((prev) => upsertSkillSummary(prev, next))
      dispatchSkillsChanged()
      return true
    }

    const res = await overlayAppClient.skills.createResponse({ ...createSkillCreateRequest(values), scope: newItemScope(scope) })
    if (!res.ok) return false
    const { id } = (await res.json()) as { id: string }
    setSkills((prev) => upsertSkillSummary(prev, createSkillSummaryFromForm(id, values)))
    dispatchSkillsChanged()
    return true
  }

  async function handleDeleteSkill(skill: SkillSummary): Promise<boolean> {
    const res = await overlayAppClient.skills.deleteResponse({ skillId: skill._id })
    if (!res.ok) return false
    setSkills((prev) => removeSkillSummary(prev, skill._id))
    dispatchSkillsChanged()
    return true
  }

  async function handleQuickToggle(skill: SkillSummary, event: MouseEvent) {
    event.stopPropagation()
    const newEnabled = skill.enabled === false
    setSkills((prev) => prev.map((item) => (item._id === skill._id ? setSkillEnabled(item, newEnabled) : item)))
    try {
      const res = await overlayAppClient.skills.updateResponse({ skillId: skill._id, enabled: newEnabled })
      if (res.ok) dispatchSkillsChanged()
    } catch {
      // ignore optimistic update errors, matching prior behavior
    }
  }

  return (
    <AppScreenShell
      header={
        <ExtensionPageHeader
          title="Skills"
          searchQuery={searchQuery}
          searchPlaceholder="Search skills…"
          searchTitle="Search skills"
          action={canAdd ? (
            <button
              onClick={() => setDialog({ mode: 'create' })}
              className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--border)]"
            >
              <Plus size={12} />
              New Skill
            </button>
          ) : undefined}
          onSearchQueryChange={setSearchQuery}
        />
      }
    >
      <SkillsPanel
        loading={loading}
        skills={skills}
        filteredSkills={filteredSkills}
        onCreate={canAdd ? () => setDialog({ mode: 'create' }) : undefined}
        onEdit={(skill) => setDialog({ mode: 'edit', skill })}
        onToggle={(skill, event) => void handleQuickToggle(skill, event)}
      />

      {dialog ? (
        <SkillDialog
          state={dialog}
          onClose={() => setDialog(null)}
          onSave={handleSaveSkill}
          onDelete={handleDeleteSkill}
          scopeActions={dialog.mode === 'edit' && dialog.skill ? (
            <ScopeItemActions
              kind="extension"
              resource="skills"
              item={dialog.skill}
              variant="buttons"
              onChanged={() => {
                setDialog(null)
                void loadSkills()
                dispatchSkillsChanged()
              }}
            />
          ) : undefined}
        />
      ) : null}
    </AppScreenShell>
  )
}
