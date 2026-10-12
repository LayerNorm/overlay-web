import {
  BlockNoteSchema,
  createBlockSpec,
  createInlineContentSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core'
import {
  createMathBlockConfig,
  mathInlineContentConfig,
  parseBlockMathMLContent,
  parseBlockMathMLElement,
  parseInlineMathMLContent,
  parseInlineMathMLElement,
} from '@blocknote/math-block'
import {
  createCalloutSpecHeadless,
  createEmbedSpecHeadless,
  createMentionSpecHeadless,
} from './blocks'

let cachedSchema: OverlayNoteSchema | null = null

const headlessMathBlockSpec = createBlockSpec(createMathBlockConfig, {
  parse: parseBlockMathMLElement,
  parseContent: parseBlockMathMLContent,
  render: () => {
    const div = document.createElement('div')
    div.className = 'bn-math-block'
    return { dom: div }
  },
  toExternalHTML: (block) => {
    const math = document.createElement('math')
    math.setAttribute('display', 'block')
    const annotation = document.createElement('annotation')
    annotation.setAttribute('encoding', 'application/x-tex')
    annotation.textContent = (block.props as { latex?: string }).latex ?? ''
    math.appendChild(annotation)
    return { dom: math }
  },
})()

const headlessMathInlineSpec = createInlineContentSpec(mathInlineContentConfig, {
  parse: parseInlineMathMLElement,
  parseContent: parseInlineMathMLContent,
  render: (inlineContent) => {
    const span = document.createElement('span')
    span.className = 'bn-math-inline'
    span.textContent = (inlineContent.props as { latex?: string }).latex ?? ''
    return { dom: span }
  },
  toExternalHTML: (inlineContent) => {
    const math = document.createElement('math')
    math.setAttribute('display', 'inline')
    const annotation = document.createElement('annotation')
    annotation.setAttribute('encoding', 'application/x-tex')
    annotation.textContent =
      (inlineContent.props as { latex?: string }).latex ?? ''
    math.appendChild(annotation)
    return { dom: math }
  },
})

/**
 * Block/inline/style spec names shared by every renderer. The React surface in
 * `@overlay/modules-react` mirrors this exact set with React implementations,
 * so `docJson` envelopes are interchangeable between renderers.
 */
export const overlayBlockTypeNames = [
  ...Object.keys(defaultBlockSpecs),
  'math',
  'callout',
  'embed',
] as const

export const overlayInlineTypeNames = [
  ...Object.keys(defaultInlineContentSpecs),
  'math',
  'mention',
] as const

/**
 * DOM-context-only schema: used by conversions on client and server alike.
 * React rendering is intentionally absent (the specs schedule async renders
 * that outlive JSDOM teardown in tests and are wasted work for conversion).
 */
export function createOverlayNoteSchema() {
  return BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      math: headlessMathBlockSpec,
      callout: createCalloutSpecHeadless()(),
      embed: createEmbedSpecHeadless()(),
    },
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      math: headlessMathInlineSpec,
      mention: createMentionSpecHeadless(),
    },
    styleSpecs: {
      ...defaultStyleSpecs,
    },
  })
}

/** Alias kept for call sites that want the explicit name. */
export const createOverlayNoteSchemaHeadless = createOverlayNoteSchema

/** Shared schema instance; safe to reuse (schema is a config object). */
export function overlayNoteSchema(): OverlayNoteSchema {
  if (!cachedSchema) {
    cachedSchema = createOverlayNoteSchema()
  }
  return cachedSchema
}

export type OverlayNoteSchema = ReturnType<typeof createOverlayNoteSchema>
