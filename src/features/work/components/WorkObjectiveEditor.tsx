'use client'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Bold, Italic, List, ListOrdered, Quote } from 'lucide-react'
import { noteMarkdownToEditorHtml, editorHtmlToNoteMarkdown } from '@overlay/app-core/note-markdown'
export function WorkObjectiveEditor({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (markdown: string) => void
  disabled: boolean
}) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: false }),
      Link.configure({
        openOnClick: false,
        protocols: ['http', 'https'],
        autolink: true,
      }),
    ],
    content: noteMarkdownToEditorHtml(value),
    editorProps: {
      attributes: {
        'aria-label': 'Objective',
        role: 'textbox',
        'aria-multiline': 'true',
        class:
          'min-h-20 px-2 py-2 text-sm leading-relaxed outline-none [&_p]:mb-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_a]:underline',
      },
    },
    onUpdate: ({ editor: current }) => onChange(editorHtmlToNoteMarkdown(current.getHTML())),
  })
  return (
    <div className="group/editor rounded-md bg-(--surface-subtle)/40 focus-within:ring-1 focus-within:ring-(--border)">
      {!disabled && editor ? (
        <div className="flex gap-0.5 px-1 pt-1 opacity-0 transition-opacity group-hover/editor:opacity-100 group-focus-within/editor:opacity-100 [@media(hover:none)]:opacity-100">
          {[
            {
              label: 'Bold',
              Icon: Bold,
              run: () => editor.chain().focus().toggleBold().run(),
            },
            {
              label: 'Italic',
              Icon: Italic,
              run: () => editor.chain().focus().toggleItalic().run(),
            },
            {
              label: 'Bullet list',
              Icon: List,
              run: () => editor.chain().focus().toggleBulletList().run(),
            },
            {
              label: 'Numbered list',
              Icon: ListOrdered,
              run: () => editor.chain().focus().toggleOrderedList().run(),
            },
            {
              label: 'Quote',
              Icon: Quote,
              run: () => editor.chain().focus().toggleBlockquote().run(),
            },
          ].map(({ label, Icon, run }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              onClick={run}
              className="rounded p-1.5 text-(--muted) hover:bg-(--surface-subtle)"
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  )
}
