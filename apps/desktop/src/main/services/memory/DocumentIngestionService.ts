/**
 * DocumentIngestionService - Parses and extracts text from various document formats
 * Supports: PDF, DOCX, CSV, Markdown, and plain text.
 */

import { readFileSync } from 'fs'
import { extname, basename } from 'path'

export interface DocumentMetadata {
  id: string
  filename: string
  filepath: string
  mimeType: string
  size: number
  pageCount?: number
  createdAt: number
  folderId?: string | null
  chatId?: string | null
}

export interface ParsedDocument {
  metadata: DocumentMetadata
  content: string
  chunks: DocumentChunk[]
  summary?: string
}

export interface DocumentChunk {
  text: string
  chunkIndex: number
  pageNumber?: number
  metadata?: Record<string, unknown>
}

export type SupportedFormat = 'pdf' | 'docx' | 'csv' | 'md' | 'txt'

const MIME_TYPES: Record<SupportedFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  csv: 'text/csv',
  md: 'text/markdown',
  txt: 'text/plain'
}

const CHUNK_SIZE = 1000 // characters per chunk
const CHUNK_OVERLAP = 100 // overlap between chunks

export class DocumentIngestionService {
  private static instance: DocumentIngestionService

  static getInstance(): DocumentIngestionService {
    if (!DocumentIngestionService.instance) {
      DocumentIngestionService.instance = new DocumentIngestionService()
    }
    return DocumentIngestionService.instance
  }

  /**
   * Check if a file format is supported
   */
  isSupported(filepath: string): boolean {
    const ext = extname(filepath).toLowerCase().slice(1)
    return ['pdf', 'docx', 'csv', 'md', 'markdown', 'txt'].includes(ext)
  }

  /**
   * Get the format from a file path
   */
  getFormat(filepath: string): SupportedFormat | null {
    const ext = extname(filepath).toLowerCase().slice(1)
    if (['pdf', 'docx', 'csv', 'txt'].includes(ext)) {
      return ext as SupportedFormat
    }
    if (ext === 'md' || ext === 'markdown') {
      return 'md'
    }
    return null
  }

  /**
   * Parse a document and extract its content
   */
  async parseDocument(
    filepath: string,
    options?: {
      folderId?: string | null
      chatId?: string | null
      generateSummary?: boolean
    }
  ): Promise<ParsedDocument> {
    const format = this.getFormat(filepath)
    if (!format) {
      throw new Error(`Unsupported file format: ${filepath}`)
    }

    const stats = await import('fs').then((fs) => fs.statSync(filepath))
    // Generate deterministic ID based on filepath + chatId/folderId
    // This ensures re-uploading the same document reuses the same ID
    const crypto = await import('crypto')
    const idBase = `${filepath}:${options?.chatId || ''}:${options?.folderId || ''}`
    const hash = crypto.createHash('md5').update(idBase).digest('hex').slice(0, 12)
    const id = `doc_${hash}`

    const metadata: DocumentMetadata = {
      id,
      filename: basename(filepath),
      filepath,
      mimeType: MIME_TYPES[format],
      size: stats.size,
      createdAt: Date.now(),
      folderId: options?.folderId,
      chatId: options?.chatId
    }

    let content: string
    let pageCount: number | undefined

    switch (format) {
      case 'pdf': {
        const pdfResult = await this.parsePDF(filepath)
        content = pdfResult.text
        pageCount = pdfResult.pageCount
        break
      }
      case 'docx':
        content = await this.parseDOCX(filepath)
        break
      case 'csv':
        content = await this.parseCSV(filepath)
        break
      case 'md':
        content = await this.parseMarkdown(filepath)
        break
      case 'txt':
        content = await this.parsePlainText(filepath)
        break
      default:
        throw new Error(`Unsupported format: ${format}`)
    }

    metadata.pageCount = pageCount

    // Chunk the content
    const chunks = this.chunkContent(content)

    return {
      metadata,
      content,
      chunks
    }
  }

  /**
   * Parse PDF file using pdf-parse v2.x
   * @see https://www.npmjs.com/package/pdf-parse
   */
  private async parsePDF(filepath: string): Promise<{ text: string; pageCount: number }> {
    try {
      const { PDFParse } = await import('pdf-parse')
      const buffer = readFileSync(filepath)

      // Create parser with buffer data
      const parser = new PDFParse({ data: buffer })
      const result = await parser.getText()

      // Clean up parser resources
      await parser.destroy()

      return {
        text: result.text,
        pageCount: result.total
      }
    } catch (error) {
      console.error('[DocumentIngestion] PDF parse error:', error)
      throw new Error(`Failed to parse PDF: ${error}`)
    }
  }

  /**
   * Parse DOCX file
   */
  private async parseDOCX(filepath: string): Promise<string> {
    try {
      const mammoth = await import('mammoth')
      const buffer = readFileSync(filepath)
      const result = await mammoth.extractRawText({ buffer })
      return result.value
    } catch (error) {
      console.error('[DocumentIngestion] DOCX parse error:', error)
      throw new Error(`Failed to parse DOCX: ${error}`)
    }
  }

  /**
   * Parse CSV file
   */
  private async parseCSV(filepath: string): Promise<string> {
    try {
      const { parse } = await import('csv-parse/sync')
      const content = readFileSync(filepath, 'utf-8')
      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      }) as Record<string, string>[]

      // Convert to readable text format
      if (records.length === 0) {
        return ''
      }

      const headers = Object.keys(records[0])
      const lines = records.map((row) => {
        return headers.map((h) => `${h}: ${row[h]}`).join(', ')
      })

      return `Columns: ${headers.join(', ')}\n\n${lines.join('\n')}`
    } catch (error) {
      console.error('[DocumentIngestion] CSV parse error:', error)
      throw new Error(`Failed to parse CSV: ${error}`)
    }
  }

  /**
   * Parse Markdown file
   */
  private async parseMarkdown(filepath: string): Promise<string> {
    try {
      const content = readFileSync(filepath, 'utf-8')
      return content
    } catch (error) {
      console.error('[DocumentIngestion] Markdown parse error:', error)
      throw new Error(`Failed to parse Markdown: ${error}`)
    }
  }

  /**
   * Parse Plain Text file
   */
  private async parsePlainText(filepath: string): Promise<string> {
    try {
      const content = readFileSync(filepath, 'utf-8')
      return content
    } catch (error) {
      console.error('[DocumentIngestion] Plain text parse error:', error)
      throw new Error(`Failed to parse plain text: ${error}`)
    }
  }

  /**
   * Chunk content into smaller pieces for embedding
   */
  private chunkContent(content: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = []
    const cleanContent = content.replace(/\s+/g, ' ').trim()

    if (cleanContent.length <= CHUNK_SIZE) {
      return [{ text: cleanContent, chunkIndex: 0 }]
    }

    let startIndex = 0
    let chunkIndex = 0

    while (startIndex < cleanContent.length) {
      let endIndex = startIndex + CHUNK_SIZE

      // Try to break at sentence boundary
      if (endIndex < cleanContent.length) {
        const lastPeriod = cleanContent.lastIndexOf('.', endIndex)
        const lastNewline = cleanContent.lastIndexOf('\n', endIndex)
        const breakPoint = Math.max(lastPeriod, lastNewline)

        if (breakPoint > startIndex + CHUNK_SIZE / 2) {
          endIndex = breakPoint + 1
        }
      }

      const chunkText = cleanContent.slice(startIndex, endIndex).trim()
      if (chunkText) {
        chunks.push({
          text: chunkText,
          chunkIndex
        })
        chunkIndex++
      }

      startIndex = endIndex - CHUNK_OVERLAP
      if (startIndex >= cleanContent.length) break
    }

    return chunks
  }

  /**
   * Get supported file extensions
   */
  getSupportedExtensions(): string[] {
    return ['pdf', 'docx', 'csv', 'md', 'txt']
  }

  /**
   * Get mime type for format
   */
  getMimeType(format: SupportedFormat): string {
    return MIME_TYPES[format]
  }
}

export function getDocumentIngestionService(): DocumentIngestionService {
  return DocumentIngestionService.getInstance()
}
