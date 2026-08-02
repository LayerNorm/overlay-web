declare module 'pdf-parse' {
  import type { Buffer } from 'node:buffer'

  export class PDFParse {
    constructor(options: { data: Buffer | Uint8Array })
    destroy(): Promise<void>
    getText(): Promise<{ text?: string }>
  }
}
