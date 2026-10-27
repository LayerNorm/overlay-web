import { Button } from '@overlay/ui/primitives'
import {
  CodeBlock as CodeBlockRoot,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
  useHighlightedCode,
} from '@overlay/ui/ai'
import { Check, Code2, PanelRightOpen, Play, Plug } from 'lucide-react'
import { Orb } from '@overlay/ui'
import { isValidElement, useId, useState, type ReactNode } from 'react'
import type {
  AttachmentPreview,
  AttachmentPreviewOpenOptions,
} from '../AttachmentPreviewShell'
import { useMarkdownConnectorActions } from './connector-actions-context'

export type MarkdownCodeBlockActions = {
  onOpenAttachmentPreview?: (
    preview: AttachmentPreview,
    options?: AttachmentPreviewOpenOptions,
  ) => void
}

export function extractLinkText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractLinkText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractLinkText((node as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

const CONNECT_SERVICE_DESCRIPTIONS: Record<string, string> = {
  'gmail': 'Compose, send, and search emails',
  'google calendar': 'Read and create calendar events',
  'google sheets': 'Read, update, and create spreadsheets',
  'google drive': 'Search and manage Drive files',
  'google meet': 'Join and manage video meetings',
  'notion': 'Create pages and manage workspace',
  'outlook': 'Send emails and manage calendar',
  'x (twitter)': 'Post tweets and manage your account',
  'twitter': 'Post tweets and manage your account',
  'asana': 'Create tasks and manage projects',
  'linkedin': 'Manage posts and profile actions',
}

function ConnectServiceLogo({ serviceName, logoUrl }: { serviceName: string; logoUrl: string | null }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-(--border) bg-(--surface-subtle) text-(--muted)">
      {logoUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={serviceName} width={20} height={20} className="h-5 w-5 object-contain" onError={() => setFailed(true)} />
      ) : (
        <Plug size={16} strokeWidth={1.75} aria-hidden="true" />
      )}
    </span>
  )
}

/** Card for a model-written `[Connect <app>](url)` link; flips to Connected once the app is linked. */
export function ConnectServiceCard({ serviceName, href }: { serviceName: string; href: string }) {
  const actions = useMarkdownConnectorActions()
  const connected = actions?.isConnected?.(serviceName) ?? false
  const logoUrl = actions?.getLogoUrl?.(serviceName) ?? null
  const description = connected
    ? 'Ready to use'
    : CONNECT_SERVICE_DESCRIPTIONS[serviceName.toLowerCase()] || 'Connect to use this integration'
  const body = (
    <>
      <ConnectServiceLogo serviceName={serviceName} logoUrl={logoUrl} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug text-(--foreground)">{serviceName}</span>
        <span className="block text-xs leading-snug text-(--muted)">{description}</span>
      </span>
    </>
  )
  const cardClass = 'my-1.5 inline-flex max-w-[360px] min-w-[260px] items-center gap-3 rounded-xl border border-(--border) bg-(--surface-elevated) px-3 py-2.5'
  if (connected) {
    return (
      <span data-slot="connect-card" data-state="connected" className={cardClass}>
        {body}
        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-(--muted)">
          <Check size={14} strokeWidth={1.75} aria-hidden="true" />
          Connected
        </span>
      </span>
    )
  }
  if (actions?.connect) {
    return (
      <span data-slot="connect-card" data-state="disconnected" className={cardClass}>
        {body}
        <Button size="sm" variant="primary" className="shrink-0" onClick={() => void actions.connect?.(serviceName)}>
          Connect
        </Button>
      </span>
    )
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="no-underline">
      <span data-slot="connect-card" data-state="disconnected" className={`${cardClass} transition-colors hover:bg-(--surface-subtle)`}>
        {body}
        <span className="shrink-0 whitespace-nowrap rounded-md bg-(--foreground) px-3 py-1.5 text-xs text-(--background)">
          Connect
        </span>
      </span>
    </a>
  )
}

function isHtmlLanguage(language: string): boolean {
  return /^(html?|xhtml)$/i.test(language.trim())
}

function languageLabel(language: string): string {
  return language.trim() || 'code'
}

function HtmlPreviewFrame({ html, title }: { html: string; title: string }) {
  return (
    <iframe
      title={title}
      srcDoc={html}
      sandbox="allow-scripts allow-forms allow-pointer-lock allow-modals"
      className="block h-[clamp(260px,55vh,460px)] w-full border-0 bg-white sm:h-[clamp(320px,58vh,560px)]"
    />
  )
}

function CodeBlockIconButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      data-active={active ? 'true' : undefined}
      className="data-[active=true]:bg-(--foreground)/10 data-[active=true]:text-(--foreground)"
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function HighlightedCode({ code, language }: { code: string; language: string }) {
  const lines = useHighlightedCode(code, language)
  return (
    <CodeBlockContent>
      {lines.map((line, index) => (
        <CodeBlockLine key={index}>{line}</CodeBlockLine>
      ))}
    </CodeBlockContent>
  )
}

// Fenced code: Shiki highlighting, copy, and HTML render controls.
function CodeBlock({
  language,
  children,
  onOpenAttachmentPreview,
}: {
  language: string
  children: string
} & MarkdownCodeBlockActions) {
  const [mode, setMode] = useState<'code' | 'render'>('code')
  const previewTitleId = useId()
  const htmlBlock = isHtmlLanguage(language)

  function handleOpenSidebar() {
    onOpenAttachmentPreview?.({ name: 'html-render.html', content: children }, { mode: 'panel' })
  }

  return (
    <CodeBlockRoot className="my-3">
      <CodeBlockHeader>
        <CodeBlockTitle className="font-mono font-normal text-(--muted)">{languageLabel(language)}</CodeBlockTitle>
        <CodeBlockActions>
          {htmlBlock ? (
            <>
              <CodeBlockIconButton label="Show code" active={mode === 'code'} onClick={() => setMode('code')}>
                <Code2 />
              </CodeBlockIconButton>
              <CodeBlockIconButton label="Render HTML" active={mode === 'render'} onClick={() => setMode('render')}>
                <Play />
              </CodeBlockIconButton>
            </>
          ) : null}
          <CodeBlockCopyButton value={children} />
          {htmlBlock ? (
            <CodeBlockIconButton
              label="Open render in sidebar"
              disabled={!onOpenAttachmentPreview}
              onClick={handleOpenSidebar}
            >
              <PanelRightOpen />
            </CodeBlockIconButton>
          ) : null}
        </CodeBlockActions>
      </CodeBlockHeader>
      {htmlBlock && mode === 'render' ? (
        <div className="mt-2" aria-labelledby={previewTitleId}>
          <span id={previewTitleId} className="sr-only">Rendered HTML preview</span>
          <HtmlPreviewFrame html={children} title="Rendered HTML preview" />
        </div>
      ) : (
        <HighlightedCode code={children} language={language} />
      )}
    </CodeBlockRoot>
  )
}

// Stable markdown components — defined outside component to avoid re-creation
// The fenced `code` override renders a CodeBlock, so its `pre` must not add a box.
function isFencedCodeElement(node: ReactNode): boolean {
  if (!isValidElement(node)) return false
  if (node.type === CodeBlock) return true
  const className = (node.props as { className?: unknown }).className
  return typeof className === 'string' && /language-\w+/.test(className)
}

export const baseMdComponents = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  a({ href, children }: any) {
    const linkText = extractLinkText(children as ReactNode).trim()
    const connectMatch = linkText.match(/^connect\s+(.+)$/i)

    if (connectMatch && href) {
      const serviceName = connectMatch[1].trim()
      return <ConnectServiceCard serviceName={serviceName} href={href} />
    }

    // `/app/...` handling lives in the component-local `a` override so it can
    // close over `appBaseUrl`; see the specialized renderer in MarkdownMessage.
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code({ className, children }: any) {
    const match = /language-(\w+)/.exec(className || '')
    // Block code = has a language class from the fence
    if (match) {
      return (
        <CodeBlock language={match[1]}>
          {String(children).replace(/\n$/, '')}
        </CodeBlock>
      )
    }
    return <code className={className}>{children}</code>
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pre({ children }: any) {
    // Fenced blocks render via CodeBlock, which carries its own surface and
    // padding; unwrapping avoids a second box and div-inside-pre nesting.
    if (isFencedCodeElement(children)) return children
    return <pre>{children}</pre>
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  span({ node: _node, className, children, ...rest }: any) {
    const classes = typeof className === 'string' ? className.split(/\s+/) : []
    // The injected streaming tail arrives as raw HTML; render the orb
    // component inside it instead of a background image.
    if (classes.includes('overlay-stream-marker')) {
      const standalone = classes.includes('overlay-stream-marker--standalone')
      return (
        <span className={className} aria-hidden="true">
          <Orb variant="metal" size={standalone ? 20 : 14} animated={false} label="" />
        </span>
      )
    }
    // KaTeX positions superscripts and struts with inline styles; keep them.
    return <span className={className} {...rest}>{children}</span>
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table({ children }: any) {
    return (
      <div className="table-wrapper">
        <table>{children}</table>
      </div>
    )
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  td({ children }: any) {
    return <td className="align-top [&_p:last-child]:mb-0 [&_ul:last-child]:mb-0 [&_ol:last-child]:mb-0">{children}</td>
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  th({ children }: any) {
    return <th className="align-top">{children}</th>
  },
}

export function createBaseMdComponents(actions: MarkdownCodeBlockActions = {}) {
  return {
    ...baseMdComponents,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    code(props: any) {
      const match = /language-(\w+)/.exec(props.className || '')
      if (match) {
        return (
          <CodeBlock language={match[1]} onOpenAttachmentPreview={actions.onOpenAttachmentPreview}>
            {String(props.children).replace(/\n$/, '')}
          </CodeBlock>
        )
      }
      return <code className={props.className}>{props.children}</code>
    },
  }
}
