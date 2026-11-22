'use client'

import { useSyncExternalStore } from 'react'
import { FileListSkeleton, SettingsSectionSkeleton } from '@overlay/ui/feedback'
import { AppScreenBody, AppScreenShell } from '@overlay/modules-react/shell'
import { ExtensionCatalogPageSkeleton } from '@overlay/modules-react/extensions'
import { KnowledgeFileCardsSkeleton } from '@overlay/modules-react/knowledge'
import { NotebookEmptyState, NotePageSkeleton } from '@overlay/modules-react/notes'
import { PageSubviewTabs } from '@/components/layout/PageSubviewTabs'
import { RouteSkeletonHeader, SkeletonBlock } from './AppRouteSkeletons'

export type FilesRouteSkeletonLayout = 'list' | 'cards'

function FilesHeaderSkeleton({ layout }: { layout: FilesRouteSkeletonLayout }) {
  return (
    <div className="flex h-16 shrink-0 items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <SkeletonBlock className="h-4 w-12" />
        <SkeletonBlock className="h-3 w-14" />
      </div>
      <div className="flex items-center gap-2">
        <SkeletonBlock className="h-8 w-8 rounded-md" />
        <div className="flex items-center gap-1 rounded-md border border-(--border) bg-(--surface-muted) p-0.5">
          <SkeletonBlock className={`h-7 w-8 rounded-sm ${layout === 'list' ? 'opacity-100' : 'opacity-55'}`} />
          <SkeletonBlock className={`h-7 w-8 rounded-sm ${layout === 'cards' ? 'opacity-100' : 'opacity-55'}`} />
        </div>
        <SkeletonBlock className="h-8 w-8 rounded-md" />
        <SkeletonBlock className="h-8 w-8 rounded-md" />
      </div>
    </div>
  )
}

export function FilesRouteSkeleton({ layout = 'list' }: { layout?: FilesRouteSkeletonLayout }) {
  return (
    <div className="flex h-full flex-col bg-(--background)">
      <FilesHeaderSkeleton layout={layout} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {layout === 'cards' ? <KnowledgeFileCardsSkeleton /> : <FileListSkeleton />}
      </div>
    </div>
  )
}

/** A header title that is not known until the page loads (the open settings section, for example). */
const pendingTitle = <span className="flex h-5 items-center"><span className="ui-skeleton-line block h-3 w-20 rounded-sm" /></span>

/** Settings: the `SettingsPageShell` frame (header `px-6` under the Settings breadcrumb, `max-w-3xl` column) around one group. */
export function SettingsRouteSkeleton() {
  return (
    <AppScreenShell header={<RouteSkeletonHeader title={pendingTitle} breadcrumbs={[{ label: 'Settings' }]} className="px-6" />}>
      <AppScreenBody padding="none" maxWidth="none" className="px-6 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <SettingsSectionSkeleton />
        </div>
      </AppScreenBody>
    </AppScreenShell>
  )
}

/**
 * Extensions (Connectors, Skills, MCPs, Apps): the `ExtensionsScreen` frame around the catalog page skeleton. Views that
 * know their page pass its title, noun and tab label; the route-level fallback leaves them as placeholders.
 */
export function ExtensionsRouteSkeleton(props: Parameters<typeof ExtensionCatalogPageSkeleton>[0]) {
  return (
    <AppScreenShell header={<RouteSkeletonHeader title={props.title} tabs={<PageSubviewTabs />} />}>
      <AppScreenBody padding="none" maxWidth="none" className="h-full">
        <ExtensionCatalogPageSkeleton {...props} />
      </AppScreenBody>
    </AppScreenShell>
  )
}

/** Notes: the editor's header row (`px-6`) over the `.overlay-note-page` document column. */
const noUpdates = () => () => undefined
const urlNamesNote = () => new URLSearchParams(window.location.search).has('id')

export function NoteRouteSkeleton() {
  // Notes without a note open loads to the empty "notes" screen, not a document. The server assumes a note.
  const namesNote = useSyncExternalStore(noUpdates, urlNamesNote, () => true)
  return (
    <AppScreenShell header={<RouteSkeletonHeader className="px-6" />}>
      <AppScreenBody padding="none" maxWidth="none" scroll="hidden" className="h-full">
        {namesNote ? <NotePageSkeleton /> : <div className="flex h-full"><NotebookEmptyState disabled onCreateNote={() => undefined} /></div>}
      </AppScreenBody>
    </AppScreenShell>
  )
}
