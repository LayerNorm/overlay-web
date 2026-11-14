// Client-only Mermaid rendering for ```mermaid fences. The library is loaded on
// first use, so chats without diagrams never download it.

export type MermaidPalette = {
  dark: boolean
  surface: string
  subtle: string
  foreground: string
  muted: string
  edge: string
  stroke: string
  fontFamily: string
}

export type MermaidRenderResult = {
  svg: string
  /** Natural width from the SVG viewBox, in CSS pixels. */
  width: number | null
}

type MermaidApi = typeof import('mermaid').default
type Purify = typeof import('dompurify').default

let libraries: Promise<{ mermaid: MermaidApi; purify: Purify }> | null = null
let initializedKey: string | null = null
let renderQueue: Promise<unknown> = Promise.resolve()
let renderCount = 0

function loadLibraries() {
  libraries ??= Promise.all([import('mermaid'), import('dompurify')])
    .then(([mermaid, purify]) => ({ mermaid: mermaid.default, purify: purify.default }))
    .catch((error) => {
      libraries = null
      throw error
    })
  return libraries
}

const PROBES = {
  surface: 'var(--shell-panel, var(--surface-elevated))',
  subtle: 'var(--surface-subtle)',
  foreground: 'var(--foreground)',
  muted: 'var(--muted)',
  edge: 'var(--muted-light)',
  stroke: 'color-mix(in srgb, var(--foreground) 16%, var(--shell-panel, var(--surface-elevated)))',
} as const

const FALLBACK_LIGHT = {
  surface: '#ffffff', subtle: '#f0f0f0', foreground: '#0a0a0a', muted: '#71717a', edge: '#a1a1aa', stroke: '#d6d6d6',
}
const FALLBACK_DARK = {
  surface: '#111113', subtle: '#1c1c20', foreground: '#f5f5f5', muted: '#a1a1aa', edge: '#71717a', stroke: '#363638',
}

/** Normalizes any CSS color the browser understands (oklch, color-mix, …) to hex. */
function toHex(context: CanvasRenderingContext2D | null, color: string): string | null {
  if (!context) return null
  context.fillStyle = '#010203'
  context.fillStyle = color
  if (context.fillStyle === '#010203' && color.replace(/\s/g, '') !== 'rgb(1,2,3)') return null
  context.clearRect(0, 0, 1, 1)
  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((part) => (part ?? 0).toString(16).padStart(2, '0')).join('')}`
}

/** Reads Overlay's semantic tokens as Mermaid-safe hex colors at `element`. */
export function readMermaidPalette(element: HTMLElement): MermaidPalette {
  const dark = document.documentElement.dataset.theme === 'dark'
  const fallback = dark ? FALLBACK_DARK : FALLBACK_LIGHT
  const probe = document.createElement('span')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.fontFamily = 'var(--font-sans)'
  element.appendChild(probe)
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const colors = { ...fallback }
  try {
    for (const key of Object.keys(PROBES) as Array<keyof typeof PROBES>) {
      probe.style.color = ''
      probe.style.color = PROBES[key]
      const resolved = probe.style.color ? getComputedStyle(probe).color : ''
      colors[key] = (resolved && toHex(context, resolved)) || fallback[key]
    }
    const fontFamily = getComputedStyle(probe).fontFamily || 'ui-sans-serif, system-ui, sans-serif'
    return { dark, ...colors, fontFamily }
  } finally {
    probe.remove()
  }
}

export function mermaidPaletteKey(palette: MermaidPalette): string {
  return JSON.stringify(palette)
}

function mermaidConfig(palette: MermaidPalette) {
  const { surface, subtle, foreground, muted, edge, stroke, fontFamily } = palette
  return {
    startOnLoad: false,
    securityLevel: 'strict' as const,
    theme: 'base' as const,
    look: 'classic' as const,
    suppressErrorRendering: true,
    flowchart: { curve: 'linear' as const, padding: 14 },
    sequence: { actorFontSize: 13, messageFontSize: 13, noteFontSize: 12, width: 120, height: 40, boxMargin: 8, mirrorActors: false },
    fontFamily,
    themeVariables: {
      darkMode: palette.dark,
      background: surface,
      fontFamily,
      fontSize: '13px',
      primaryColor: surface,
      primaryBorderColor: stroke,
      primaryTextColor: foreground,
      secondaryColor: subtle,
      secondaryBorderColor: stroke,
      secondaryTextColor: foreground,
      tertiaryColor: subtle,
      tertiaryBorderColor: stroke,
      tertiaryTextColor: foreground,
      mainBkg: surface,
      nodeBorder: stroke,
      nodeTextColor: foreground,
      textColor: foreground,
      titleColor: foreground,
      lineColor: edge,
      defaultLinkColor: edge,
      edgeLabelBackground: subtle,
      clusterBkg: subtle,
      clusterBorder: stroke,
      noteBkgColor: subtle,
      noteBorderColor: stroke,
      noteTextColor: foreground,
      actorBkg: surface,
      actorBorder: stroke,
      actorTextColor: foreground,
      actorLineColor: edge,
      signalColor: muted,
      signalTextColor: foreground,
      labelBoxBkgColor: surface,
      labelBoxBorderColor: stroke,
      labelTextColor: foreground,
      loopTextColor: foreground,
      sequenceNumberColor: surface,
    },
    themeCSS: [
      '.node, .node * { filter: none !important; }',
      '.node rect, .node polygon, .node circle, .node ellipse, .node path { stroke-width: 1px; }',
      '.node rect { rx: 8px; ry: 8px; }',
      `.edgeLabel, .edgeLabel p, .edgeLabel span { color: ${muted}; font-size: 11px; }`,
      '.flowchart-link { stroke-width: 1.25px; }',
    ].join('\n'),
  }
}

function naturalWidth(svg: string): number | null {
  const viewBox = /viewBox="[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+[\d.]+"/.exec(svg)
  const width = viewBox ? Number(viewBox[1]) : NaN
  return Number.isFinite(width) && width > 0 ? width : null
}

/**
 * Renders one diagram. Calls run one at a time because Mermaid's configuration
 * is global; the palette is reapplied whenever the theme changed.
 */
export function renderMermaidDiagram(source: string, palette: MermaidPalette): Promise<MermaidRenderResult> {
  const job = renderQueue.then(async () => {
    const { mermaid, purify } = await loadLibraries()
    const key = mermaidPaletteKey(palette)
    if (initializedKey !== key) {
      mermaid.initialize(mermaidConfig(palette))
      initializedKey = key
    }
    renderCount += 1
    const { svg } = await mermaid.render(`overlay-mermaid-${renderCount}`, source)
    const clean = purify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true, html: true },
      ADD_TAGS: ['foreignObject', 'style'],
      HTML_INTEGRATION_POINTS: { foreignobject: true },
    })
    return { svg: clean, width: naturalWidth(clean) }
  })
  renderQueue = job.catch(() => undefined)
  return job
}

const TOKEN_LABELS: Record<string, string> = {
  EOF: 'unexpected end of diagram',
  '1': 'unexpected end of diagram',
  NEWLINE: 'unexpected line break',
  SPACE: 'unexpected space',
}

function openSubgraphs(source: string): number {
  let open = 0
  for (const line of source.split('\n')) {
    const word = line.trim().split(/\s+/)[0]?.toLowerCase()
    if (word === 'subgraph') open += 1
    else if (word === 'end' && open > 0) open -= 1
  }
  return open
}

/** Short, single-line form of a Mermaid parse/render error for the fallback note. */
export function shortMermaidError(error: unknown, source = ''): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const lines = message.split('\n').map((line) => line.trim()).filter(Boolean)
  const lineMatch = /line (\d+)/i.exec(lines[0] ?? '')
  const got = /got '([^']+)'/.exec(message)?.[1]
  let summary: string
  if (/no diagram type detected/i.test(message)) {
    summary = 'Unknown diagram type'
  } else if (lineMatch && got) {
    const endOfInput = got === 'EOF' || got === '1'
    const reason = endOfInput && openSubgraphs(source) > 0
      ? 'subgraph is never closed'
      : TOKEN_LABELS[got] ?? `unexpected ${got}`
    summary = `Line ${lineMatch[1]}: ${reason}`
  } else if (lineMatch) {
    summary = `Line ${lineMatch[1]}: syntax error`
  } else {
    summary = lines[0] ?? 'Unknown diagram error'
  }
  return summary.length > 72 ? `${summary.slice(0, 71)}…` : summary
}
