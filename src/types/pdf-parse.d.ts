declare module 'pdf-parse' {
  import type { Buffer } from 'node:buffer'

  function pdfParse(data: Buffer): Promise<{ text?: string }>
  export default pdfParse
}

/** Core parser only — avoids `pdf-parse` root `index.js`, which runs debug code when bundled (ENOENT on test PDF). */
declare module 'pdf-parse/lib/pdf-parse.js' {
  import type { Buffer } from 'node:buffer'

  function pdfParse(data: Buffer): Promise<{ text?: string }>
  export default pdfParse
}
