'use client'

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { PromptInputButton } from '@overlay/chat-react'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, Popover, PopoverContent, PopoverTrigger } from '@overlay/ui/primitives'
import type { WorkContextRef } from '@overlay/app-core'
import { labelForLink, safeLinkUrl } from '@/shared/work/context-links'

export function WorkComposerContext({ disabled, onAdd, search }: { disabled?: boolean; onAdd(context: WorkContextRef): void; search(query: string): Promise<WorkContextRef[]> }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ query: string; hits: WorkContextRef[] }>({ query: '', hits: [] })
  const text = query.trim()
  const link = safeLinkUrl(text)
  useEffect(() => {
    if (!open || link || text.length < 2) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void search(text).then(hits => {
        if (!controller.signal.aborted) setResult({ query: text, hits })
      }).catch(() => { if (!controller.signal.aborted) setResult({ query: text, hits: [] }) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [link, open, search, text])
  const pick = (context: WorkContextRef) => { onAdd(context); setQuery(''); setOpen(false) }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><PromptInputButton aria-label="Add context" disabled={disabled}><Plus size={16} /></PromptInputButton></PopoverTrigger>
    <PopoverContent align="start" side="top" className="w-72 max-w-[calc(100vw-2rem)] p-1"><Command shouldFilter={false}>
      <CommandInput placeholder="Find a file, note, chat or paste a link" value={query} onValueChange={setQuery} />
      <CommandList><CommandEmpty>{text.length < 2 ? 'Type to search.' : 'No context found.'}</CommandEmpty>
        {link ? <CommandItem onSelect={() => pick({ type: 'link', id: link, label: labelForLink(link) })}>Add link</CommandItem> : result.query === text ? result.hits.map(hit => <CommandItem key={`${hit.type}:${hit.id}`} onSelect={() => pick(hit)}><span className="truncate">{hit.label}</span><span className="ml-auto text-xs text-(--muted)">{hit.type}</span></CommandItem>) : null}
      </CommandList>
    </Command></PopoverContent>
  </Popover>
}
