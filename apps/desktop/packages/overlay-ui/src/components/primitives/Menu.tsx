'use client'

import {
  createContext,
  forwardRef,
  useContext,
  useMemo,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react'
import { cn } from '../../utils/cn'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { floatingSurfaceClassName } from '../ui/floating-surface'

const ActionMenuContext = createContext(false)

/** Standalone visual surface; semantics belong to its owning dropdown or popover. */
export const MenuSurface = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function MenuSurface({ className, ...props }, ref) {
    return <div ref={ref} className={cn(floatingSurfaceClassName, className)} {...props} />
  },
)

/**
 * Existing external-anchor API remains a rich-content popover. Action menus
 * opt into a real Radix trigger so keyboard opening and typeahead are owned by Radix.
 */
export function FloatingMenu({
  anchorRef,
  children,
  className,
  open,
  onOpenChange,
  side = 'bottom',
  align = 'start',
  trigger,
  kind = 'popover',
  ...props
}: {
  anchorRef: RefObject<HTMLElement | null>
  children: ReactNode
  className?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  side?: 'top' | 'bottom'
  align?: 'start' | 'end'
  trigger?: ReactElement
  kind?: 'menu' | 'popover'
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  const outsideInteraction = useRef(false)
  const virtualRef = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => anchorRef.current?.getBoundingClientRect() ?? new DOMRect(),
        get contextElement() {
          return anchorRef.current ?? undefined
        },
      },
    }),
    [anchorRef],
  )

  if (kind === 'menu' && trigger) {
    return (
      <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent side={side} align={align} className={className} {...props}>
          <ActionMenuContext.Provider value>{children}</ActionMenuContext.Provider>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {trigger ? (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      ) : (
        <PopoverAnchor virtualRef={virtualRef} />
      )}
      <PopoverContent
        side={side}
        align={align}
        className={className}
        onOpenAutoFocus={() => {
          outsideInteraction.current = false
        }}
        onInteractOutside={(event) => {
          if (!trigger && anchorRef.current?.contains(event.target as Node)) event.preventDefault()
          else outsideInteraction.current = true
        }}
        onCloseAutoFocus={
          trigger
            ? undefined
            : (event) => {
                event.preventDefault()
                if (outsideInteraction.current) return
                const anchor = anchorRef.current
                const control = anchor?.matches('button, a, [tabindex]')
                  ? anchor
                  : anchor?.querySelector<HTMLElement>('button, a, [tabindex]')
                control?.focus()
              }
        }
        {...props}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

export function MenuItem({
  type = 'button',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const actionMenu = useContext(ActionMenuContext)
  const button = (
    <button
      type={type}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-(--muted) transition-colors hover:bg-(--surface-muted) hover:text-(--foreground) disabled:cursor-not-allowed disabled:text-(--muted-light)',
        className,
      )}
      {...props}
    />
  )
  return actionMenu ? (
    <DropdownMenuItem asChild disabled={props.disabled}>
      {button}
    </DropdownMenuItem>
  ) : (
    button
  )
}
