import { useState } from 'react'
import { Archive, Bell, FileText, Folder, MessageSquare, MoreHorizontal, Plus, Search, Trash2, Zap } from 'lucide-react'
import {
  AutomationListSkeleton,
  Badge,
  Button,
  CommandPalette,
  ConfirmDialog,
  DelayedTooltip,
  DialogFrame,
  EmptyState,
  FileTreeSkeleton,
  GenerationModeToggle,
  IconButton,
  Input,
  IntegrationListSkeleton,
  ListboxSelect,
  MenuItem,
  MenuSurface,
  OutputCardSkeleton,
  ProjectsPageSkeleton,
  Select,
  SettingsSectionSkeleton,
  SidebarNav,
  SidebarResourceList,
  SidebarResourceSection,
  SidebarSection,
  SidebarShell,
  TabButton,
  TabsList,
  Textarea,
  Toggle,
  Toolbar,
  UsageMeterBar,
  overlayDesignTokens,
} from '../index'
import type { CommandPaletteRow, GenerationMode } from '../index'

const meta = {
  title: 'Overlay UI/Primitives',
  parameters: {
    layout: 'fullscreen',
  },
}

export default meta

export function Controls() {
  const [enabled, setEnabled] = useState(true)
  const [mode, setMode] = useState<GenerationMode>('text')

  return (
    <div className="min-h-screen bg-[var(--background)] p-6 text-[var(--foreground)]">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <Toolbar className="rounded-lg border">
          <span className="text-sm font-medium">Toolbar</span>
          <Button className="ml-auto" size="sm" variant="primary">
            Primary
          </Button>
          <Button size="sm">Secondary</Button>
          <DelayedTooltip label="More actions">
            <IconButton aria-label="More actions" size="sm">
              <MoreHorizontal size={16} />
            </IconButton>
          </DelayedTooltip>
        </Toolbar>

        <section className="grid gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary">
              <Plus size={14} />
              Primary
            </Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">
              <Trash2 size={14} />
              Danger
            </Button>
            <IconButton aria-label="Archive">
              <Archive size={16} />
            </IconButton>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Input" />
            <Select defaultValue="one">
              <option value="one">Option one</option>
              <option value="two">Option two</option>
            </Select>
            <Textarea placeholder="Textarea" className="sm:col-span-2" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Toggle checked={enabled} onCheckedChange={setEnabled} aria-label="Enabled" />
            <Badge>Default</Badge>
            <Badge variant="muted">Muted</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="danger">Danger</Badge>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <TabsList>
              <TabButton active>Active</TabButton>
              <TabButton>Inactive</TabButton>
            </TabsList>
            <GenerationModeToggle mode={mode} onChange={setMode} />
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-[1fr_18rem]">
          <MenuSurface>
            <MenuItem>
              <Search size={14} />
              Search
            </MenuItem>
            <MenuItem>
              <Bell size={14} />
              Notifications
            </MenuItem>
            <MenuItem className="text-red-600">
              <Trash2 size={14} />
              Delete
            </MenuItem>
          </MenuSurface>

          <EmptyState
            icon={<Folder size={22} />}
            title="No items"
            description="Reusable empty states use app tokens and compact spacing."
            action={<Button size="sm">Create item</Button>}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-6"
          />
        </section>
      </div>
    </div>
  )
}

export function Layout() {
  return (
    <div className="flex h-[520px] bg-[var(--background)] text-[var(--foreground)]">
      <SidebarShell className="w-64">
        <div className="flex h-14 items-center border-b border-[var(--border)] px-4 text-sm font-medium">
          Sidebar
        </div>
        <SidebarNav>
          <Button className="w-full justify-start" variant="ghost">
            Chat
          </Button>
          <Button className="w-full justify-start" variant="ghost">
            Projects
          </Button>
        </SidebarNav>
        <SidebarSection>
          <FileTreeSkeleton rows={5} />
        </SidebarSection>
      </SidebarShell>
      <main className="min-w-0 flex-1 p-6">
        <ProjectsPageSkeleton />
      </main>
    </div>
  )
}

export function Feedback() {
  return (
    <div className="grid min-h-screen gap-6 bg-[var(--background)] p-6 text-[var(--foreground)] lg:grid-cols-2">
      <section className="space-y-4">
        <OutputCardSkeleton />
        <IntegrationListSkeleton rows={4} />
      </section>
      <section className="space-y-4">
        <SettingsSectionSkeleton rows={2} />
        <AutomationListSkeleton rows={3} />
      </section>
    </div>
  )
}

export function Dialogs() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <div className="flex min-h-screen items-center justify-center gap-3 bg-[var(--background)] p-6 text-[var(--foreground)]">
      <Button variant="primary" onClick={() => setDialogOpen(true)}>
        Open dialog
      </Button>
      <Button variant="danger" onClick={() => setConfirmOpen(true)}>
        Open confirm
      </Button>

      <DialogFrame
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Dialog frame"
        description="Dialog frames provide shared structure for modal content."
        footer={<Button onClick={() => setDialogOpen(false)}>Done</Button>}
      >
        <div className="mt-4 grid gap-3">
          <Input placeholder="Name" />
          <Textarea placeholder="Notes" />
        </div>
      </DialogFrame>

      <ConfirmDialog
        isOpen={confirmOpen}
        title="Delete item"
        description="This action cannot be undone."
        onConfirm={() => setConfirmOpen(false)}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}

export function Tokens() {
  const colorEntries = Object.entries(overlayDesignTokens.colors)
  const spaceEntries = Object.entries(overlayDesignTokens.spacing).filter(([key]) => key !== '0')

  return (
    <div className="min-h-screen bg-[var(--background)] p-6 text-[var(--foreground)]">
      <div className="mx-auto grid max-w-4xl gap-6">
        <section className="grid gap-3">
          <h2 className="text-sm font-semibold">Colors</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {colorEntries.map(([name, value]) => (
              <div key={name} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
                <span className="h-8 w-8 rounded-md border border-[var(--border)]" style={{ background: value }} />
                <span className="text-xs text-[var(--muted)]">{name}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="text-sm font-semibold">Spacing</h2>
          <div className="space-y-2">
            {spaceEntries.map(([name, value]) => (
              <div key={name} className="flex items-center gap-3 text-xs text-[var(--muted)]">
                <span className="w-6">{name}</span>
                <span className="h-3 rounded bg-[var(--foreground)]" style={{ width: value }} />
                <span>{value}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
          <p className="font-serif text-xl">Serif display text</p>
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            Sans body text uses the shared typography variables with stable line height.
          </p>
          <code className="font-mono text-xs text-[var(--muted)]">font-mono token</code>
        </section>
      </div>
    </div>
  )
}

export function PromotedPrimitives() {
  const [listboxValue, setListboxValue] = useState<'a' | 'b' | 'c'>('a')

  return (
    <div className="min-h-screen bg-[var(--background)] p-6 text-[var(--foreground)]">
      <div className="mx-auto grid max-w-lg gap-6">
        <section className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
          <h2 className="text-sm font-semibold">ListboxSelect</h2>
          <ListboxSelect
            value={listboxValue}
            onChange={setListboxValue}
            aria-label="Example listbox"
            options={[
              { value: 'a', label: 'Option A' },
              { value: 'b', label: 'Option B' },
              { value: 'c', label: 'Option C' },
            ]}
          />
        </section>

        <section className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
          <h2 className="text-sm font-semibold">UsageMeterBar</h2>
          <UsageMeterBar primaryLabel="42 / 100 messages" secondaryLabel="42%" percent={42} />
          <UsageMeterBar primaryLabel="85 / 100 messages" secondaryLabel="85%" percent={85} tone="warning" />
          <UsageMeterBar primaryLabel="100 / 100 messages" secondaryLabel="100%" percent={100} tone="exhausted" />
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]">
          <SidebarResourceSection
            action={{ label: 'New chat', onClick: () => undefined }}
            search={{ title: 'Search chats', onClick: () => undefined }}
          >
            <SidebarResourceList>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-muted)]">
                Weekly planning
              </button>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-muted)]">
                API design notes
              </button>
            </SidebarResourceList>
          </SidebarResourceSection>
        </section>
      </div>
    </div>
  )
}

export function CommandPaletteStory() {
  const [open, setOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [drilledIn, setDrilledIn] = useState(false)

  const rows: CommandPaletteRow[] = drilledIn
    ? [
        {
          kind: 'item',
          id: 'chat-1',
          label: 'Weekly planning',
          description: 'Yesterday',
          icon: <MessageSquare size={16} strokeWidth={1.75} />,
        },
        {
          kind: 'item',
          id: 'chat-2',
          label: 'API design notes',
          icon: <MessageSquare size={16} strokeWidth={1.75} />,
        },
      ]
    : [
        { kind: 'category', id: 'cat-chat', label: 'Chats', icon: <MessageSquare size={16} strokeWidth={1.75} /> },
        { kind: 'category', id: 'cat-file', label: 'Files', icon: <FileText size={16} strokeWidth={1.75} /> },
        { kind: 'category', id: 'cat-auto', label: 'Automations', icon: <Zap size={16} strokeWidth={1.75} /> },
      ]

  return (
    <div className="min-h-screen bg-[var(--background)] p-6 text-[var(--foreground)]">
      <Button variant="primary" onClick={() => setOpen(true)}>
        Open command palette
      </Button>
      <CommandPalette
        open={open}
        onClose={() => setOpen(false)}
        query={query}
        onQueryChange={setQuery}
        breadcrumb={drilledIn ? { label: 'Chats', icon: <MessageSquare size={11} strokeWidth={1.75} /> } : null}
        onBreadcrumbBack={() => {
          setDrilledIn(false)
          setQuery('')
        }}
        rows={rows}
        onActivateRow={(row) => {
          if (row.kind === 'category') setDrilledIn(true)
        }}
      />
    </div>
  )
}
