'use client'

import type { Editor } from '@tiptap/react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Sigma,
  SquareCode,
  TextQuote,
  Type,
  Image as ImageIcon,
  SmilePlus,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table2,
  TableCellsMerge,
  TableColumnsSplit,
  TableRowsSplit,
  Trash2,
  Underline as UnderlineIcon,
  Youtube as YoutubeIcon,
} from 'lucide-react'
import type { SlashMenuItem } from './slash-menu'

function promptForValue(message: string, defaultValue = ''): string | null {
  if (typeof window === 'undefined') return null
  const value = window.prompt(message, defaultValue)
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function createSlashMenuItems(editor: Editor | null): SlashMenuItem[] {
  return [
    {
      title: 'Text',
      description: 'Plain paragraph',
      icon: <Type size={16} />,
      command: () => editor?.chain().focus().setParagraph().run(),
      category: 'nodes',
    },
    {
      title: 'Heading 1',
      description: 'Large section heading',
      shortcut: '#',
      icon: <Heading1 size={16} />,
      command: () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
      category: 'nodes',
    },
    {
      title: 'Heading 2',
      description: 'Medium section heading',
      shortcut: '##',
      icon: <Heading2 size={16} />,
      command: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
      category: 'nodes',
    },
    {
      title: 'Heading 3',
      description: 'Small section heading',
      shortcut: '###',
      icon: <Heading3 size={16} />,
      command: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
      category: 'nodes',
    },
    {
      title: 'Bulleted list',
      description: 'Simple bulleted list',
      shortcut: '-',
      icon: <List size={16} />,
      command: () => editor?.chain().focus().toggleBulletList().run(),
      category: 'nodes',
    },
    {
      title: 'Numbered list',
      description: 'List with numbering',
      shortcut: '1.',
      icon: <ListOrdered size={16} />,
      command: () => editor?.chain().focus().toggleOrderedList().run(),
      category: 'nodes',
    },
    {
      title: 'To-do list',
      description: 'Track tasks with checkboxes',
      shortcut: '[]',
      icon: <ListTodo size={16} />,
      command: () => editor?.chain().focus().toggleTaskList().run(),
      category: 'nodes',
    },
    {
      title: 'Quote',
      description: 'Capture a quotation',
      shortcut: '>',
      icon: <TextQuote size={16} />,
      command: () => editor?.chain().focus().toggleBlockquote().run(),
      category: 'nodes',
    },
    {
      title: 'Code',
      description: 'Code block with syntax highlighting',
      shortcut: '```',
      icon: <SquareCode size={16} />,
      command: () => editor?.chain().focus().toggleCodeBlock().run(),
      category: 'nodes',
    },
    {
      title: 'Divider',
      description: 'Separate sections',
      shortcut: '---',
      icon: <Minus size={16} />,
      command: () => editor?.chain().focus().setHorizontalRule().run(),
      category: 'nodes',
    },
    {
      title: 'Equation',
      description: 'Inline math',
      icon: <Sigma size={16} />,
      command: () => editor?.chain().focus().insertContent('$E=mc^2$').run(),
      category: 'media',
    },
    {
      title: 'Table',
      description: 'Markdown table',
      icon: <Table2 size={16} />,
      command: () =>
        editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      category: 'nodes',
    },
    {
      title: 'Image',
      description: 'Embed an image from a URL',
      icon: <ImageIcon size={16} />,
      command: () => {
        const src = promptForValue('Enter image URL:')
        if (src) editor?.chain().focus().setImage({ src }).run()
      },
      category: 'media',
    },
    {
      title: 'YouTube video',
      description: 'Embed a YouTube video',
      icon: <YoutubeIcon size={16} />,
      command: () => {
        const src = promptForValue('Enter YouTube URL:')
        if (src) editor?.chain().focus().setYoutubeVideo({ src }).run()
      },
      category: 'media',
    },
    {
      title: 'Add row above',
      description: 'Add a row above the current row',
      icon: <TableRowsSplit size={16} />,
      command: () => editor?.chain().focus().addRowBefore().run(),
      category: 'table',
    },
    {
      title: 'Add row below',
      description: 'Add a row below the current row',
      icon: <TableRowsSplit size={16} />,
      command: () => editor?.chain().focus().addRowAfter().run(),
      category: 'table',
    },
    {
      title: 'Delete row',
      description: 'Delete the current row',
      icon: <Trash2 size={16} />,
      command: () => editor?.chain().focus().deleteRow().run(),
      category: 'table',
    },
    {
      title: 'Add column before',
      description: 'Add a column before the current column',
      icon: <TableColumnsSplit size={16} />,
      command: () => editor?.chain().focus().addColumnBefore().run(),
      category: 'table',
    },
    {
      title: 'Add column after',
      description: 'Add a column after the current column',
      icon: <TableColumnsSplit size={16} />,
      command: () => editor?.chain().focus().addColumnAfter().run(),
      category: 'table',
    },
    {
      title: 'Delete column',
      description: 'Delete the current column',
      icon: <Trash2 size={16} />,
      command: () => editor?.chain().focus().deleteColumn().run(),
      category: 'table',
    },
    {
      title: 'Merge cells',
      description: 'Merge the current selection',
      icon: <TableCellsMerge size={16} />,
      command: () => editor?.chain().focus().mergeCells().run(),
      category: 'table',
    },
    {
      title: 'Split cell',
      description: 'Split the current cell',
      icon: <TableColumnsSplit size={16} />,
      command: () => editor?.chain().focus().splitCell().run(),
      category: 'table',
    },
    {
      title: 'Delete table',
      description: 'Delete the entire table',
      icon: <TableRowsSplit size={16} />,
      command: () => editor?.chain().focus().deleteTable().run(),
      category: 'table',
    },
    {
      title: 'Bold',
      description: 'Make text bold',
      icon: <Bold size={16} />,
      command: () => editor?.chain().focus().toggleBold().run(),
      category: 'marks',
    },
    {
      title: 'Italic',
      description: 'Make text italic',
      icon: <Italic size={16} />,
      command: () => editor?.chain().focus().toggleItalic().run(),
      category: 'marks',
    },
    {
      title: 'Underline',
      description: 'Underline text',
      icon: <UnderlineIcon size={16} />,
      command: () => editor?.chain().focus().toggleUnderline().run(),
      category: 'marks',
    },
    {
      title: 'Strikethrough',
      description: 'Strike through text',
      icon: <Strikethrough size={16} />,
      command: () => editor?.chain().focus().toggleStrike().run(),
      category: 'marks',
    },
    {
      title: 'Inline code',
      description: 'Inline code formatting',
      icon: <Code size={16} />,
      command: () => editor?.chain().focus().toggleCode().run(),
      category: 'marks',
    },
    {
      title: 'Highlight',
      description: 'Highlight text',
      icon: <Highlighter size={16} />,
      command: () => editor?.chain().focus().toggleHighlight().run(),
      category: 'marks',
    },
    {
      title: 'Align left',
      description: 'Align text to the left',
      icon: <AlignLeft size={16} />,
      command: () => editor?.chain().focus().setTextAlign('left').run(),
      category: 'marks',
    },
    {
      title: 'Align center',
      description: 'Center text',
      icon: <AlignCenter size={16} />,
      command: () => editor?.chain().focus().setTextAlign('center').run(),
      category: 'marks',
    },
    {
      title: 'Align right',
      description: 'Align text to the right',
      icon: <AlignRight size={16} />,
      command: () => editor?.chain().focus().setTextAlign('right').run(),
      category: 'marks',
    },
    {
      title: 'Subscript',
      description: 'Make text subscript',
      icon: <SubscriptIcon size={16} />,
      command: () => editor?.chain().focus().toggleSubscript().run(),
      category: 'marks',
    },
    {
      title: 'Superscript',
      description: 'Make text superscript',
      icon: <SuperscriptIcon size={16} />,
      command: () => editor?.chain().focus().toggleSuperscript().run(),
      category: 'marks',
    },
    {
      title: 'Emoji',
      description: 'Insert an emoji',
      icon: <SmilePlus size={16} />,
      command: () => {
        const emoji = promptForValue('Enter an emoji:', '🙂')
        if (emoji) editor?.chain().focus().insertContent(emoji).run()
      },
      category: 'marks',
    },
  ]
}
