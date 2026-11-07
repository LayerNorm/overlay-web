'use client'

/**
 * TipTap suggestion config that mounts our existing two-level <MentionPopup /> and
 * inserts an `overlayMention` node when an item is picked. The popup behaves the same
 * as in the chat composer: starts on the category list, drills into a category, Esc
 * goes back, fuzzy search filters within the active category.
 */

import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import { MentionPopup } from '@/components/mentions/MentionPopup'
import type { MentionCategory, MentionItem, MentionType } from '@/shared/knowledge/mention-types'

interface PopupState {
  query: string
  categories: MentionCategory[]
  selectedCategory: MentionType | null
  position: { x: number; y: number } | null
  loading: boolean
  onSelectItem: (item: MentionItem) => void
  onClose: () => void
}

interface PopupRendererProps {
  state: PopupState
  setState: (next: PopupState) => void
}

function MentionSuggestionPopup({ state, setState }: PopupRendererProps) {
  return (
    <MentionPopup
      categories={state.categories}
      loading={state.loading}
      position={state.position}
      query={state.query}
      selectedCategory={state.selectedCategory}
      onSelectedCategoryChange={(category) => setState({ ...state, selectedCategory: category })}
      onSelect={state.onSelectItem}
      onUploadFile={() => { /* uploads not supported inside TipTap mention dropdown */ }}
      onClose={state.onClose}
    />
  )
}

/**
 * Builds a TipTap Suggestion config around a mention search (the native workspace search). The provided `command`
 * callback inserts the overlayMention node into the editor at the trigger.
 */
export const createOverlayMentionSuggestion = (
  searchMentions: (query: string) => Promise<MentionCategory[]>,
): Omit<SuggestionOptions, 'editor'> => ({
  char: '@',
  allowSpaces: false,
  startOfLine: false,
  // We always show the popup (with category buttons) on bare `@`, so `query` items
  // are not used; we drive UI from a separate `searchMentions` call.
  items: () => [],

  render: () => {
    let component: ReactRenderer<unknown, PopupRendererProps> | null = null
    let state: PopupState = {
      query: '',
      categories: [],
      selectedCategory: null,
      position: null,
      loading: false,
      onSelectItem: () => {},
      onClose: () => {},
    }
    let active = false

    function setState(next: PopupState) {
      state = next
      component?.updateProps({ state, setState })
    }

    // Only the answer for the newest query is shown; a slower answer to an earlier keystroke is dropped.
    let latest = 0
    async function refreshSearch(query: string) {
      const request = ++latest
      try {
        setState({ ...state, loading: true })
        const cats = await searchMentions(query)
        if (!active || request !== latest) return
        setState({ ...state, query, categories: cats, loading: false })
      } catch {
        if (!active || request !== latest) return
        setState({ ...state, query, loading: false })
      }
    }

    return {
      onStart(props: SuggestionProps) {
        active = true
        const rect = props.clientRect?.()
        const position = rect ? { x: rect.left, y: rect.top } : null
        state = {
          query: props.query || '',
          categories: [],
          selectedCategory: null,
          position,
          loading: true,
          onSelectItem: (item: MentionItem) => {
            // Insert a TipTap Mention node and then a trailing space. We pack the
            // entity type into the id as `type:id` so the default Mention extension
            // (which only stores id + label) can round-trip our data.
            props.editor
              .chain()
              .focus()
              .insertContentAt(
                { from: props.range.from, to: props.range.to },
                [
                  {
                    type: 'mention',
                    attrs: {
                      id: `${item.type}:${item.id}`,
                      label: item.name,
                    },
                  },
                  { type: 'text', text: ' ' },
                ],
              )
              .run()
            active = false
            component?.destroy()
            component = null
          },
          onClose: () => {
            active = false
            component?.destroy()
            component = null
          },
        }
        component = new ReactRenderer(MentionSuggestionPopup, {
          props: { state, setState },
          editor: props.editor,
        })
        document.body.appendChild(component.element)
        void refreshSearch(props.query || '')
      },

      onUpdate(props: SuggestionProps) {
        if (!component) return
        const rect = props.clientRect?.()
        const position = rect ? { x: rect.left, y: rect.top } : state.position
        setState({ ...state, position })
        void refreshSearch(props.query || '')
      },

      onKeyDown(props: { event: KeyboardEvent }) {
        // Prevent the editor from inserting newlines / moving cursor while the popup
        // is open. The popup itself listens on `document` for these keys.
        const e = props.event
        if (
          e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'Enter' ||
          e.key === 'Tab' ||
          e.key === 'Escape'
        ) {
          // Returning true tells TipTap to swallow the event.
          return true
        }
        return false
      },

      onExit() {
        active = false
        component?.destroy()
        component = null
      },
    }
  },
})
