import { useState } from 'react'
import { BarChart3, Download, Filter, MoreHorizontal, Plus, Search, X } from 'lucide-react'
import { Button, IconButton, Input } from '@overlay/ui'
import {
  AppScreenBody,
  AppScreenHeader,
  AppScreenShell,
  AppScreenSidePanel,
} from '..'

const meta = {
  title: 'Enterprise Modules/App Screen Shell',
  parameters: {
    layout: 'fullscreen',
  },
}

export default meta

const rows = [
  ['Revenue workspace', 'Updated 2m ago', 'Active'],
  ['Customer renewal review', 'Updated 18m ago', 'Draft'],
  ['Security evidence packet', 'Updated 1h ago', 'Ready'],
  ['Board summary', 'Updated yesterday', 'Active'],
]

function SampleBody() {
  return (
    <div className="grid gap-3">
      {rows.map(([title, updated, status]) => (
        <article
          key={title}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-medium text-[var(--foreground)]">{title}</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">{updated}</p>
            </div>
            <span className="rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-1 text-xs text-[var(--muted)]">
              {status}
            </span>
          </div>
        </article>
      ))}
    </div>
  )
}

function SampleSidePanel({ onClose }: { onClose?: () => void }) {
  return (
    <AppScreenSidePanel
      title="Assistant"
      description="Workspace context"
      onClose={onClose}
      actions={
        <IconButton aria-label="Panel options" size="sm">
          <MoreHorizontal size={15} strokeWidth={1.8} />
        </IconButton>
      }
    >
      <div className="grid gap-4 p-4 text-sm">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3 text-[var(--muted)]">
          Ask about files, project status, or recent changes without leaving the screen.
        </div>
        <div className="rounded-lg border border-[var(--border)] p-3">
          <p className="font-medium text-[var(--foreground)]">Suggested prompt</p>
          <p className="mt-1 text-[var(--muted)]">Summarize open risks for this workspace.</p>
        </div>
      </div>
    </AppScreenSidePanel>
  )
}

export function PlainScreen() {
  return (
    <div className="h-[620px] bg-[var(--background)]">
      <AppScreenShell
        header={<AppScreenHeader title="Projects" subtitle="All workspaces" />}
      >
        <AppScreenBody maxWidth="lg">
          <SampleBody />
        </AppScreenBody>
      </AppScreenShell>
    </div>
  )
}

export function HeaderActions() {
  return (
    <div className="h-[620px] bg-[var(--background)]">
      <AppScreenShell
        header={
          <AppScreenHeader
            title="Files"
            subtitle="Knowledge base"
            search={
              <div className="hidden w-60 sm:block">
                <Input aria-label="Search files" placeholder="Search files" />
              </div>
            }
            actions={
              <>
                <Button size="sm">
                  <Filter size={14} strokeWidth={1.8} />
                  Filter
                </Button>
                <Button size="sm" variant="primary">
                  <Plus size={14} strokeWidth={1.8} />
                  New
                </Button>
              </>
            }
          />
        }
      >
        <AppScreenBody maxWidth="lg">
          <SampleBody />
        </AppScreenBody>
      </AppScreenShell>
    </div>
  )
}

export function RightPanelOpen() {
  const [open, setOpen] = useState(true)

  return (
    <div className="h-[620px] bg-[var(--background)]">
      <AppScreenShell
        header={
          <AppScreenHeader
            title="Finance"
            subtitle="Portfolio"
            leading={<BarChart3 size={17} strokeWidth={1.8} />}
            actions={
              <>
                <Button size="sm">
                  <Download size={14} strokeWidth={1.8} />
                  Export
                </Button>
                <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
                  Assistant
                </Button>
              </>
            }
          />
        }
        rightPanel={<SampleSidePanel onClose={() => setOpen(false)} />}
        rightPanelOpen={open}
        onRightPanelClose={() => setOpen(false)}
      >
        <AppScreenBody maxWidth="lg">
          <SampleBody />
        </AppScreenBody>
      </AppScreenShell>
    </div>
  )
}

export function MobileLayout() {
  const [open, setOpen] = useState(true)

  return (
    <div className="flex min-h-screen items-start justify-center bg-[var(--surface-subtle)] p-4">
      <div className="h-[720px] w-full max-w-[390px] overflow-hidden border border-[var(--border)] bg-[var(--background)] shadow-xl">
        <AppScreenShell
          header={
            <AppScreenHeader
              title="Automations"
              subtitle="Runs"
              actions={
                <>
                  <IconButton aria-label="Search" size="sm">
                    <Search size={15} strokeWidth={1.8} />
                  </IconButton>
                  <IconButton aria-label={open ? 'Close assistant' : 'Open assistant'} size="sm" onClick={() => setOpen((value) => !value)}>
                    {open ? <X size={15} strokeWidth={1.8} /> : <Plus size={15} strokeWidth={1.8} />}
                  </IconButton>
                </>
              }
            />
          }
          rightPanel={<SampleSidePanel onClose={() => setOpen(false)} />}
          rightPanelOpen={open}
          onRightPanelClose={() => setOpen(false)}
        >
          <AppScreenBody maxWidth="none">
            <SampleBody />
          </AppScreenBody>
        </AppScreenShell>
      </div>
    </div>
  )
}

MobileLayout.parameters = {
  viewport: {
    defaultViewport: 'mobile1',
  },
}
