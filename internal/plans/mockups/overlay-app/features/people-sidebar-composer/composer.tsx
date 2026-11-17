import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BookOpen, Check, Copy, ExternalLink, FileText, MessageSquare, Plug, Server, Sparkles, Zap } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import type { MentionItem } from '@/shared/knowledge/mention-types'
import { AgentCreature } from '@/components/orb/Creature'
import { createMentionChip } from '@/features/chat/components/chat-interface/mention-input-dom'
import { AGENTS } from '../../fixtures/agents'
import { PrincipalAvatar, findPerson } from './identity'
import { PHOTOS } from './photos'

// Proposal 3: tags in the composer show the avatar and the name (no @), links become chips, and both get a hover card.

const CHIP = 'mx-0.5 inline-flex max-w-full cursor-default select-none h-[22px] items-center gap-1 align-middle text-[13px] font-medium leading-5 text-(--foreground) bg-(--surface-elevated) shadow-[inset_0_0_0_1px_var(--border)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--muted-light)]'
const LINK_ATTR = 'data-link-chip'

export function mockChipClass(item: MentionItem): string {
  return item.type === 'person' ? `${CHIP} rounded-full pl-[3px] pr-2` : `${CHIP} rounded-md px-1.5`
}

/** The avatar that leads a person chip. Other tags keep their type icon. */
export function mockChipLead(item: MentionItem): HTMLElement | null {
  if (item.type !== 'person') return null
  const lead = document.createElement('span')
  lead.className = 'flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full'
  const person = findPerson(item.id)
  if (person?.type === 'agent' || item.principalType === 'agent') {
    createRoot(lead).render(<AgentCreature isDefault={item.isDefault ?? person?.isDefault} agent={{ name: item.name, avatarColor: item.avatarColor ?? person?.avatarColor, avatarShape: item.avatarShape ?? person?.avatarShape }} size={16} />)
    return lead
  }
  const photo = item.photoUrl ?? PHOTOS[item.id]
  if (photo) {
    const image = document.createElement('img')
    image.src = photo
    image.alt = ''
    image.className = 'size-full object-cover'
    lead.append(image)
  } else {
    lead.className += ' bg-(--surface-muted)'
    lead.dataset.initial = item.name.trim().slice(0, 1).toUpperCase() || '?'
  }
  return lead
}

type LinkPreview = { title: string; site: string; detail: string; letter: string; color: string }

const KNOWN_LINKS: Record<string, LinkPreview> = {
  'https://github.com/LayerNorm/overlay-web/pull/548': { title: 'Local and Cloud #548', site: 'GitHub', detail: 'Pull request · Merged', letter: 'G', color: '#24292f' },
  'https://www.figma.com/design/q4launch/Launch-page': { title: 'Launch page', site: 'Figma', detail: 'Design file · Edited 2 hours ago', letter: 'F', color: '#a259ff' },
}

function linkPreview(href: string): LinkPreview {
  const known = KNOWN_LINKS[href]
  if (known) return known
  let host = href
  let path = ''
  try { const url = new URL(href); host = url.hostname.replace(/^www\./, ''); path = url.pathname === '/' ? '' : url.pathname } catch { /* Keep the raw text. */ }
  const title = (host + path).length > 34 ? `${(host + path).slice(0, 33)}…` : host + path
  return { title, site: host, detail: 'Link', letter: host.slice(0, 1).toUpperCase(), color: 'var(--muted)' }
}

function favicon(preview: LinkPreview, size: number): HTMLSpanElement {
  const tile = document.createElement('span')
  tile.className = 'flex shrink-0 items-center justify-center rounded-[4px] font-semibold text-white'
  tile.style.cssText = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.62)}px;line-height:1;background:${preview.color}`
  // The letter is drawn by CSS so it never becomes part of the message text.
  tile.dataset.initial = preview.letter
  return tile
}

export function createLinkChip(href: string): HTMLAnchorElement {
  const preview = linkPreview(href)
  const chip = document.createElement('a')
  chip.href = href
  chip.target = '_blank'
  chip.rel = 'noreferrer'
  chip.contentEditable = 'false'
  chip.setAttribute(LINK_ATTR, 'true')
  chip.className = `${CHIP} rounded-md pl-1 pr-1.5 no-underline`
  const label = document.createElement('span')
  label.className = 'truncate'
  label.textContent = preview.title
  chip.append(favicon(preview, 14), label)
  return chip
}

const TYPE_LABEL: Record<string, [string, typeof FileText]> = {
  file: ['File', FileText], knowledge: ['Knowledge', BookOpen], connector: ['Connector', Plug], automation: ['Automation', Zap], skill: ['Skill', Sparkles], mcp: ['MCP server', Server], chat: ['Chat', MessageSquare],
}

function MentionCard({ item }: { item: MentionItem }) {
  const person = item.type === 'person' ? findPerson(item.id) : undefined
  if (!person) {
    const [label, Icon] = TYPE_LABEL[item.type] ?? ['Reference', FileText]
    return (
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-(--surface-subtle) text-(--muted)"><Icon size={16} strokeWidth={1.75} /></span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{item.name}</span>
          <span className="block truncate text-xs text-(--muted)">{item.description ?? label}</span>
        </span>
      </div>
    )
  }
  const agent = AGENTS.find((entry) => entry.principalId === item.id)
  const online = item.id === 'p_sam' || Boolean(agent)
  return (
    <>
      <div className="flex items-center gap-2.5">
        <PrincipalAvatar principalId={item.id} name={item.name} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.name}</span>
          <span className="flex items-center gap-1.5 text-xs text-(--muted)">
            {agent ? 'Agent' : <span className="capitalize">{person.role}</span>}
            <span className={`size-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-(--border)'}`} />
            {agent ? 'Ready' : online ? 'Online' : 'Away'}
          </span>
        </span>
      </div>
      <p className="mt-2.5 text-xs leading-5 text-(--muted)">{agent ? (agent.description as string) : person.email}</p>
      <p className="-mx-3 -mb-3 mt-2.5 border-t border-(--border) px-3 py-2 text-[11px] text-(--muted-light)">
        {agent ? `${item.name} will reply here when you send.` : `${item.name.split(' ')[0]} will be notified when you send.`}
      </p>
    </>
  )
}

function LinkCard({ href }: { href: string }) {
  const preview = linkPreview(href)
  const [copied, setCopied] = useState(false)
  return (
    <>
      <div className="flex items-start gap-2.5">
        <span ref={(node) => { if (node && !node.firstChild) node.append(favicon(preview, 36)) }} className="shrink-0 [&>span]:rounded-lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{preview.title}</span>
          <span className="block truncate text-xs text-(--muted)">{preview.detail}</span>
        </span>
      </div>
      <p className="mt-2.5 truncate font-mono text-[11px] text-(--muted-light)">{href.replace(/^https?:\/\//, '')}</p>
      <div className="-mx-3 -mb-3 mt-2.5 flex gap-1 border-t border-(--border) p-1.5">
        <Button variant="ghost" size="xs" className="h-7 flex-1 gap-1.5 text-xs font-normal text-(--muted)" onClick={() => window.open(href, '_blank', 'noreferrer')}><ExternalLink size={12} />Open</Button>
        <Button variant="ghost" size="xs" className="h-7 flex-1 gap-1.5 text-xs font-normal text-(--muted)" onClick={() => { void navigator.clipboard?.writeText(href); setCopied(true) }}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy link'}</Button>
      </div>
    </>
  )
}

type Hover = { key: string; left: number; bottom: number; content: ReactNode }

/** One hover card for every chip in a composer: opens after a short rest, and stays while the pointer is on it. */
function ComposerHoverCards() {
  const [hover, setHover] = useState<Hover | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const later = (run: () => void, ms: number) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(run, ms) }
    const over = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('[data-chip-card]')) { if (timer.current) clearTimeout(timer.current); return }
      const chip = target.closest<HTMLElement>(`[contenteditable] [data-mention], [contenteditable] [${LINK_ATTR}]`)
      if (!chip) { later(() => setHover(null), 120); return }
      const rect = chip.getBoundingClientRect()
      let content: ReactNode
      try {
        content = chip.hasAttribute(LINK_ATTR) ? <LinkCard href={(chip as HTMLAnchorElement).href} /> : <MentionCard item={JSON.parse(chip.dataset.mentionData ?? '{}') as MentionItem} />
      } catch { return }
      const next: Hover = { key: chip.dataset.mentionData ?? (chip as HTMLAnchorElement).href, left: Math.max(12, Math.min(rect.left, window.innerWidth - 276)), bottom: window.innerHeight - rect.top + 6, content }
      later(() => setHover(next), 220)
    }
    const dismiss = () => { if (timer.current) clearTimeout(timer.current); setHover(null) }
    document.addEventListener('mouseover', over)
    document.addEventListener('keydown', dismiss, true)
    document.addEventListener('scroll', dismiss, true)
    return () => { document.removeEventListener('mouseover', over); document.removeEventListener('keydown', dismiss, true); document.removeEventListener('scroll', dismiss, true) }
  }, [])
  if (!hover) return null
  return (
    <div key={hover.key} data-chip-card role="tooltip" className="overlay-pop-in fixed z-50 w-64 overflow-hidden rounded-xl border border-(--border) bg-(--surface-elevated) p-3 text-(--foreground) shadow-lg" style={{ left: hover.left, bottom: hover.bottom }}>
      {hover.content}
    </div>
  )
}

function insert(editor: HTMLElement, nodes: Array<Node | string>) {
  const selection = window.getSelection()
  const range = selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode) ? selection.getRangeAt(0) : null
  const fragment = document.createDocumentFragment()
  fragment.append(...nodes)
  const last = fragment.lastChild
  if (range) { range.deleteContents(); range.insertNode(fragment) } else editor.append(fragment)
  if (last && selection) { const caret = document.createRange(); caret.setStartAfter(last); caret.collapse(true); selection.removeAllRanges(); selection.addRange(caret) }
  editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
}

const SAMPLE_ROOM = 'k17convchannellaunch000000000000'

function sampleMessage(): Array<Node | string> {
  const atlas = AGENTS.find((agent) => agent.id === 'agent_atlas')!
  return [
    createMentionChip({ type: 'person', id: atlas.principalId, name: atlas.name, principalType: 'agent', avatarColor: atlas.avatarColor, avatarShape: atlas.avatarShape }),
    ' can you check ',
    createLinkChip('https://github.com/LayerNorm/overlay-web/pull/548'),
    ' against ',
    createMentionChip({ type: 'file', id: 'file_pricing', name: 'Pricing benchmark — November', description: 'Note in Files' }),
    ' with ',
    createMentionChip({ type: 'person', id: 'p_sam', name: 'Sam Okafor', principalType: 'human' }),
    ' before the launch post goes out? ',
  ]
}

export function mountComposerMockup() {
  const style = document.createElement('style')
  style.textContent = '[data-initial]::before{content:attr(data-initial)}[data-mention] [data-initial]{font-size:9px;color:var(--muted)}'
  document.head.append(style)
  const node = document.createElement('div')
  document.body.append(node)
  createRoot(node).render(<ComposerHoverCards />)

  // A pasted address becomes a link chip.
  document.addEventListener('paste', (event) => {
    const editor = (event.target as HTMLElement | null)?.closest<HTMLElement>('[contenteditable][role="combobox"]')
    const text = event.clipboardData?.getData('text/plain').trim() ?? ''
    if (!editor || !/^https?:\/\/\S+$/.test(text)) return
    event.preventDefault()
    event.stopPropagation()
    insert(editor, [createLinkChip(text), ' '])
  }, true)

  // The #launch composer opens with a sample message so the chips are there to hover.
  const filled = new WeakSet<Element>()
  new MutationObserver(() => {
    if (!globalThis.location.hash.includes(SAMPLE_ROOM)) return
    const editor = document.querySelector<HTMLElement>('[data-chat-composer] [contenteditable][role="combobox"]')
    if (!editor || filled.has(editor)) return
    filled.add(editor)
    setTimeout(() => {
      const text = editor.textContent?.trim() ?? ''
      // A saved draft comes back as plain text, so the sample is rebuilt as chips.
      if (text && !text.startsWith('@Atlas can you check')) return
      editor.replaceChildren()
      insert(editor, sampleMessage())
    }, 400)
  }).observe(document.body, { childList: true, subtree: true })
}
