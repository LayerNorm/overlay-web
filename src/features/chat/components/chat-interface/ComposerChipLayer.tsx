'use client'

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, ExternalLink, FileText, Link2, MessageSquare, Plug, Server, Sparkles, Zap, type LucideIcon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage, Button, Popover, PopoverAnchor, PopoverContent } from '@overlay/ui/primitives'
import { AgentCreature } from '@/components/orb/Creature'
import type { MentionItem, MentionType } from '@/shared/knowledge/mention-types'
import { composerLinkLabel } from './composer-chips'
import { LINK_CHIP_ATTR, MENTION_ATTR, MENTION_AVATAR_ATTR } from './mention-input-dom'

const OPEN_DELAY_MS = 220
const CLOSE_DELAY_MS = 120

const MENTION_KINDS: Record<Exclude<MentionType, 'person'>, [string, LucideIcon]> = {
  file: ['File', FileText],
  connector: ['Connector', Plug],
  automation: ['Automation', Zap],
  skill: ['Skill', Sparkles],
  mcp: ['MCP server', Server],
  chat: ['Chat', MessageSquare],
}

type HoveredChip =
  | { chip: HTMLElement; kind: 'mention'; item: MentionItem }
  | { chip: HTMLElement; kind: 'link'; href: string }

function readMentionItem(chip: Element | null): MentionItem | null {
  try {
    const item = JSON.parse((chip as HTMLElement | null)?.dataset.mentionData ?? 'null') as MentionItem | null
    return item && typeof item.name === 'string' ? item : null
  } catch {
    return null
  }
}

function readHoveredChip(target: EventTarget | null): HoveredChip | null {
  const chip = target instanceof Element ? target.closest<HTMLElement>(`[${MENTION_ATTR}], [${LINK_CHIP_ATTR}]`) : null
  if (!chip) return null
  const href = chip.getAttribute(LINK_CHIP_ATTR)
  if (href) return { chip, kind: 'link', href }
  const item = readMentionItem(chip)
  return item ? { chip, kind: 'mention', item } : null
}

function MentionCard({ item }: { item: MentionItem }) {
  if (item.type !== 'person') {
    const [label, Icon] = MENTION_KINDS[item.type] ?? ['Reference', FileText]
    return (
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-(--surface-subtle) text-(--muted)">
          <Icon size={16} strokeWidth={1.75} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{item.name}</span>
          <span className="block truncate text-xs text-(--muted)">{item.description ?? label}</span>
        </span>
      </div>
    )
  }
  const agent = item.principalType === 'agent'
  return (
    <>
      <div className="flex items-center gap-2.5">
        {agent ? (
          <AgentCreature
            isDefault={item.isDefault}
            agent={{ name: item.name, avatarColor: item.avatarColor, avatarShape: item.avatarShape }}
            size={36}
          />
        ) : (
          <Avatar className="size-9 shrink-0">
            <AvatarImage src={item.photoUrl ?? undefined} alt="" />
            <AvatarFallback className="text-sm">{item.name.trim().slice(0, 1).toUpperCase() || '?'}</AvatarFallback>
          </Avatar>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.name}</span>
          <span className="block truncate text-xs text-(--muted)">{agent ? 'Agent' : item.description ?? 'Workspace member'}</span>
        </span>
      </div>
      <p className="-mx-3 -mb-3 mt-3 border-t border-(--border) px-3 py-2 text-[11px] text-(--muted-light)">
        {agent
          ? `${item.name} will reply here when you send.`
          : `${item.name.trim().split(/\s+/)[0]} will be notified when you send.`}
      </p>
    </>
  )
}

function LinkCard({ href }: { href: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <>
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-(--surface-subtle) text-(--muted)">
          <Link2 size={16} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{composerLinkLabel(href)}</span>
          <span className="block truncate text-xs text-(--muted)">Link</span>
        </span>
      </div>
      <p className="mt-2.5 truncate font-mono text-[11px] text-(--muted-light)">{href.replace(/^https?:\/\//, '')}</p>
      <div className="-mx-3 -mb-3 mt-2.5 flex gap-1 border-t border-(--border) p-1.5">
        <Button
          variant="ghost"
          size="xs"
          className="h-7 flex-1 gap-1.5 text-xs font-normal text-(--muted)"
          onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}
        >
          <ExternalLink size={12} />
          Open
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="h-7 flex-1 gap-1.5 text-xs font-normal text-(--muted)"
          onClick={() => {
            void navigator.clipboard?.writeText(href).then(() => setCopied(true), () => undefined)
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
    </>
  )
}

/** One hover card for every chip in the editor: opens after a short rest and stays while the pointer is on it. */
function ChipHoverCard({ editorRef }: { editorRef: RefObject<HTMLDivElement | null> }) {
  const [hovered, setHovered] = useState<HoveredChip | null>(null)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const el = editorRef.current
    if (!el) return undefined
    const later = (run: () => void, ms: number) => {
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(run, ms)
    }
    const over = (event: MouseEvent) => {
      const next = readHoveredChip(event.target)
      if (next) later(() => setHovered((current) => (current?.chip === next.chip ? current : next)), OPEN_DELAY_MS)
      else later(() => setHovered(null), CLOSE_DELAY_MS)
    }
    const leave = () => later(() => setHovered(null), CLOSE_DELAY_MS)
    const dismiss = () => {
      window.clearTimeout(timerRef.current)
      setHovered(null)
    }
    el.addEventListener('mouseover', over)
    el.addEventListener('mouseleave', leave)
    el.addEventListener('keydown', dismiss)
    el.addEventListener('scroll', dismiss)
    return () => {
      window.clearTimeout(timerRef.current)
      el.removeEventListener('mouseover', over)
      el.removeEventListener('mouseleave', leave)
      el.removeEventListener('keydown', dismiss)
      el.removeEventListener('scroll', dismiss)
    }
  }, [editorRef])

  const chip = hovered?.chip ?? null
  const virtualRef = useMemo(() => ({ current: chip }), [chip])
  if (!hovered || !hovered.chip.isConnected) return null
  return (
    <Popover open onOpenChange={(open) => { if (!open) setHovered(null) }}>
      <PopoverAnchor virtualRef={virtualRef as RefObject<HTMLElement>} />
      <PopoverContent
        side="top"
        align="start"
        role="tooltip"
        className="w-64 overflow-hidden p-3 text-(--foreground)"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onMouseEnter={() => window.clearTimeout(timerRef.current)}
        onMouseLeave={() => {
          window.clearTimeout(timerRef.current)
          timerRef.current = window.setTimeout(() => setHovered(null), CLOSE_DELAY_MS)
        }}
      >
        {hovered.kind === 'link' ? <LinkCard key={hovered.href} href={hovered.href} /> : <MentionCard item={hovered.item} />}
      </PopoverContent>
    </Popover>
  )
}

/** Renders each agent chip's creature into the avatar slot the chip leaves empty. */
function AgentChipAvatars({ editorRef }: { editorRef: RefObject<HTMLDivElement | null> }) {
  const [slots, setSlots] = useState<Array<{ element: HTMLElement; key: number }>>([])

  useEffect(() => {
    const el = editorRef.current
    if (!el) return undefined
    const keys = new WeakMap<HTMLElement, number>()
    let nextKey = 0
    const sync = () => {
      const next = Array.from(el.querySelectorAll<HTMLElement>(`[${MENTION_AVATAR_ATTR}]`))
      setSlots((current) => {
        if (current.length === next.length && current.every((slot, index) => slot.element === next[index])) return current
        return next.map((element) => {
          if (!keys.has(element)) keys.set(element, nextKey++)
          return { element, key: keys.get(element)! }
        })
      })
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(el, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [editorRef])

  return slots.map((slot) => {
    const item = readMentionItem(slot.element.closest(`[${MENTION_ATTR}]`))
    if (!item) return null
    return createPortal(
      <AgentCreature
        isDefault={item.isDefault}
        agent={{ name: item.name, avatarColor: item.avatarColor, avatarShape: item.avatarShape }}
        size={16}
      />,
      slot.element,
      String(slot.key),
    )
  })
}

export function ComposerChipLayer({ editorRef }: { editorRef: RefObject<HTMLDivElement | null> }) {
  return (
    <>
      <AgentChipAvatars editorRef={editorRef} />
      <ChipHoverCard editorRef={editorRef} />
    </>
  )
}
