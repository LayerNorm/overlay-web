'use client'

import { Component, useMemo, useState, type ReactNode } from 'react'
import { useConvexAuth, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { Archive, Plus, RotateCcw, User, Users } from 'lucide-react'
import { Button, toast } from '@overlay/ui/primitives'
import { AppScreenShell } from '@overlay/modules-react/shell'
import { ExtensionPageHeader, SkillDialog, SkillsPanel } from '@overlay/modules-react/extensions'
import { filterSkillSummaries, type SkillFormValues } from '@overlay/app-core'
import { PageSubviewTabs } from '@/components/layout/PageSubviewTabs'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { useNativeSkills } from '../lib/use-native-skills'

type Detail = NonNullable<FunctionReturnType<typeof api.integrations.nativeSkills.get>>
type Controller = ReturnType<typeof useNativeSkills>

export class SkillsErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? <p role="alert" className="p-6 text-sm text-(--muted)">Skills could not be loaded. Check your access and reopen this view.</p>
      : this.props.children
  }
}

export function NativeSkillsView({ workspaceId, view }: { workspaceId: string; view: 'personal' | 'workspace' | 'archived' }) {
  const controller = useNativeSkills(workspaceId, view)
  const [searchQuery, setSearchQuery] = useState('')
  const [dialog, setDialog] = useState<{ mode: 'create'; requestId: string } | { mode: 'edit'; skillId: Id<'skills'> } | null>(null)
  const skills = useMemo(() => controller.results.map(row => ({ ...row, instructions: '' })), [controller.results])
  const filteredSkills = useMemo(() => filterSkillSummaries(skills, searchQuery), [skills, searchQuery])
  const canAdd = view !== 'archived' && controller.permissions?.[view] === true
  const openCreate = () => setDialog({ mode: 'create', requestId: crypto.randomUUID() })
  const close = () => setDialog(null)
  return <AppScreenShell header={<ExtensionPageHeader title="Skills" tabs={<PageSubviewTabs />}
    searchQuery={searchQuery} searchPlaceholder="Search skills…" searchTitle="Search skills" onSearchQueryChange={setSearchQuery}
    action={canAdd ? <Button variant="primary" size="sm" onClick={openCreate}><Plus size={12} />New Skill</Button> : undefined} />}>
    {controller.denied ? <p role="alert">Sign in to load skills.</p> : <>
      <SkillsPanel loading={controller.loading} skills={skills} filteredSkills={filteredSkills}
        onCreate={canAdd ? openCreate : undefined} onEdit={skill => setDialog({ mode: 'edit', skillId: skill._id as Id<'skills'> })}
        onToggle={() => undefined} />
      {controller.status === 'CanLoadMore' || controller.status === 'LoadingMore' ? <Button variant="ghost"
        disabled={controller.status === 'LoadingMore'} onClick={() => controller.loadMore(50)}>Load more</Button> : null}
    </>}
    {dialog?.mode === 'create' ? <SkillDialog key={dialog.requestId} state={{ mode: 'create' }} onClose={close} onDelete={async () => false}
      onSave={async values => {
        try {
          await controller.create({ workspaceId, requestId: dialog.requestId, scope: view === 'workspace' ? 'workspace' : 'personal', ...values })
          return true
        } catch { toast.error('Could not create this skill. Your draft is unchanged.'); return false }
      }} /> : null}
    {dialog?.mode === 'edit' ? <NativeSkillEditor key={dialog.skillId} workspaceId={workspaceId} skillId={dialog.skillId}
      controller={controller} onClose={close} /> : null}
  </AppScreenShell>
}

function NativeSkillEditor({ workspaceId, skillId, controller, onClose }: {
  workspaceId: string; skillId: Id<'skills'>; controller: Controller; onClose: () => void
}) {
  const { isAuthenticated } = useConvexAuth()
  const current = useQuery(api.integrations.nativeSkills.get, isAuthenticated ? { workspaceId, skillId } : 'skip')
  if (current === undefined) return <p role="status">Loading skill…</p>
  return <SkillDraft workspaceId={workspaceId} current={current} controller={controller} onClose={onClose} />
}

export function SkillDraft({ workspaceId, current, controller, onClose }: {
  workspaceId: string; current: Detail | null; controller: Controller; onClose: () => void
}) {
  // A live query never replaces this editing baseline or the dialog's dirty fields.
  const [baseline] = useState(current)
  const [busy, setBusy] = useState(false)
  if (!baseline) return <p role="alert">This skill is no longer available. <Button variant="ghost" onClick={onClose}>Close</Button></p>
  const conflict = !current || current.revision !== baseline.revision
  const args = { workspaceId, skillId: baseline._id, expectedRevision: baseline.revision }
  async function perform(action: () => Promise<unknown>, close = false) {
    if (conflict) { toast.error('This skill changed elsewhere. Your draft is preserved. Close and reopen to load the latest version.'); return false }
    setBusy(true)
    try { await action(); if (close) onClose(); return true }
    catch { toast.error('Could not update this skill. It may have changed or your access may have been revoked. Your draft is preserved.'); return false }
    finally { setBusy(false) }
  }
  const options = current?.options ?? baseline.options
  const moveTo = options.moveTo
  return <SkillDialog state={{ mode: 'edit', skill: baseline }} readOnly={!current?.editable}
    onClose={onClose} onSave={(values: SkillFormValues) => perform(() => controller.update({ ...args, ...values }))}
    onDelete={() => perform(() => controller.remove(args))}
    scopeActions={<div className="flex min-w-0 flex-col items-end gap-2">
      {conflict ? <p role="alert" className="text-sm text-(--muted)">This skill changed elsewhere or is no longer available. Your draft has not been replaced. Close and reopen to load the latest version.</p> : null}
      <div className="flex flex-wrap gap-2">
        {moveTo ? <Button variant="outline" size="sm" disabled={busy || conflict} onClick={() => void perform(() => controller.changeScope({ ...args, action: 'move', to: moveTo }), true)}>
          {moveTo === 'workspace' ? <Users size={13} /> : <User size={13} />}Move to {moveTo === 'workspace' ? 'Workspace' : 'Personal'}</Button> : null}
        {options.canArchive ? <Button variant="outline" size="sm" disabled={busy || conflict} onClick={() => void perform(() => controller.changeScope({ ...args, action: 'archive' }), true)}><Archive size={13} />Archive</Button> : null}
        {options.canRestore ? <Button variant="outline" size="sm" disabled={busy || conflict} onClick={() => void perform(() => controller.changeScope({ ...args, action: 'restore' }), true)}><RotateCcw size={13} />Restore</Button> : null}
      </div>
    </div>} />
}
