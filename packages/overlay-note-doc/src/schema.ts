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
  createReactMathBlockSpec,
  createReactInlineMathSpec,
  mathInlineContentConfig,
  parseBlockMathMLContent,
  parseBlockMathMLElement,
  parseInlineMathMLContent,
  parseInlineMathMLElement,
} from '@blocknote/math-block'

let cachedSchema: OverlayNoteSchema | null = null

/** Overlay's BlockNote schema: defaults + math block/inline content. */
export function createOverlayNoteSchema() {
  return BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      math: createReactMathBlockSpec(),
    },
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      math: createReactInlineMathSpec(),
    },
    styleSpecs: {
      ...defaultStyleSpecs,
    },
  })
}

/**
 * DOM-context-only schema for headless conversion: same specs minus the React
 * renderers (they schedule async renders that outlive JSDOM teardown).
 */
export function createOverlayNoteSchemaHeadless() {
  return BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      math: createBlockSpec(createMathBlockConfig, {
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
          annotation.textContent =
            (block.props as { latex?: string }).latex ?? ''
          math.appendChild(annotation)
          return { dom: math }
        },
      })(),
    },
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      math: createInlineContentSpec(mathInlineContentConfig, {
        parse: parseInlineMathMLElement,
        parseContent: parseInlineMathMLContent,
        render: (inlineContent) => {
          const span = document.createElement('span')
          span.className = 'bn-math-inline'
          span.textContent =
            (inlineContent.props as { latex?: string }).latex ?? ''
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
      }),
    },
    styleSpecs: {
      ...defaultStyleSpecs,
    },
  })
}

/** Shared schema instance; safe to reuse (schema is a config object). */
export function overlayNoteSchema(): OverlayNoteSchema {
  if (!cachedSchema) {
    cachedSchema = createOverlayNoteSchema()
  }
  return cachedSchema
}

export type OverlayNoteSchema = ReturnType<typeof createOverlayNoteSchema>
