import { Button } from '@overlay/ui/primitives'
import {
  CodeBlock as CodeBlockRoot,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFooter,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
  useHighlightedCode,
} from '@overlay/ui/ai'
import { Info } from 'lucide-react'
import { useEffect, useRef, useState, type Ref, type RefObject } from 'react'
import { useIsCodeFenceIncomplete } from 'streamdown'

export type MermaidDiagramState =
  | { status: 'pending' }
  | { status: 'ready'; svg: string; width: number | null }
  | { status: 'error'; error: string }

export type MermaidView = 'diagram' | 'code'

export const MERMAID_FALLBACK_NOTE = 'Couldn’t draw this diagram, so the code is shown instead.'

/** Diagrams shrink to fit the block down to this share of their natural width, then scroll. */
const MIN_DIAGRAM_SCALE = 0.75

const THEME_ATTRIBUTES = ['data-theme', 'data-theme-preset', 'style', 'class']

/** Renders `source` once `enabled`, and again whenever the app theme changes. */
function useMermaidDiagram(source: string, enabled: boolean, ref: RefObject<HTMLDivElement | null>) {
  const [state, setState] = useState<MermaidDiagramState>({ status: 'pending' })

  useEffect(() => {
    const element = ref.current
    if (!enabled || !element) return
    let cancelled = false
    let renderedKey: string | null = null

    async function draw() {
      const { readMermaidPalette, mermaidPaletteKey, renderMermaidDiagram, shortMermaidError } =
        await import('./mermaid-render')
      if (cancelled || !element) return
      const palette = readMermaidPalette(element)
      const key = mermaidPaletteKey(palette)
      if (key === renderedKey) return
      renderedKey = key
      try {
        const result = await renderMermaidDiagram(source, palette)
        if (!cancelled) setState({ status: 'ready', svg: result.svg, width: result.width })
      } catch (error) {
        if (!cancelled) setState({ status: 'error', error: shortMermaidError(error, source) })
      }
    }

    void draw()
    const observer = new MutationObserver(() => void draw())
    observer.observe(document.documentElement, { attributes: true, attributeFilter: THEME_ATTRIBUTES })
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [source, enabled, ref])

  return state
}

function MermaidSource({ source }: { source: string }) {
  const lines = useHighlightedCode(source, 'mermaid')
  return (
    <CodeBlockContent>
      {lines.map((line, index) => (
        <CodeBlockLine key={index}>{line}</CodeBlockLine>
      ))}
    </CodeBlockContent>
  )
}

const toggleButtonClass =
  'h-[22px] rounded-md px-2 text-xs font-[450] text-(--muted) hover:bg-transparent hover:text-(--foreground) data-[active=true]:bg-[var(--shell-panel,var(--surface-elevated))] data-[active=true]:text-(--foreground) data-[active=true]:shadow-[0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)] data-[active=true]:hover:bg-[var(--shell-panel,var(--surface-elevated))]'

function ViewToggle({ view, onViewChange }: { view: MermaidView; onViewChange: (view: MermaidView) => void }) {
  return (
    <div role="group" aria-label="Block view" className="inline-flex items-center gap-0.5 rounded-lg bg-(--foreground)/5 p-0.5">
      {(['diagram', 'code'] as const).map((option) => (
        <Button
          key={option}
          variant="ghost"
          size="xs"
          className={toggleButtonClass}
          data-active={view === option ? 'true' : undefined}
          aria-pressed={view === option}
          onClick={() => onViewChange(option)}
        >
          {option === 'diagram' ? 'Diagram' : 'Code'}
        </Button>
      ))}
    </div>
  )
}

function DiagramSvg({ svg, width }: { svg: string; width: number | null }) {
  return (
    <div
      className="mx-auto w-full [&>svg]:block [&>svg]:h-auto [&>svg]:w-full [&>svg]:max-w-full"
      style={width ? { maxWidth: width, minWidth: Math.round(width * MIN_DIAGRAM_SCALE) } : undefined}
      // Mermaid output is rendered with securityLevel 'strict' and sanitized again with DOMPurify.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/** Presentational mermaid block; exported for render tests. */
export function MermaidCodeBlockView({
  source,
  incomplete,
  diagram,
  view,
  onViewChange,
  rootRef,
}: {
  source: string
  incomplete: boolean
  diagram: MermaidDiagramState
  view: MermaidView
  onViewChange: (view: MermaidView) => void
  rootRef?: Ref<HTMLDivElement>
}) {
  const failed = !incomplete && diagram.status === 'error'
  const showToggle = !incomplete && !failed
  const showDiagram = showToggle && view === 'diagram' && diagram.status === 'ready'

  return (
    <CodeBlockRoot
      ref={rootRef}
      className="my-3 has-[>[data-slot=code-block-diagram]:focus-visible]:ring-3 has-[>[data-slot=code-block-diagram]:focus-visible]:ring-(--foreground)/15"
    >
      <CodeBlockHeader>
        <CodeBlockTitle className="font-mono font-normal text-(--muted)">mermaid</CodeBlockTitle>
        <CodeBlockActions>
          {showToggle ? <ViewToggle view={view} onViewChange={onViewChange} /> : null}
          <CodeBlockCopyButton value={source} />
        </CodeBlockActions>
      </CodeBlockHeader>
      {showDiagram ? (
        <div
          data-slot="code-block-diagram"
          tabIndex={0}
          role="img"
          aria-label="Mermaid diagram"
          className="min-w-0 overflow-auto px-4 pt-3 pb-5 outline-none [scrollbar-width:thin] max-md:px-3 max-md:pt-2 max-md:pb-4"
        >
          <DiagramSvg svg={diagram.svg} width={diagram.width} />
        </div>
      ) : (
        <MermaidSource source={source} />
      )}
      {failed ? (
        <CodeBlockFooter className="flex-wrap items-start gap-1.5 pt-0.5 text-xs md:flex-nowrap md:items-center">
          <Info size={13} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 md:mt-0" />
          <span className="min-w-0 max-md:flex-1">{MERMAID_FALLBACK_NOTE}</span>
          <span
            title={diagram.error}
            className="min-w-0 font-mono text-[11px] text-(--muted-light) max-md:ms-[19px] max-md:w-full md:ms-auto md:truncate"
          >
            {diagram.error}
          </span>
        </CodeBlockFooter>
      ) : null}
    </CodeBlockRoot>
  )
}

/**
 * A ```mermaid fence: the diagram by default, with a Diagram/Code toggle. While the
 * fence is still streaming it shows the source; if Mermaid cannot draw it, the
 * source stays visible with a short note.
 */
export function MermaidCodeBlock({ source }: { source: string }) {
  const incomplete = useIsCodeFenceIncomplete()
  const rootRef = useRef<HTMLDivElement>(null)
  const diagram = useMermaidDiagram(source, !incomplete, rootRef)
  const [view, setView] = useState<MermaidView>('diagram')
  return (
    <MermaidCodeBlockView
      rootRef={rootRef}
      source={source}
      incomplete={incomplete}
      diagram={diagram}
      view={view}
      onViewChange={setView}
    />
  )
}
