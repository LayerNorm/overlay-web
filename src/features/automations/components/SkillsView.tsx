'use client'
import { Button, toast } from '@overlay/ui/primitives'

// Compatibility wrapper: skill contracts/controllers live in @overlay/app-core;
// shared React presentation lives in @overlay/modules-react.
import { useMemo, useState, type MouseEvent } from 'react'
import { Plus } from 'lucide-react'
import {
  createSkillCreateRequest,
  createSkillUpdateRequest,
  filterSkillSummaries,
  type SkillFormValues,
  type SkillSummary,
} from '@overlay/app-core'
import { AppScreenShell } from '@overlay/modules-react/shell'
import { ExtensionPageHeader, SkillDialog, SkillsPanel } from '@overlay/modules-react/extensions'
import { useLiveSkills, useSkillCommands } from '@/hooks/use-skills'
import { usePanelListView, usePanelScope } from '@/hooks/use-panel-scope'
import { ScopeItemActions } from '@/components/layout/ScopeItemActions'
import { useWorkspaceCreateAccess } from '@/hooks/use-workspace-create-access'
import { newItemScope, scopeForNewItem } from '@/shared/workspaces/panel-scope'
import { PageSubviewTabs } from '@/components/layout/PageSubviewTabs'

interface DialogState {
  mode: 'create' | 'edit'
  skill?: SkillSummary
}

export default function SkillsView({ userId: _userId }: { userId: string; selectedSkillId?: string }) {
  void _userId

  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const scope = usePanelScope()
  const listView = usePanelListView()
  const { canCreate } = useWorkspaceCreateAccess()
  const canAdd = canCreate('extension', scopeForNewItem(scope))

  // Live: skills created, edited, toggled or deleted in any tab appear at once.
  const live = useLiveSkills(listView)
  const skills = useMemo<SkillSummary[]>(() => live ?? [], [live])
  const loading = live === undefined
  const commands = useSkillCommands()

  const filteredSkills = useMemo(
    () => filterSkillSummaries(skills, searchQuery),
    [skills, searchQuery],
  )

  async function handleSaveSkill(values: SkillFormValues): Promise<boolean> {
    try {
      if (dialog?.mode === 'edit' && dialog.skill) {
        // The form was filled from this version; a newer one saved elsewhere is not overwritten.
        await commands.update({ ...createSkillUpdateRequest(dialog.skill._id, values), expectedUpdatedAt: dialog.skill.updatedAt })
      } else {
        await commands.create({ ...createSkillCreateRequest(values), scope: newItemScope(scope) })
      }
      return true
    } catch (caught) {
      if (caught instanceof Error && caught.message.includes('SKILL_INVALID:conflict')) {
        toast.error('This skill changed elsewhere. Close the form and open it again to edit the newest version.')
      }
      return false
    }
  }

  async function handleDeleteSkill(skill: SkillSummary): Promise<boolean> {
    return await commands.remove(skill._id).then(() => true, () => false)
  }

  function handleQuickToggle(skill: SkillSummary, event: MouseEvent) {
    event.stopPropagation()
    void commands.update({ skillId: skill._id, enabled: skill.enabled === false }).catch(() => undefined)
  }

  return (
    <AppScreenShell
      header={
        <ExtensionPageHeader
          title="Skills"
          tabs={<PageSubviewTabs />}
          searchQuery={searchQuery}
          searchPlaceholder="Search skills…"
          searchTitle="Search skills"
          action={canAdd ? (
            <Button variant="primary" size="sm"
              onClick={() => setDialog({ mode: 'create' })}
            >
              <Plus size={12} />
              New Skill
            </Button>
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
              onChanged={() => setDialog(null)}
            />
          ) : undefined}
        />
      ) : null}
    </AppScreenShell>
  )
}
