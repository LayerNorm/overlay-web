import React, { useState, useEffect, useRef, useCallback } from 'react'
import { X, ChevronUp, ChevronDown } from 'lucide-react'

interface FindBarProps {
  isOpen: boolean
  onClose: () => void
  containerRef: React.RefObject<HTMLElement | null>
  placeholder?: string
  theme: {
    surfaceBg: string
    border: string
    text: string
    textMuted: string
    iconColorMuted: string
    surfaceBgHover: string
  }
}

interface MatchRect {
  top: number
  left: number
  width: number
  height: number
}

interface MatchInfo {
  node: Text
  startOffset: number
  endOffset: number
}

export function FindBar({
  isOpen,
  onClose,
  containerRef,
  placeholder = 'Find in page...',
  theme
}: FindBarProps): React.ReactElement<any> | null {
  const [searchTerm, setSearchTerm] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [totalMatches, setTotalMatches] = useState(0)
  const [highlightRects, setHighlightRects] = useState<MatchRect[]>([])
  const [containerBounds, setContainerBounds] = useState<DOMRect | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const matchesRef = useRef<MatchInfo[]>([])

  // Find all matches without modifying DOM
  const findMatches = useCallback(
    (term: string): MatchInfo[] => {
      if (!term || !containerRef.current) return []

      const matches: MatchInfo[] = []
      const walker = document.createTreeWalker(containerRef.current, NodeFilter.SHOW_TEXT, {
        acceptNode: (node: Node) => {
          const parent = node.parentElement
          if (!parent) return NodeFilter.FILTER_REJECT
          const tagName = parent.tagName.toLowerCase()
          if (tagName === 'script' || tagName === 'style') return NodeFilter.FILTER_REJECT
          if (!node.textContent) return NodeFilter.FILTER_REJECT
          return NodeFilter.FILTER_ACCEPT
        }
      })

      let node: Node | null
      while ((node = walker.nextNode())) {
        const text = node.textContent || ''
        const lowerText = text.toLowerCase()
        const lowerTerm = term.toLowerCase()
        let index = 0

        while ((index = lowerText.indexOf(lowerTerm, index)) !== -1) {
          matches.push({
            node: node as Text,
            startOffset: index,
            endOffset: index + term.length
          })
          index += term.length
        }
      }

      return matches
    },
    [containerRef]
  )

  // Calculate highlight rectangles for overlay
  const updateHighlightRects = useCallback(
    (matches: MatchInfo[], activeIndex: number) => {
      if (!containerRef.current) return

      const container = containerRef.current
      const containerRect = container.getBoundingClientRect()
      const rects: MatchRect[] = []

      matches.forEach((match, idx) => {
        try {
          const range = document.createRange()
          range.setStart(match.node, match.startOffset)
          range.setEnd(match.node, match.endOffset)
          const rect = range.getBoundingClientRect()

          rects.push({
            top: rect.top - containerRect.top + container.scrollTop,
            left: rect.left - containerRect.left + container.scrollLeft,
            width: rect.width,
            height: rect.height
          })

          // Scroll to active match
          if (idx === activeIndex) {
            const scrollTop =
              container.scrollTop + rect.top - containerRect.top - containerRect.height / 2
            container.scrollTo({ top: scrollTop, behavior: 'smooth' })
          }
        } catch {
          // Skip invalid ranges
        }
      })

      setHighlightRects(rects)
      setContainerBounds(containerRect)
    },
    [containerRef]
  )

  // Navigate to next match
  const nextMatch = useCallback(() => {
    if (totalMatches === 0) return
    const newIndex = currentIndex >= totalMatches ? 1 : currentIndex + 1
    setCurrentIndex(newIndex)
    updateHighlightRects(matchesRef.current, newIndex - 1)
  }, [currentIndex, totalMatches, updateHighlightRects])

  // Navigate to previous match
  const prevMatch = useCallback(() => {
    if (totalMatches === 0) return
    const newIndex = currentIndex <= 1 ? totalMatches : currentIndex - 1
    setCurrentIndex(newIndex)
    updateHighlightRects(matchesRef.current, newIndex - 1)
  }, [currentIndex, totalMatches, updateHighlightRects])

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) {
          prevMatch()
        } else {
          nextMatch()
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [nextMatch, prevMatch, onClose]
  )

  // Focus input when opened, clear when closed
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setSearchTerm('')
      setTotalMatches(0)
      setCurrentIndex(0)
      setHighlightRects([])
      matchesRef.current = []
    }
  }, [isOpen])

  // Update matches when search term changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const matches = findMatches(searchTerm)
      matchesRef.current = matches
      setTotalMatches(matches.length)
      if (matches.length > 0) {
        setCurrentIndex(1)
        updateHighlightRects(matches, 0)
      } else {
        setCurrentIndex(0)
        setHighlightRects([])
      }
    }, 150)
    return () => clearTimeout(timeoutId)
  }, [searchTerm, findMatches, updateHighlightRects])

  // Update highlight positions on scroll
  useEffect(() => {
    const container = containerRef.current
    if (!container || !isOpen) return

    const handleScroll = (): void => {
      if (matchesRef.current.length > 0) {
        updateHighlightRects(matchesRef.current, currentIndex - 1)
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [containerRef, isOpen, currentIndex, updateHighlightRects])

  if (!isOpen) return null

  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: 56,
          right: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'rgba(30, 30, 30, 1)',
          border: `1px solid ${theme.border}`,
          borderRadius: 8,
          padding: '6px 10px',
          zIndex: 100,
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
        }}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            width: 180,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontSize: 13,
            color: theme.text,
            fontFamily: 'system-ui, -apple-system, sans-serif'
          }}
        />
        <span
          style={{
            fontSize: 11,
            color: theme.textMuted,
            minWidth: 50,
            textAlign: 'center',
            fontFamily: 'system-ui, -apple-system, sans-serif'
          }}
        >
          {totalMatches > 0 ? `${currentIndex}/${totalMatches}` : 'No results'}
        </span>
        <button
          onClick={prevMatch}
          disabled={totalMatches === 0}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 4,
            cursor: totalMatches > 0 ? 'pointer' : 'default',
            opacity: totalMatches > 0 ? 1 : 0.3,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center'
          }}
          title="Previous match (Shift+Enter)"
        >
          <ChevronUp size={14} color={theme.iconColorMuted} />
        </button>
        <button
          onClick={nextMatch}
          disabled={totalMatches === 0}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 4,
            cursor: totalMatches > 0 ? 'pointer' : 'default',
            opacity: totalMatches > 0 ? 1 : 0.3,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center'
          }}
          title="Next match (Enter)"
        >
          <ChevronDown size={14} color={theme.iconColorMuted} />
        </button>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center'
          }}
          title="Close (Esc)"
        >
          <X size={14} color={theme.iconColorMuted} />
        </button>
      </div>
      {/* Highlight overlay */}
      {containerBounds && highlightRects.length > 0 && (
        <div
          style={{
            position: 'fixed',
            top: containerBounds.top,
            left: containerBounds.left,
            width: containerBounds.width,
            height: containerBounds.height,
            pointerEvents: 'none',
            overflow: 'hidden',
            zIndex: 50
          }}
        >
          {highlightRects.map((rect, idx) => (
            <div
              key={idx}
              style={{
                position: 'absolute',
                top: rect.top - (containerRef.current?.scrollTop || 0),
                left: rect.left,
                width: rect.width,
                height: rect.height,
                backgroundColor:
                  idx === currentIndex - 1 ? 'rgba(255, 150, 0, 0.5)' : 'rgba(255, 200, 0, 0.3)',
                borderRadius: 2,
                transition: 'background-color 0.15s'
              }}
            />
          ))}
        </div>
      )}
    </>
  )
}
