import Image from 'next/image'

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`ui-skeleton-line rounded-md ${className}`} aria-hidden />
}

function SidebarRows({ rows = 7 }: { rows?: number }) {
  return (
    <div className="space-y-2 px-2 py-3" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <SkeletonBlock className="h-4 w-4 shrink-0 rounded" />
          <SkeletonBlock className={`h-3 ${index % 3 === 0 ? 'w-28' : index % 3 === 1 ? 'w-36' : 'w-24'}`} />
        </div>
      ))}
    </div>
  )
}

function PageHeaderSkeleton({ actions = 2 }: { actions?: number }) {
  return (
    <div className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--border)] px-4">
      <div className="space-y-2">
        <SkeletonBlock className="h-4 w-32" />
        <SkeletonBlock className="h-3 w-48" />
      </div>
      <div className="flex items-center gap-2">
        {Array.from({ length: actions }).map((_, index) => (
          <SkeletonBlock key={index} className="h-8 w-8 rounded-md" />
        ))}
      </div>
    </div>
  )
}

export function AppShellLoadingFallback() {
  return <InitialAppLoading />
}

export function InitialAppLoading() {
  return (
    <div className="flex h-screen items-center justify-center overflow-hidden bg-background text-foreground">
      <div
        className="app-brand-loader flex items-center"
        role="status"
        aria-label="Loading overlay"
      >
        <span className="app-brand-loader-logo relative z-10 flex items-center bg-background">
          <Image src="/assets/overlay-logo.png" alt="" width={18} height={18} priority />
        </span>
        <span className="ml-2 overflow-hidden py-1">
          <span
            className="app-brand-loader-word block text-2xl font-medium tracking-tight"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            overlay
          </span>
        </span>
      </div>
    </div>
  )
}

export function ChatRouteSkeleton({ mode = 'chat' }: { mode?: 'chat' | 'automate' }) {
  return (
    <div className="flex h-full min-w-0 overflow-hidden bg-[var(--background)]">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeaderSkeleton actions={mode === 'automate' ? 1 : 3} />
        <div className="flex min-h-0 flex-1 flex-col justify-between px-4 py-5">
          <div className="mx-auto w-full max-w-3xl space-y-5">
            <SkeletonBlock className="h-3 w-24" />
            <div className="space-y-2.5">
              <SkeletonBlock className="h-3 w-[72%]" />
              <SkeletonBlock className="h-3 w-[86%]" />
              <SkeletonBlock className="h-3 w-[48%]" />
            </div>
            <div className="ml-auto w-[72%] space-y-2.5">
              <SkeletonBlock className="h-3 w-full" />
              <SkeletonBlock className="h-3 w-[68%]" />
            </div>
          </div>
          <div className="mx-auto w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
            <SkeletonBlock className="mb-3 h-4 w-40" />
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <SkeletonBlock className="h-8 w-8 rounded-md" />
                <SkeletonBlock className="h-8 w-8 rounded-md" />
              </div>
              <SkeletonBlock className="h-8 w-8 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export type FilesRouteSkeletonLayout = 'list' | 'cards'

function FilesHeaderSkeleton({ layout }: { layout: FilesRouteSkeletonLayout }) {
  return (
    <div className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--border)] px-6">
      <div className="flex items-center gap-3">
        <SkeletonBlock className="h-4 w-12" />
        <SkeletonBlock className="h-3 w-14" />
      </div>
      <div className="flex items-center gap-2">
        <SkeletonBlock className="h-8 w-8 rounded-md" />
        <div className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-0.5">
          <SkeletonBlock className={`h-7 w-8 rounded ${layout === 'list' ? 'opacity-100' : 'opacity-55'}`} />
          <SkeletonBlock className={`h-7 w-8 rounded ${layout === 'cards' ? 'opacity-100' : 'opacity-55'}`} />
        </div>
        <SkeletonBlock className="h-8 w-8 rounded-md" />
        <SkeletonBlock className="h-8 w-8 rounded-md" />
      </div>
    </div>
  )
}

function FilesListSkeletonRows({ rows = 10 }: { rows?: number }) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-0.5" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-2 rounded-lg px-3 py-2.5">
          <SkeletonBlock className="h-3.5 w-3.5 shrink-0 rounded" />
          <SkeletonBlock className={`h-3 ${index % 4 === 0 ? 'w-3/5' : index % 4 === 1 ? 'w-4/5' : 'w-2/3'}`} />
        </div>
      ))}
    </div>
  )
}

function FilesCardSkeletonGrid({ cards = 10 }: { cards?: number }) {
  return (
    <div className="mx-auto w-full max-w-[1440px] columns-1 gap-4 [column-gap:1rem] sm:columns-2 lg:columns-3 xl:columns-4" aria-hidden>
      {Array.from({ length: cards }).map((_, index) => (
        <div
          key={index}
          className="mb-4 block w-full break-inside-avoid overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]"
          style={{ breakInside: 'avoid' }}
        >
          <div className="flex h-28 items-center justify-center bg-[var(--surface-muted)]">
            <SkeletonBlock className="h-9 w-9 rounded-md" />
          </div>
          <div className="space-y-2 px-3 py-2.5">
            <SkeletonBlock className={`h-3 ${index % 3 === 0 ? 'w-4/5' : index % 3 === 1 ? 'w-3/5' : 'w-2/3'}`} />
            <SkeletonBlock className="h-2.5 w-2/5 opacity-75" />
            <SkeletonBlock className="h-2 w-1/4 opacity-60" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function FilesRouteSkeleton({ layout = 'list' }: { layout?: FilesRouteSkeletonLayout }) {
  return (
    <div className="flex h-full flex-col bg-[var(--background)]">
      <FilesHeaderSkeleton layout={layout} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {layout === 'cards' ? <FilesCardSkeletonGrid /> : <FilesListSkeletonRows />}
      </div>
    </div>
  )
}

export function KnowledgeRouteSkeleton() {
  return (
    <div className="flex h-full flex-col bg-[var(--background)]">
      <PageHeaderSkeleton actions={3} />
      <div className="mx-auto w-full max-w-5xl flex-1 px-5 py-5">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex gap-2">
            <SkeletonBlock className="h-8 w-20 rounded-md" />
            <SkeletonBlock className="h-8 w-20 rounded-md" />
          </div>
          <SkeletonBlock className="h-8 w-36 rounded-md" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
              <SkeletonBlock className="mb-3 h-5 w-5 rounded" />
              <SkeletonBlock className="mb-2 h-3 w-32" />
              <SkeletonBlock className="h-3 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function KnowledgeLoadingRouteSkeleton() {
  return <KnowledgeRouteSkeleton />
}

export function MemoriesLoadingRouteSkeleton() {
  return (
    <div className="flex h-full flex-col bg-[var(--background)]">
      <PageHeaderSkeleton actions={2} />
      <div className="mx-auto w-full max-w-3xl space-y-5 px-6 py-5">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
          >
            <SkeletonBlock className="h-3 w-full" />
            <SkeletonBlock className="mt-2 h-3 w-4/5" />
            <div className="mt-3 flex gap-2">
              <SkeletonBlock className="h-5 w-16 rounded-full" />
              <SkeletonBlock className="h-5 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function NotesLoadingRouteSkeleton() {
  return <KnowledgeRouteSkeleton />
}

export function OutputsLoadingRouteSkeleton() {
  return <KnowledgeRouteSkeleton />
}

export function ProjectsRouteSkeleton() {
  return (
    <div className="flex h-full flex-col bg-[var(--background)]">
      <PageHeaderSkeleton actions={1} />
      <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
            <SkeletonBlock className="mb-4 h-8 w-8 rounded-md" />
            <SkeletonBlock className="mb-2 h-3.5 w-36" />
            <SkeletonBlock className="h-3 w-2/3 opacity-75" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function SettingsRouteSkeleton() {
  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--background)]">
      <PageHeaderSkeleton actions={0} />
      <div className="mx-auto w-full max-w-3xl space-y-3 p-5">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
            <SkeletonBlock className="mb-3 h-4 w-44" />
            <SkeletonBlock className="mb-2 h-3 w-full" />
            <SkeletonBlock className="h-3 w-3/5" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function IntegrationsRouteSkeleton() {
  return (
    <div className="flex h-full flex-col bg-[var(--background)]">
      <PageHeaderSkeleton actions={1} />
      <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-6">
        <SkeletonBlock className="h-3 w-24" />
        <SidebarRows rows={4} />
        <SkeletonBlock className="h-3 w-24" />
        <SidebarRows rows={6} />
      </div>
    </div>
  )
}

export function IntegrationsLoadingRouteSkeleton() {
  return <IntegrationsRouteSkeleton />
}

export function ToolsLoadingRouteSkeleton() {
  return <IntegrationsRouteSkeleton />
}
