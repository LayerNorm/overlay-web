import { useEffect, useMemo, useState } from 'react'
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light'
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark'
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light'

type PrismLanguage = Parameters<typeof SyntaxHighlighter.registerLanguage>[1]
type LanguageModule = { default: PrismLanguage }
type LanguageLoader = () => Promise<LanguageModule>

const LANGUAGE_ALIASES: Record<string, string> = {
  cjs: 'javascript',
  cs: 'csharp',
  html: 'markup',
  js: 'javascript',
  md: 'markdown',
  mjs: 'javascript',
  py: 'python',
  shell: 'bash',
  sh: 'bash',
  ts: 'typescript',
  yml: 'yaml',
  xml: 'markup',
}

const LANGUAGE_LOADERS: Record<string, LanguageLoader> = {
  bash: () => import('react-syntax-highlighter/dist/esm/languages/prism/bash'),
  c: () => import('react-syntax-highlighter/dist/esm/languages/prism/c'),
  cpp: () => import('react-syntax-highlighter/dist/esm/languages/prism/cpp'),
  csharp: () => import('react-syntax-highlighter/dist/esm/languages/prism/csharp'),
  css: () => import('react-syntax-highlighter/dist/esm/languages/prism/css'),
  diff: () => import('react-syntax-highlighter/dist/esm/languages/prism/diff'),
  docker: () => import('react-syntax-highlighter/dist/esm/languages/prism/docker'),
  go: () => import('react-syntax-highlighter/dist/esm/languages/prism/go'),
  java: () => import('react-syntax-highlighter/dist/esm/languages/prism/java'),
  javascript: () => import('react-syntax-highlighter/dist/esm/languages/prism/javascript'),
  json: () => import('react-syntax-highlighter/dist/esm/languages/prism/json'),
  jsx: () => import('react-syntax-highlighter/dist/esm/languages/prism/jsx'),
  kotlin: () => import('react-syntax-highlighter/dist/esm/languages/prism/kotlin'),
  markdown: () => import('react-syntax-highlighter/dist/esm/languages/prism/markdown'),
  markup: () => import('react-syntax-highlighter/dist/esm/languages/prism/markup'),
  php: () => import('react-syntax-highlighter/dist/esm/languages/prism/php'),
  python: () => import('react-syntax-highlighter/dist/esm/languages/prism/python'),
  ruby: () => import('react-syntax-highlighter/dist/esm/languages/prism/ruby'),
  rust: () => import('react-syntax-highlighter/dist/esm/languages/prism/rust'),
  sql: () => import('react-syntax-highlighter/dist/esm/languages/prism/sql'),
  swift: () => import('react-syntax-highlighter/dist/esm/languages/prism/swift'),
  tsx: () => import('react-syntax-highlighter/dist/esm/languages/prism/tsx'),
  typescript: () => import('react-syntax-highlighter/dist/esm/languages/prism/typescript'),
  yaml: () => import('react-syntax-highlighter/dist/esm/languages/prism/yaml'),
}

const loadedLanguages = new Set<string>()
const languageLoads = new Map<string, Promise<boolean>>()

function canonicalLanguage(language: string): string {
  const normalized = language.trim().toLowerCase()
  return LANGUAGE_ALIASES[normalized] ?? normalized
}

function ensureLanguage(language: string): Promise<boolean> {
  if (!LANGUAGE_LOADERS[language]) return Promise.resolve(false)
  if (loadedLanguages.has(language)) return Promise.resolve(true)
  const pending = languageLoads.get(language)
  if (pending) return pending

  const load = LANGUAGE_LOADERS[language]()
    .then((module) => {
      SyntaxHighlighter.registerLanguage(language, module.default)
      loadedLanguages.add(language)
      return true
    })
    .catch(() => false)
    .finally(() => {
      languageLoads.delete(language)
    })
  languageLoads.set(language, load)
  return load
}

export default function LazySyntaxHighlighter({
  children,
  isDark,
  language,
}: {
  children: string | string[]
  isDark: boolean
  language: string
}) {
  const normalizedLanguage = useMemo(() => canonicalLanguage(language), [language])
  const [readyLanguage, setReadyLanguage] = useState<string | null>(() => (
    loadedLanguages.has(normalizedLanguage) ? normalizedLanguage : null
  ))
  const languageReady =
    loadedLanguages.has(normalizedLanguage) || readyLanguage === normalizedLanguage

  useEffect(() => {
    let cancelled = false
    void ensureLanguage(normalizedLanguage).then((ready) => {
      if (!cancelled && ready) setReadyLanguage(normalizedLanguage)
    })
    return () => {
      cancelled = true
    }
  }, [normalizedLanguage])

  if (!languageReady) {
    return (
      <pre
        className="m-0 overflow-x-auto p-3 text-sm"
        style={{
          borderRadius: '0 0 10px 10px',
          background: isDark ? 'transparent' : '#f8f8f8',
          fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
          fontSize: '0.85rem',
          lineHeight: '1.6',
        }}
      >
        <code>{children}</code>
      </pre>
    )
  }

  return (
    <SyntaxHighlighter
      style={isDark ? oneDark : oneLight}
      language={normalizedLanguage}
      PreTag="div"
      customStyle={{
        margin: 0,
        borderRadius: '0 0 10px 10px',
        background: isDark ? 'transparent' : '#f8f8f8',
        fontSize: '0.85rem',
        lineHeight: '1.6',
      }}
      codeTagProps={{
        style: { fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace" },
      }}
    >
      {children}
    </SyntaxHighlighter>
  )
}
