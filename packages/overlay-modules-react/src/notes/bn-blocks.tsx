'use client'

// React block/inline specs + assembled schema for the BlockNote surface.
// Spec names and prop schemas mirror the headless variants in
// `@overlay/note-doc` (`src/blocks.ts`) so docJson is identical across
// renderers.

import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core'
import {
  createReactMathBlockSpec,
  createReactInlineMathSpec,
} from '@blocknote/math-block'
import {
  createReactBlockSpec,
  createReactInlineContentSpec,
} from '@blocknote/react'
import {
  AlertTriangle,
  Info,
  Lightbulb,
  StickyNote,
  ExternalLink,
} from 'lucide-react'
import {
  alertTagForIcon,
  calloutBlockConfig,
  embedBlockConfig,
  embeddableUrl,
  mentionInlineConfig,
  mentionHref,
  type CalloutIcon,
  type MentionKind,
} from '@overlay/note-doc'

const CALLOUT_ICON_COMPONENTS: Record<
  CalloutIcon,
  { Icon: typeof Info; className: string }
> = {
  note: { Icon: StickyNote, className: 'bn-callout-icon-note' },
  info: { Icon: Info, className: 'bn-callout-icon-info' },
  tip: { Icon: Lightbulb, className: 'bn-callout-icon-tip' },
  warning: { Icon: AlertTriangle, className: 'bn-callout-icon-warning' },
}

export const calloutBlock = createReactBlockSpec(calloutBlockConfig, {
  render: ({ block, contentRef }) => {
    const icon = (block.props.icon as CalloutIcon) ?? 'note'
    const { Icon, className } =
      CALLOUT_ICON_COMPONENTS[icon] ?? CALLOUT_ICON_COMPONENTS.note
    return (
      <div
        className={`bn-callout bn-callout-${icon}`}
        data-callout
        data-callout-icon={icon}
      >
        <span
          className={`bn-callout-icon ${className}`}
          contentEditable={false}
        >
          <Icon size={15} strokeWidth={1.8} />
        </span>
        <div className="bn-callout-content" ref={contentRef} />
      </div>
    )
  },
  toExternalHTML: ({ block, contentRef }) => (
    <blockquote>
      <p>{`[!${alertTagForIcon(block.props.icon as string)}]`}</p>
      <p ref={contentRef} />
    </blockquote>
  ),
})

export const embedBlock = createReactBlockSpec(embedBlockConfig, {
  meta: { isolating: true, selectable: true },
  render: ({ block, editor }) => {
    const url = block.props.url ?? ''
    const embedSrc = url ? embeddableUrl(url) : null
    return (
      <figure className="bn-embed" data-embed-url={url}>
        {embedSrc ? (
          <iframe
            className="bn-embed-frame"
            src={embedSrc}
            title={block.props.caption || 'Embedded content'}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : url ? (
          <a
            className="bn-embed-link"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={14} strokeWidth={1.8} />
            <span>{block.props.caption || url}</span>
          </a>
        ) : (
          <button
            type="button"
            className="bn-embed-empty"
            contentEditable={false}
            onClick={() => {
              const input = window.prompt('Embed URL (YouTube)')
              if (input) editor.updateBlock(block, { props: { url: input } })
            }}
          >
            Add a YouTube URL to embed
          </button>
        )}
      </figure>
    )
  },
  toExternalHTML: ({ block }) => (
    <figure data-embed-url={block.props.url ?? ''}>
      <a href={block.props.url ?? ''}>{block.props.caption || block.props.url}</a>
    </figure>
  ),
})

const MENTION_KIND_COLORS: Record<MentionKind, string> = {
  file: 'bn-mention-file',
  connector: 'bn-mention-connector',
  automation: 'bn-mention-automation',
  skill: 'bn-mention-skill',
  mcp: 'bn-mention-mcp',
  chat: 'bn-mention-chat',
  person: 'bn-mention-person',
}

export const mentionInline = createReactInlineContentSpec(
  mentionInlineConfig,
  {
    render: ({ inlineContent }) => {
      const kind = (inlineContent.props.mentionType ??
        'file') as MentionKind
      return (
        <span
          className={`bn-mention ${MENTION_KIND_COLORS[kind] ?? ''}`}
          data-mention
          data-mention-type={kind}
          data-mention-id={inlineContent.props.mentionId}
          contentEditable={false}
        >
          @{inlineContent.props.label}
        </span>
      )
    },
    toExternalHTML: ({ inlineContent }) => (
      <a
        data-mention
        href={mentionHref(
          inlineContent.props.mentionType,
          inlineContent.props.mentionId,
        )}
      >
        @{inlineContent.props.label}
      </a>
    ),
  },
)

export function createNoteSchema() {
  return BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      math: createReactMathBlockSpec(),
      callout: calloutBlock(),
      embed: embedBlock(),
    },
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      math: createReactInlineMathSpec(),
      mention: mentionInline,
    },
    styleSpecs: {
      ...defaultStyleSpecs,
    },
  })
}

export type NoteSchema = ReturnType<typeof createNoteSchema>

let cachedSchema: NoteSchema | null = null
export function noteSchema(): NoteSchema {
  if (!cachedSchema) cachedSchema = createNoteSchema()
  return cachedSchema
}
