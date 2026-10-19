'use client'

import { Fragment, useState, type ReactNode } from 'react'
import { ChevronDown, Loader2, Plus } from 'lucide-react'
import {
  Button,
  SidebarGroup,
  SidebarMenuButton,
  type SidebarResourceAction,
} from '@overlay/ui/primitives'
import { cn } from '@overlay/ui'
import { DelayedTooltip } from '@overlay/ui/overlays'
import type { InlineNavItem } from '@/components/layout/AppSidebarInlinePanels'
import type { SecondaryPanelNav } from './AppSidebarSecondaryPanel'

export function badgeLabel(count: number) {
  return count > 99 ? '99+' : String(count)
}

const SECTION_HEADER_PX = 30

/** Scoped row ids look like `workspace:dms`; sections are keyed by the view after the scope. */
const sectionViewId = (id: string) => id.slice(id.indexOf(':') + 1)

interface PageSection {
  id: string
  label: string
  active: boolean
  badgeCount?: number
  locked?: boolean
}

function pageSections(
  nav: SecondaryPanelNav | undefined,
  rows: ReadonlyArray<InlineNavItem>,
  title: string,
  hasContent: boolean,
): PageSection[] {
  if (nav && rows.length > 0) {
    const activeId = nav.activeChildId ?? nav.activeId
    return rows.map((row) => ({ id: row.id, label: row.label, active: activeId === row.id, badgeCount: row.badgeCount, locked: row.locked }))
  }
  return hasContent && title ? [{ id: 'page', label: title, active: true }] : []
}

/** Collapsible page sections; headers are flat siblings so they can pin to the top and bottom of the scroll area. */
export function PageSections({
  nav,
  rows,
  title,
  action,
  sectionActions,
  renderSection,
  children,
}: {
  nav?: SecondaryPanelNav
  rows: ReadonlyArray<InlineNavItem>
  title: string
  action?: SidebarResourceAction | null
  sectionActions?: Readonly<Record<string, SidebarResourceAction | null>>
  renderSection?: (id: string) => ReactNode
  children?: ReactNode
}) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set())
  const sections = pageSections(nav, rows, title, Boolean(children || action))
  if (sections.length === 0) return null
  const multi = Boolean(nav && rows.length > 0)
  // With a renderer every section lists its own items, so a header only opens and closes.
  const independent = multi && Boolean(renderSection)
  const toggle = (id: string) => setClosed((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  return (
    <SidebarGroup className="mt-3">
      {sections.map((section, index) => {
        const open = (independent || section.active) && !closed.has(section.id)
        const pending = !independent && nav?.pendingId === section.id
        const sectionAction = multi ? sectionActions?.[sectionViewId(section.id)] ?? (section.active ? action : null) : action
        const content = !multi ? children : independent ? renderSection?.(sectionViewId(section.id)) : section.active ? children : null
        const runAction = () => {
          if (!sectionAction) return
          if (open) {
            sectionAction.onClick()
            return
          }
          // The section's list owns the create dialog, so mount it before asking it to open.
          toggle(section.id)
          window.setTimeout(sectionAction.onClick, 50)
        }
        return (
          <Fragment key={section.id}>
            <div
              className="group/section sticky z-10 flex h-[30px] items-center gap-0.5 bg-(--sidebar-surface)"
              style={{ top: index * SECTION_HEADER_PX, bottom: (sections.length - 1 - index) * SECTION_HEADER_PX }}
            >
              <SidebarMenuButton
                aria-expanded={open}
                isActive={!independent && section.active && multi}
                disabled={section.locked}
                className="h-[30px] w-auto flex-none gap-1 px-2 font-medium text-(--muted-light) hover:bg-transparent hover:text-(--foreground)"
                onClick={() => {
                  if (independent || section.active) toggle(section.id)
                  else nav?.onSelect(section.id)
                }}
              >
                {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
                <span className="truncate">{section.label}</span>
                <ChevronDown aria-hidden className={cn('transition-transform', open ? null : '-rotate-90')} />
              </SidebarMenuButton>
              {section.badgeCount ? (
                <span className="shrink-0 px-1 text-[10px] font-medium text-(--muted)">{badgeLabel(section.badgeCount)}</span>
              ) : null}
              {sectionAction ? (
                <DelayedTooltip label={sectionAction.label} side="bottom">
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label={sectionAction.label}
                    onClick={runAction}
                    className="ml-auto size-7 shrink-0 rounded-md text-(--muted) opacity-0 hover:bg-(--surface-subtle) hover:text-(--foreground) focus-visible:opacity-100 group-hover/section:opacity-100"
                  >
                    <Plus size={14} aria-hidden />
                  </Button>
                </DelayedTooltip>
              ) : null}
            </div>
            {open && content ? <div className="min-w-0 pb-3">{content}</div> : null}
          </Fragment>
        )
      })}
    </SidebarGroup>
  )
}
