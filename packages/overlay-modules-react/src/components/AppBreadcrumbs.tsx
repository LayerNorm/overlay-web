'use client'

import { Fragment, createContext, useContext, type ReactNode } from 'react'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@overlay/ui/primitives'

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
    <Breadcrumb aria-label={ariaLabel} className="min-w-0 flex-1">
      <BreadcrumbList className="min-w-0 flex-nowrap">
        {trail.map((item, index) => {
          const current = index === trail.length - 1
          const labelClass = 'block min-w-0 truncate rounded-sm outline-offset-2'
          const currentLabel = <BreadcrumbPage role={undefined} aria-disabled={undefined} className="block min-w-0 truncate">{item.label}</BreadcrumbPage>
          return (
            <Fragment key={index}>
              {index > 0 ? <BreadcrumbSeparator className="shrink-0" /> : null}
              <BreadcrumbItem className={`min-w-0 ${current ? 'flex-1' : ''}`}>
                {current
                  ? asHeading
                    ? <h1 className="m-0 min-w-0 truncate text-sm leading-5">{currentLabel}</h1>
                    : currentLabel
                  : item.href
                    ? context.renderLink
                      ? <BreadcrumbLink asChild>{context.renderLink(item, labelClass)}</BreadcrumbLink>
                      : <BreadcrumbLink href={item.href} className={labelClass}>{item.label}</BreadcrumbLink>
                    : <span className="block min-w-0 truncate">{item.label}</span>}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
