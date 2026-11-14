'use client'
import { toast } from '@overlay/ui/primitives'

// Skill contracts/controllers live in @overlay/app-core; shared React presentation lives in @overlay/modules-react.
import { useMemo, useState } from 'react'
import { BookOpen, ChartLine, Code, Eye, FileText, Languages, ListChecks, Mail, PenLine, Search, Sparkles, Trash2, Upload, type LucideIcon } from 'lucide-react'
import {
  createSkillCreateRequest,
  createSkillUpdateRequest,
  type SkillFormValues,
  type SkillSummary,
} from '@overlay/app-core'
import { SKILL_CATEGORIES, SKILL_TEMPLATES, groupExtensionCatalog, type SkillTemplate, type SkillTemplateIcon } from '@overlay/app-core/extensions'
import { ExtensionCatalogDeleteDialog, ExtensionCatalogPage, SkillDialog, type ExtensionCatalogEntry } from '@overlay/modules-react/extensions'
import { useLiveSkills, useSkillCommands } from '@/hooks/use-skills'
import { usePanelListView, usePanelScope } from '@/hooks/use-panel-scope'
import { ScopeItemActions } from '@/components/layout/ScopeItemActions'
import { useWorkspaceCreateAccess } from '@/hooks/use-workspace-create-access'
import { newItemScope, scopeForNewItem } from '@/shared/workspaces/panel-scope'
import { ExtensionsScreen } from '@/components/layout/extensions/ExtensionsScreen'
import { useExtensionsIntent, useExtensionsRoute } from '@/hooks/use-extensions-route'

interface DialogState {
  mode: 'create' | 'edit'
  skill?: SkillSummary
  preset?: Partial<SkillFormValues>
}

const TEMPLATE_ICONS: Record<SkillTemplateIcon, LucideIcon> = {
  pen: PenLine, mail: Mail, notes: FileText, chart: ChartLine, languages: Languages, search: Search, code: Code, list: ListChecks,
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const canEdit = (skill: SkillSummary) => (skill as { canEdit?: boolean }).canEdit !== false

/** Reads a dropped-in SKILL.md: optional `name`/`description` front matter, the rest is the instructions. */
function parseSkillMarkdown(text: string, fileName: string): Partial<SkillFormValues> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  const field = (key: string) => match?.[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '')
  return {
    name: field('name') || fileName.replace(/\.md$/i, '').replace(/^SKILL$/i, '') || '',
    description: field('description') ?? '',
    instructions: (match ? text.slice(match[0].length) : text).trim(),
  }
}

export default function SkillsView({ userId: _userId }: { userId: string; selectedSkillId?: string }) {
  void _userId

  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [deleting, setDeleting] = useState<SkillSummary | null>(null)
  const scope = usePanelScope()
  const listView = usePanelListView()
  const { canCreate } = useWorkspaceCreateAccess()
  const canAdd = canCreate('extension', scopeForNewItem(scope))
  const route = useExtensionsRoute()

  // Live: skills created, edited, toggled or deleted in any tab appear at once.
  const live = useLiveSkills(listView)
  const skills = useMemo<SkillSummary[]>(() => live ?? [], [live])
  const loading = live === undefined
  const commands = useSkillCommands()

  // Global search and other Extensions pages link here with ?id= (open that skill) or ?add=1 (new skill).
  useExtensionsIntent<DialogState>(route, ({ add, id }) => {
    if (add) return canAdd ? { mode: 'create' } : null
    if (loading) return undefined
    const skill = skills.find((item) => item._id === id)
    return skill ? { mode: 'edit', skill } : null
  }, setDialog)

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

  function uploadSkillFile() {
    // A detached file input opens the browser file picker without rendering a control.
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,text/markdown,text/plain'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setDialog({ mode: 'create', preset: parseSkillMarkdown(await file.text(), file.name) })
    }
    input.click()
  }

  const skillEntry = (skill: SkillSummary, template?: SkillTemplate): ExtensionCatalogEntry => ({
    id: template?.id ?? skill._id,
    name: skill.name || 'Untitled',
    description: skill.description || template?.description,
    logo: { kind: 'icon', icon: template ? TEMPLATE_ICONS[template.icon] : PenLine },
    status: skill.enabled === false ? { label: 'Off' } : undefined,
    onOpen: () => setDialog({ mode: 'edit', skill }),
    menu: canEdit(skill)
      ? [{ label: 'Edit', icon: PenLine, onSelect: () => setDialog({ mode: 'edit', skill }) }, { label: 'Delete', icon: Trash2, onSelect: () => setDeleting(skill) }]
      : [{ label: 'View', icon: Eye, onSelect: () => setDialog({ mode: 'edit', skill }) }],
  })

  const templateEntry = (template: SkillTemplate): ExtensionCatalogEntry => {
    const added = skills.find((skill) => sameName(skill.name, template.name))
    if (added) return skillEntry(added, template)
    const open = () => setDialog({ mode: 'create', preset: { name: template.name, description: template.description, instructions: template.instructions } })
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      logo: { kind: 'icon', icon: TEMPLATE_ICONS[template.icon] },
      onOpen: open,
      onAdd: canAdd ? open : undefined,
    }
  }

  const browse = groupExtensionCatalog(SKILL_TEMPLATES, SKILL_CATEGORIES, (template) => template.id)
    .map((section) => ({ ...section, items: section.items.map(templateEntry) }))
  const added = skills.filter((skill) => SKILL_TEMPLATES.some((template) => sameName(template.name, skill.name)))
  const created = skills.filter((skill) => !added.includes(skill))
  const yours = [
    { id: 'added', title: 'Added', items: added.map((skill) => skillEntry(skill, SKILL_TEMPLATES.find((template) => sameName(template.name, skill.name)))) },
    { id: 'created', title: scope === 'workspace' ? 'Shared in workspace' : 'Created by you', items: created.map((skill) => skillEntry(skill)) },
  ]
  const openSection = route.category ? browse.find((section) => section.id === route.category) : undefined

  return (
    <ExtensionsScreen title="Skills" sectionTitle={openSection?.title} overviewHref={route.overviewHref}>
      <ExtensionCatalogPage
        title="Skills"
        subtitle="Teach Overlay how you like things done."
        noun="skills"
        icon={Sparkles}
        yoursLabel={scope === 'workspace' ? 'Workspace' : 'Yours'}
        loading={loading}
        browse={browse}
        yours={yours}
        yoursEmpty={{ title: 'No skills yet', body: 'Added and custom skills will appear here.' }}
        addOptions={canAdd ? [
          { id: 'write', label: 'Write a skill', icon: BookOpen, onSelect: () => setDialog({ mode: 'create' }) },
          { id: 'upload', label: 'Upload SKILL.md', icon: Upload, onSelect: uploadSkillFile },
        ] : undefined}
        category={route.category}
        onCategoryChange={route.openCategory}
        noResults={canAdd
          ? { body: 'Check the spelling, or write your own skill.', action: { label: 'Write a skill', onSelect: () => setDialog({ mode: 'create' }) } }
          : { body: 'Check the spelling and try again.' }}
      />

      {dialog ? (
        <SkillDialog
          state={dialog}
          onClose={() => setDialog(null)}
          onSave={handleSaveSkill}
          // A workspace skill someone else owns opens read-only unless the viewer may manage it.
          readOnly={dialog.mode === 'edit' && Boolean(dialog.skill) && !canEdit(dialog.skill!)}
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
      {deleting ? (
        <ExtensionCatalogDeleteDialog
          name={deleting.name || 'this skill'}
          kind="skill"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const skill = deleting
            setDeleting(null)
            void handleDeleteSkill(skill).then((ok) => ok ? toast(`${skill.name || 'Skill'} deleted`) : toast.error('Could not delete this skill.'))
          }}
        />
      ) : null}
    </ExtensionsScreen>
  )
}
