import { Children, cloneElement, isValidElement, useId, type ButtonHTMLAttributes, type HTMLAttributes } from 'react'

import {
  Tabs as TabsPrimitiveRoot,
  TabsList as TabsPrimitiveList,
  TabsTrigger,
} from '../ui/tabs'

export function TabsList({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const id = useId()
  const tabs = Children.toArray(children).map((child, index) => {
    if (!isValidElement<TabButtonProps>(child) || child.type !== TabButton) return child
    const value = child.props.value ?? `${id}-${index}`
    return cloneElement(child, { value })
  })
  const activeTab = tabs.find((child) => isValidElement<TabButtonProps>(child) && child.type === TabButton && child.props.active)
  const selectedValue = isValidElement<TabButtonProps>(activeTab) ? activeTab.props.value ?? '' : ''
  return (
    <TabsPrimitiveRoot className="contents" value={selectedValue} activationMode="manual">
      <TabsPrimitiveList className={className} {...props}>{tabs}</TabsPrimitiveList>
    </TabsPrimitiveRoot>
  )
}

export interface TabButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  value?: string
}

export function TabButton({
  active,
  type = 'button',
  value,
  children,
  onKeyDown,
  ...props
}: TabButtonProps) {
  const generatedValue = useId()
  return (
    <TabsTrigger
      type={type}
      data-active={active || undefined}
      value={value ?? generatedValue}
      aria-controls={props['aria-controls']}
      {...props}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (!event.defaultPrevented && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          event.currentTarget.click()
        }
      }}
    >
      {children}
    </TabsTrigger>
  )
}
