'use client'

// Slash menu and @-mention suggestion wiring for the BlockNote surface.

import type {
  AnyBlockSchema,
  BlockNoteEditor,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core'
import {
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from '@blocknote/react'
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions'
import {
  AlertTriangle,
  FileText,
  Globe,
  Megaphone,
} from 'lucide-react'

/** Data source for @-mention suggestions, injected from the app layer. */
export interface NoteMentionItem {
  type: string
  id: string
  name: string
  description?: string
}

export interface NoteMentionCategory {
  type: string
  label: string
  items: NoteMentionItem[]
}

export interface NoteMentionProvider {
  search(query: string): Promise<NoteMentionCategory[]>
}

const CALLOUT_ITEMS = [
  { icon: 'note', title: 'Callout', group: 'Basic blocks' },
  { icon: 'info', title: 'Callout: Info', group: 'Basic blocks' },
  { icon: 'tip', title: 'Callout: Tip', group: 'Basic blocks' },
  { icon: 'warning', title: 'Callout: Warning', group: 'Basic blocks' },
] as const

type NoteEditor = BlockNoteEditor<
  AnyBlockSchema,
  InlineContentSchema,
  StyleSchema
>

export function getOverlaySlashMenuItems(
  editor: NoteEditor,
): DefaultReactSuggestionItem[] {
  const defaults = getDefaultReactSlashMenuItems(editor).filter(
    // The file block duplicates our image/video/audio entries.
    (item) => item.title !== 'File',
  )

  const custom: DefaultReactSuggestionItem[] = CALLOUT_ITEMS.map(
    ({ icon, title, group }) => ({
      title,
      group,
      aliases: ['callout', icon === 'warning' ? 'alert' : icon],
      subtext: icon === 'note' ? 'Highlighted box for notes and tips' : undefined,
      icon:
        icon === 'warning' ? (
          <AlertTriangle size={16} strokeWidth={1.8} />
        ) : icon === 'tip' ? (
          <Megaphone size={16} strokeWidth={1.8} />
        ) : (
          <FileText size={16} strokeWidth={1.8} />
        ),
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, {
          type: 'callout',
          props: { icon },
        } as never)
      },
    }),
  )

  custom.push({
    title: 'Embed',
    group: 'Media',
    aliases: ['embed', 'youtube', 'video', 'iframe'],
    subtext: 'Embed a YouTube video',
    icon: <Globe size={16} strokeWidth={1.8} />,
    onItemClick: () => {
      const input = window.prompt('Embed URL (YouTube)')
      if (!input) return
      insertOrUpdateBlockForSlashMenu(editor, {
        type: 'embed',
        props: { url: input },
      } as never)
    },
  })

  return [...defaults, ...custom]
}

export async function getMentionMenuItems(
  provider: NoteMentionProvider,
  query: string,
  onPick: (item: NoteMentionItem) => void,
): Promise<DefaultReactSuggestionItem[]> {
  const categories = await provider.search(query)
  return categories.flatMap((category) =>
    category.items.map((item) => ({
      title: item.name,
      subtext: item.description ?? category.label,
      group: category.label,
      icon: <FileText size={16} strokeWidth={1.8} />,
      onItemClick: () => onPick(item),
    })),
  )
}
