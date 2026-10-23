'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

export interface AppBreadcrumbItem {
  label: ReactNode
  href?: string
}

interface BreadcrumbContextValue {
  items: AppBreadcrumbItem[]
  renderLink?: (item: AppBreadcrumbItem, className: string) => ReactNode
}

export const AppBreadcrumbContext = createContext<BreadcrumbContextValue>({ items: [] })

export function AppBreadcrumbs({ title, items = [], 'aria-label': ariaLabel = 'Breadcrumb', asHeading = false }: {
  title?: ReactNode
  items?: AppBreadcrumbItem[]
  'aria-label'?: string
  asHeading?: boolean
}) {
  const context = useContext(AppBreadcrumbContext)
  const trail = [...context.items]
  for (const item of items) {
    if (item.label !== trail.at(-1)?.label) trail.push(item)
  }
  if (title && title !== trail.at(-1)?.label) trail.push({ label: title })
  if (!trail.length) return null
  return (
    <nav aria-label={ariaLabel} className="min-w-0 flex-1 text-sm leading-5">
      <ol className="flex min-w-0 items-center gap-1.5">
        {trail.map((item, index) => {
          const current = index === trail.length - 1
          const labelClass = 'block min-w-0 truncate rounded-sm outline-offset-2 hover:text-(--foreground)'
          const currentLabel = <span className="block min-w-0 truncate" aria-current={current ? 'page' : undefined}>{item.label}</span>
          return (
            <li key={index} className={`flex min-w-0 items-center gap-1.5 ${current ? 'flex-1 text-(--foreground) font-medium' : 'shrink text-(--muted)'}`}>
              {index > 0 ? <ChevronRight size={13} className="shrink-0 text-(--muted-light)" aria-hidden /> : null}
              {!current && item.href && context.renderLink
                ? context.renderLink(item, labelClass)
                : current && asHeading
                  ? <h1 className="m-0 min-w-0 truncate text-sm font-medium leading-5 text-(--foreground)">{currentLabel}</h1>
                  : currentLabel}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
