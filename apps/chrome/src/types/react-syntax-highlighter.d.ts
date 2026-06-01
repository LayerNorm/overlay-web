declare module 'react-syntax-highlighter/dist/esm/prism-async-light' {
  import type { ComponentType } from 'react'
  import type { SyntaxHighlighterProps } from 'react-syntax-highlighter'

  const SyntaxHighlighter: ComponentType<SyntaxHighlighterProps>
  export default SyntaxHighlighter
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism/one-dark' {
  import type { CSSProperties } from 'react'

  const style: Record<string, CSSProperties>
  export default style
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism/one-light' {
  import type { CSSProperties } from 'react'

  const style: Record<string, CSSProperties>
  export default style
}
