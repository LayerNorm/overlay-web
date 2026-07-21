'use client'

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn, usePresence } from '@overlay/ui'

export type AppScreenBodyPadding = 'none' | 'sm' | 'md' | 'lg'
export type AppScreenBodyMaxWidth = 'none' | 'sm' | 'md' | 'lg' | 'xl'
export type AppScreenBodyScroll = 'auto' | 'hidden' | 'visible'
export type AppScreenPanelWidth = 'sm' | 'md' | 'lg' | number

export interface AppScreenShellProps extends HTMLAttributes<HTMLDivElement> {
  header?: ReactNode
  sidebar?: ReactNode
  sidebarClassName?: string
  sidebarBehavior?: 'desktop' | 'always'
  rightPanel?: ReactNode
  rightPanelOpen?: boolean
  rightPanelWidth?: AppScreenPanelWidth
  rightPanelMode?: 'docked' | 'floating'
  onRightPanelClose?: () => void
  rightPanelOverlayLabel?: string
  contentClassName?: string
}

const panelWidthClasses: Record<Exclude<AppScreenPanelWidth, number>, string> = {
  sm: 'lg:w-80',
  md: 'lg:w-96',
  lg: 'lg:w-[28rem]',
}

function panelWidthClass(width: AppScreenPanelWidth) {
  return typeof width === 'number' ? 'lg:w-[var(--app-screen-panel-width)]' : panelWidthClasses[width]
}

function panelWidthStyle(width: AppScreenPanelWidth): CSSProperties | undefined {
  return typeof width === 'number'
    ? ({ '--app-screen-panel-width': `${width}px` } as CSSProperties)
    : undefined
}

export function AppScreenShell({
  header,
  sidebar,
  sidebarClassName,
  sidebarBehavior = 'desktop',
  rightPanel,
  rightPanelOpen,
  rightPanelWidth = 'md',
  rightPanelMode = 'docked',
  onRightPanelClose,
  rightPanelOverlayLabel = 'Screen side panel',
  contentClassName,
  className,
  children,
  ...props
}: AppScreenShellProps) {
  const resolvedRightPanelOpen = rightPanelOpen ?? Boolean(rightPanel)
  // Keep the panel mounted through its slide-out so the exit animation can play.
  const { mounted: rightPanelMounted, visible: rightPanelVisible } = usePresence(
    resolvedRightPanelOpen,
    300,
  )
  // Callers often pass `rightPanel={open ? <Panel/> : null}`, which would unmount
  // the content before the close animation finishes. Cache the last rendered
  // panel so it stays visible while sliding out. The write happens in an effect
  // (refs must not be mutated during render); the render only reads the cached
  // value as a fallback when the live panel is null (i.e. while closing).
  const lastRightPanelRef = useRef<ReactNode>(rightPanel)
  useEffect(() => {
    if (rightPanel) lastRightPanelRef.current = rightPanel
  }, [rightPanel])
  // eslint-disable-next-line react-hooks/refs -- read previous content only as a close-animation fallback
  const rightPanelContent = rightPanel ?? lastRightPanelRef.current
  const showRightPanel = rightPanelMounted && Boolean(rightPanelContent)
  const rightPanelClassName = panelWidthClass(rightPanelWidth)
  const rightPanelStyle = panelWidthStyle(rightPanelWidth)
  const floatingRightPanel = rightPanelMode === 'floating'

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full bg-[var(--background)] text-[var(--foreground)]',
        className,
      )}
      {...props}
    >
      {sidebar ? (
        <aside
          className={cn(
            'min-h-0 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--sidebar-surface)]',
            sidebarBehavior === 'always' ? 'flex' : 'hidden lg:flex',
            sidebarClassName,
          )}
        >
          {sidebar}
        </aside>
      ) : null}
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {header}
          <div className={cn('min-h-0 min-w-0 flex-1', contentClassName)}>{children}</div>
        </div>
        {showRightPanel ? (
          onRightPanelClose ? (
            <button
              type="button"
              aria-label="Close side panel"
              className={cn(
                'absolute inset-0 z-20 bg-[var(--background)]/80 backdrop-blur-sm transition-opacity duration-300 ease-[var(--overlay-ease)] lg:hidden',
                rightPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
              )}
              onClick={onRightPanelClose}
            />
          ) : (
            <div
              className={cn(
                'absolute inset-0 z-20 bg-[var(--background)]/80 backdrop-blur-sm transition-opacity duration-300 ease-[var(--overlay-ease)] lg:hidden',
                rightPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
              )}
            />
          )
        ) : null}
        {showRightPanel ? (
          <aside
            className={cn(
              'absolute right-0 z-30 flex min-h-0 w-full max-w-[min(24rem,100vw)] shrink-0 overflow-hidden bg-[var(--surface-elevated)] transition-[transform,width,opacity] duration-300 ease-[var(--overlay-ease)]',
              floatingRightPanel
                ? 'inset-y-2 right-2 max-w-[calc(100vw-1rem)] rounded-xl border border-[var(--border)] bg-[var(--sidebar-surface)] shadow-xl lg:max-w-none'
                : 'inset-y-0 border-l border-[var(--border)] shadow-2xl lg:static lg:z-auto lg:max-w-none lg:shadow-none',
              rightPanelVisible
                ? cn('translate-x-0 opacity-100', rightPanelClassName)
                : floatingRightPanel
                  ? 'pointer-events-none translate-x-[calc(100%+0.5rem)] opacity-0'
                  : 'translate-x-full opacity-0 lg:w-0 lg:translate-x-0 lg:border-l-0',
            )}
            style={rightPanelStyle}
            role="complementary"
            aria-label={rightPanelOverlayLabel}
            aria-hidden={!rightPanelVisible}
          >
            {/* Fixed-width inner wrapper so content slides cleanly instead of
                reflowing while the column animates its width. */}
            <div
              className={cn('flex h-full min-h-0 w-full flex-col', rightPanelClassName)}
              style={rightPanelStyle}
            >
              {rightPanelContent}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  )
}

export interface AppScreenHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode
  subtitle?: ReactNode
  description?: ReactNode
  leading?: ReactNode
  metadata?: ReactNode
  tabs?: ReactNode
  search?: ReactNode
  actions?: ReactNode
  border?: boolean
}

export function AppScreenHeader({
  title,
  subtitle,
  description,
  leading,
  metadata,
  tabs,
  search,
  actions,
  border = true,
  className,
  children,
  ...props
}: AppScreenHeaderProps) {
  return (
    <header
      className={cn(
        'flex min-h-14 shrink-0 flex-col justify-center gap-2 px-3 py-2.5 sm:px-6 md:min-h-16 md:gap-3 md:py-3',
        border ? 'border-b border-[var(--border)]' : null,
        className,
      )}
      {...props}
    >
      {children ? (
        children
      ) : (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 md:flex-nowrap md:gap-4">
          <div className="flex min-w-0 flex-1 items-center">
            {leading ? <div className="mr-2 shrink-0">{leading}</div> : null}
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center">
                {title ? <h1 className="truncate text-sm font-medium text-[var(--foreground)]">{title}</h1> : null}
                {subtitle ? (
                  <>
                    <span className="mx-2 shrink-0 text-[var(--muted-light)]">·</span>
                    <span className="truncate text-sm text-[var(--muted)]">{subtitle}</span>
                  </>
                ) : null}
                {metadata ? <span className="ml-2 shrink-0">{metadata}</span> : null}
              </div>
              {description ? (
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--muted)]">{description}</p>
              ) : null}
            </div>
          </div>
          {(search || actions) ? (
            <div className="flex max-w-full min-w-0 shrink-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] md:overflow-visible [&::-webkit-scrollbar]:hidden">
              {search}
              {actions}
            </div>
          ) : null}
        </div>
      )}
      {tabs ? <div className="min-w-0 overflow-x-auto">{tabs}</div> : null}
    </header>
  )
}

export interface AppScreenBodyProps extends HTMLAttributes<HTMLDivElement> {
  padding?: AppScreenBodyPadding
  maxWidth?: AppScreenBodyMaxWidth
  scroll?: AppScreenBodyScroll
}

const bodyPaddingClasses: Record<AppScreenBodyPadding, string> = {
  none: '',
  sm: 'p-3 sm:p-4',
  md: 'p-4 sm:p-6',
  lg: 'p-5 sm:p-8',
}

const bodyMaxWidthClasses: Record<AppScreenBodyMaxWidth, string> = {
  none: '',
  sm: 'mx-auto w-full max-w-2xl',
  md: 'mx-auto w-full max-w-3xl',
  lg: 'mx-auto w-full max-w-5xl',
  xl: 'mx-auto w-full max-w-7xl',
}

const bodyScrollClasses: Record<AppScreenBodyScroll, string> = {
  auto: 'overflow-auto',
  hidden: 'overflow-hidden',
  visible: 'overflow-visible',
}

export function AppScreenBody({
  padding = 'md',
  maxWidth = 'none',
  scroll = 'auto',
  className,
  children,
  ...props
}: AppScreenBodyProps) {
  return (
    <main
      className={cn(
        'h-full min-h-0 bg-[var(--background)]',
        bodyScrollClasses[scroll],
        bodyPaddingClasses[padding],
        className,
      )}
      {...props}
    >
      {maxWidth === 'none' ? children : <div className={bodyMaxWidthClasses[maxWidth]}>{children}</div>}
    </main>
  )
}

export interface AppScreenSidePanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  onClose?: () => void
  closeLabel?: string
  bodyClassName?: string
  compactHeader?: boolean
}

export function AppScreenSidePanel({
  title,
  description,
  actions,
  onClose,
  closeLabel = 'Close side panel',
  bodyClassName,
  compactHeader = false,
  className,
  children,
  ...props
}: AppScreenSidePanelProps) {
  return (
    <section
      className={cn(
        'flex h-full min-h-0 w-full flex-col bg-[var(--surface-elevated)] text-[var(--foreground)]',
        className,
      )}
      {...props}
    >
      {(title || description || actions || onClose) ? (
        <div
          className={cn(
            'flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)]',
            compactHeader ? 'h-11 min-h-11 px-3' : 'min-h-16 px-4',
          )}
        >
          <div className="min-w-0">
            {title ? <h2 className="truncate text-sm font-medium text-[var(--foreground)]">{title}</h2> : null}
            {description ? <p className="truncate text-xs text-[var(--muted)]">{description}</p> : null}
          </div>
          {(actions || onClose) ? (
            <div className="flex shrink-0 items-center gap-1.5">
              {actions}
              {onClose ? (
                <button
                  type="button"
                  aria-label={closeLabel}
                  className={cn(
                    'inline-flex items-center justify-center text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]',
                    compactHeader ? 'h-7 w-7 rounded-md' : 'h-8 w-8 rounded-lg',
                  )}
                  onClick={onClose}
                >
                  <X size={compactHeader ? 14 : 16} strokeWidth={1.8} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={cn('min-h-0 flex-1 overflow-auto', bodyClassName)}>{children}</div>
    </section>
  )
}
