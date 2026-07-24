import { ReactElement, ReactNode, useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  children: ReactNode
  content: string
  position?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
  disabled?: boolean
}

export function Tooltip({
  children,
  content,
  position = 'top',
  delay = 400,
  disabled = false
}: TooltipProps): ReactElement {
  const [isVisible, setIsVisible] = useState(false)
  const [coords, setCoords] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches

  const showTooltip = (): void => {
    if (disabled || !content) return
    timeoutRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        setCoords({
          x: rect.left + rect.width / 2,
          y: position === 'bottom' ? rect.bottom : rect.top
        })
      }
      setIsVisible(true)
    }, delay)
  }

  const hideTooltip = (): void => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setIsVisible(false)
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  // Safety net: if tooltip is visible, watch mousemove to force-hide when mouse truly leaves
  useEffect(() => {
    if (!isVisible || !triggerRef.current) return
    const checkMouseOut = (e: MouseEvent): void => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        setIsVisible(false)
      }
    }
    document.addEventListener('mousemove', checkMouseOut)
    return () => document.removeEventListener('mousemove', checkMouseOut)
  }, [isVisible])

  const tooltipStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    padding: '6px 10px',
    borderRadius: 6,
    background: isDark ? '#27272a' : '#18181b',
    color: '#fafafa',
    fontSize: 11,
    fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    whiteSpace: 'nowrap',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
    pointerEvents: 'none',
    display: isVisible ? undefined : 'none',
    opacity: 1,
    ...(position === 'top' && {
      left: coords.x,
      top: coords.y,
      transform: 'translate(-50%, calc(-100% - 8px))'
    }),
    ...(position === 'bottom' && {
      left: coords.x,
      top: coords.y,
      transform: 'translate(-50%, 8px)'
    }),
    ...(position === 'left' && {
      left: coords.x,
      top: coords.y,
      transform: 'translate(calc(-100% - 8px), -50%)'
    }),
    ...(position === 'right' && {
      left: coords.x,
      top: coords.y,
      transform: 'translate(8px, -50%)'
    })
  }

  return (
    <div
      ref={triggerRef}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      style={{ display: 'inline-flex' }}
    >
      {children}
      {content && createPortal(<div style={tooltipStyle}>{content}</div>, document.body)}
    </div>
  )
}
