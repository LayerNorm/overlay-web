'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { PanelLeft } from 'lucide-react'

import { cn } from '../../utils/cn'

/**
 * shadcn/ui Sidebar, adapted to Overlay's tokens and layout.
 *
 * The app shell already owns where a sidebar sits (a flex column beside the primary rail, a drawer on phones), so
 * `Sidebar` here is the in-flow container (shadcn's `collapsible="none"` shape) whose width and collapse transition
 * come from the caller. Everything inside follows shadcn's anatomy: `SidebarHeader`, `SidebarContent`, `SidebarGroup`,
 * `SidebarMenu` > `SidebarMenuItem` > `SidebarMenuButton` (+ `SidebarMenuAction`, `SidebarMenuBadge`), and
 * `SidebarMenuSub` for the indented tree with its vertical guide line.
 *
 * Only `Sidebar`, `SidebarRail` and `SidebarTrigger` read `SidebarProvider`; the menu parts work anywhere, so the same
 * markup renders inside the phone drawer.
 */

type SidebarContextProps = {
  state: 'expanded' | 'collapsed'
  open: boolean
  setOpen: (open: boolean) => void
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider.')
  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  children,
}: {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}) {
  const [openState, setOpenState] = React.useState(defaultOpen)
  const open = openProp ?? openState
  const setOpen = React.useCallback((value: boolean) => {
    if (openProp === undefined) setOpenState(value)
    onOpenChange?.(value)
  }, [onOpenChange, openProp])
  const toggleSidebar = React.useCallback(() => setOpen(!open), [open, setOpen])
  const value = React.useMemo<SidebarContextProps>(
    () => ({ state: open ? 'expanded' : 'collapsed', open, setOpen, toggleSidebar }),
    [open, setOpen, toggleSidebar],
  )
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

function Sidebar({ className, children, ...props }: React.ComponentProps<'aside'>) {
  const context = React.useContext(SidebarContext)
  return (
    <aside
      data-slot="sidebar"
      data-state={context?.state ?? 'expanded'}
      className={cn(
        'group/sidebar relative flex h-full shrink-0 flex-col overflow-hidden border-r border-(--border) bg-(--sidebar-surface) text-(--foreground)',
        className,
      )}
      {...props}
    >
      {children}
    </aside>
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn('flex h-16 min-h-16 shrink-0 items-center gap-2 border-b border-(--border) px-4', className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden', className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn('mt-auto flex shrink-0 flex-col gap-1 border-t border-(--border) px-2 py-3', className)}
      {...props}
    />
  )
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<'hr'>) {
  return <hr data-slot="sidebar-separator" className={cn('mx-2 border-0 border-t border-(--border)', className)} {...props} />
}

function SidebarInput({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      data-slot="sidebar-input"
      className={cn(
        'h-8 w-full rounded-md border border-(--border) bg-(--surface-elevated) px-2.5 text-xs text-(--foreground) outline-none transition-colors placeholder:text-(--muted-light) focus:border-(--muted-light)',
        className,
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group"
      className={cn('relative flex w-full min-w-0 flex-col px-2 py-1', className)}
      {...props}
    />
  )
}

function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'div'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'div'
  return (
    <Comp
      data-slot="sidebar-group-label"
      className={cn(
        'flex h-7 shrink-0 items-center px-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-(--muted-light)',
        className,
      )}
      {...props}
    />
  )
}

function SidebarGroupAction({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="sidebar-group-action"
      {...(!asChild ? { type: 'button' as const } : {})}
      className={cn(
        'absolute right-3 top-1.5 flex size-5 items-center justify-center rounded-md text-(--muted) outline-none transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground) focus-visible:ring-1 focus-visible:ring-(--muted-light) [&>svg]:size-3.5 [&>svg]:shrink-0',
        className,
      )}
      {...props}
    />
  )
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group-content" className={cn('w-full text-xs', className)} {...props} />
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu" className={cn('m-0 flex w-full min-w-0 list-none flex-col gap-0.5 p-0', className)} {...props} />
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" className={cn('group/menu-item relative min-w-0', className)} {...props} />
}

const sidebarMenuButtonVariants = cva(
  'peer/menu-button flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-md text-left text-xs text-(--muted) outline-none transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground) focus-visible:ring-1 focus-visible:ring-(--muted-light) disabled:pointer-events-none disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60 data-[active=true]:bg-(--surface-subtle) data-[active=true]:text-(--foreground) group-has-data-[sidebar=menu-action]/menu-item:pr-8 [&>svg]:size-[13px] [&>svg]:shrink-0 [&>span:last-child]:truncate',
  {
    variants: {
      size: {
        default: 'h-8 px-2.5',
        lg: 'h-9 px-3 text-sm [&>svg]:size-[15px]',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  size = 'default',
  className,
  ...props
}: React.ComponentProps<'button'> & {
  asChild?: boolean
  isActive?: boolean
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-size={size}
      data-active={isActive}
      // A real button inside a form-less list: never submit anything.
      {...(!asChild ? { type: 'button' as const } : {})}
      className={cn(sidebarMenuButtonVariants({ size }), className)}
      {...props}
    />
  )
}

function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean; showOnHover?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      {...(!asChild ? { type: 'button' as const } : {})}
      className={cn(
        'absolute right-1 top-1.5 flex size-5 items-center justify-center rounded-md text-(--muted-light) outline-none transition-colors hover:bg-(--surface-elevated) hover:text-(--foreground) focus-visible:ring-1 focus-visible:ring-(--muted-light) peer-data-[size=lg]/menu-button:top-2 [&>svg]:size-3.5 [&>svg]:shrink-0',
        showOnHover &&
          'group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 md:opacity-0',
        className,
      )}
      {...props}
    />
  )
}

function SidebarMenuBadge({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      className={cn(
        'pointer-events-none absolute right-1.5 top-1.5 flex h-5 min-w-5 select-none items-center justify-center rounded-md px-1 text-[11px] font-medium tabular-nums text-(--muted)',
        className,
      )}
      {...props}
    />
  )
}

/** Loading placeholder rows with the same height and rhythm as the rows they stand in for. */
function SidebarMenuSkeleton({
  className,
  showIcon = true,
  index = 0,
  ...props
}: React.ComponentProps<'div'> & { showIcon?: boolean; index?: number }) {
  // A fixed spread of widths (by position), so server and client render the same bars.
  const width = ['70%', '52%', '62%', '45%', '58%'][index % 5]
  return (
    <div
      data-slot="sidebar-menu-skeleton"
      role="status"
      aria-label="Loading"
      className={cn('flex h-8 items-center gap-2 rounded-md px-2.5', className)}
      {...props}
    >
      {showIcon ? <div className="ui-skeleton-line size-3.5 shrink-0 rounded-md" /> : null}
      <div className="ui-skeleton-line h-2.5 max-w-full flex-1 rounded-md" style={{ maxWidth: width }} />
    </div>
  )
}

/** The indented tree under a menu row, with shadcn's vertical guide line. */
function SidebarMenuSub({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      className={cn(
        'mb-1 ml-3.5 mt-0.5 flex min-w-0 list-none flex-col gap-0.5 border-l border-(--muted-light)/40 py-0.5 pl-2 pr-0',
        className,
      )}
      {...props}
    />
  )
}

function SidebarMenuSubItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-sub-item" className={cn('group/menu-sub-item relative min-w-0', className)} {...props} />
}

function SidebarMenuSubButton({
  asChild = false,
  isActive = false,
  className,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean; isActive?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="sidebar-menu-sub-button"
      data-sidebar="menu-button"
      data-active={isActive}
      {...(!asChild ? { type: 'button' as const } : {})}
      className={cn(
        'flex h-7 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-left text-xs text-(--muted) outline-none transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground) focus-visible:ring-1 focus-visible:ring-(--muted-light) disabled:pointer-events-none disabled:opacity-60 data-[active=true]:bg-(--surface-subtle) data-[active=true]:text-(--foreground) [&>svg]:size-[13px] [&>svg]:shrink-0 [&>span:last-child]:truncate',
        className,
      )}
      {...props}
    />
  )
}

/** A thin handle on the sidebar's edge that hides it. Needs `SidebarProvider`. */
function SidebarRail({ className, ...props }: React.ComponentProps<'button'>) {
  const { toggleSidebar } = useSidebar()
  return (
    <button
      type="button"
      data-slot="sidebar-rail"
      aria-label="Hide panel"
      title="Hide panel"
      tabIndex={-1}
      onClick={toggleSidebar}
      className={cn(
        'absolute inset-y-0 right-0 z-20 hidden w-2 cursor-w-resize transition-colors after:absolute after:inset-y-0 after:right-0 after:w-px hover:after:bg-(--muted-light)/60 md:block',
        className,
      )}
      {...props}
    />
  )
}

function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<'button'>) {
  const { toggleSidebar } = useSidebar()
  return (
    <button
      type="button"
      data-slot="sidebar-trigger"
      aria-label="Toggle sidebar"
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground) [&>svg]:size-4',
        className,
      )}
      {...props}
    >
      <PanelLeft aria-hidden />
    </button>
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  sidebarMenuButtonVariants,
  useSidebar,
}
