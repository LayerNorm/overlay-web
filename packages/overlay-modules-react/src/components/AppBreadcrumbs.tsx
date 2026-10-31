'use client'

import { Fragment, createContext, useContext, type ReactNode } from 'react'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@overlay/ui/primitives'

export interface AppBreadcrumbItem {
  label: ReactNode
  href?: string
  leading?: ReactNode
}

interface BreadcrumbContextValue {
  items: AppBreadcrumbItem[]
  leading?: ReactNode
  renderLink?: (item: AppBreadcrumbItem, className: string) => ReactNode
}

export const AppBreadcrumbContext = createContext<BreadcrumbContextValue>({ items: [] })

export function AppBreadcrumbs({ title, items = [], leading, 'aria-label': ariaLabel = 'Breadcrumb', asHeading = false }: {
  title?: ReactNode
  items?: AppBreadcrumbItem[]
  leading?: ReactNode
  'aria-label'?: string
  asHeading?: boolean
}) {
  const context = useContext(AppBreadcrumbContext)
  const trail = [...context.items]
  for (const item of items) {
    if (item.label !== trail.at(-1)?.label) trail.push(item)
  }
  if (title && title !== trail.at(-1)?.label) trail.push({ label: title })
  const leadingContent = leading ? <div className="mr-2 shrink-0 self-center">{leading}</div> : null
  if (!trail.length) return leadingContent
  return (
    <>
    {context.leading}
    {leadingContent}
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
                {item.leading ? <span className="shrink-0">{item.leading}</span> : null}
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
    </>
  )
}
