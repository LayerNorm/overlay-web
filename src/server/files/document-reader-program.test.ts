import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DOCUMENT_READER_PROGRAM } from './document-reader-program'

const python = process.env.PYMUPDF_TEST_PYTHON ?? 'python3'
const runtimeAvailable = spawnSync(python, ['-c', 'import pymupdf; assert pymupdf.VersionBind == "1.26.7"'], { stdio: 'ignore' }).status === 0

const fixtureProgram = String.raw`
import pymupdf, sys
output, blank = sys.argv[1:3]
doc = pymupdf.open()
page = doc.new_page(width=612, height=792)
page.insert_text((72, 72), "PAGE ONE TEXT")
page = doc.new_page(width=612, height=792)
for x in (50, 200, 350):
    page.draw_line((x, 80), (x, 180))
for y in (80, 130, 180):
    page.draw_line((50, y), (350, y))
page.insert_text((60, 110), "NAME")
page.insert_text((210, 110), "VALUE")
page.insert_text((60, 160), "TOTAL")
page.insert_text((210, 160), "42")
scratch = pymupdf.open()
scan = scratch.new_page(width=300, height=100)
scan.insert_text((12, 60), "SCANNED OCR", fontsize=24)
scan_image = scan.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False).tobytes("png")
page.insert_image(pymupdf.Rect(50, 250, 350, 350), stream=scan_image)
doc.save(output)
doc.close()
empty = pymupdf.open()
empty.new_page(width=612, height=792)
empty.save(blank)
empty.close()
`

function structuredOutput(stdout: string): Record<string, unknown> {
  const parsed = stdout.trim().split(/\r?\n/).reverse().map(line => {
    try { return JSON.parse(line) as Record<string, unknown> } catch { return null }
  }).find(value => value && typeof value === 'object' && ('pageCount' in value || 'error' in value))
  assert.ok(parsed, `expected structured reader output, received: ${stdout}`)
  return parsed
}

test('DOCUMENT_READER_PROGRAM reads, renders, extracts tables, and reports scan OCR capability', {
  skip: runtimeAvailable ? false : 'requires PyMuPDF 1.26.7; set PYMUPDF_TEST_PYTHON to its interpreter',
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'document-reader-test-'))
  try {
    const fixtureScript = join(directory, 'fixture.py')
    const pdfPath = join(directory, 'two-pages.pdf')
    const blankPdfPath = join(directory, 'blank.pdf')
    await writeFile(fixtureScript, fixtureProgram)
    execFileSync(python, [fixtureScript, pdfPath, blankPdfPath])
    const programPath = join(directory, 'reader.py')
    await writeFile(programPath, DOCUMENT_READER_PROGRAM)
    const imagePath = join(directory, 'page.png')
    const run = (source: string, page: number, mode: string) => {
      const result = spawnSync(python, [programPath, source, imagePath, String(page), mode], { encoding: 'utf8' })
      return { ...result, output: structuredOutput(result.stdout) }
    }

    const text = run(pdfPath, 1, 'text')
    assert.equal(text.status, 0)
    assert.equal(text.output.pageCount, 2)
    assert.match(String(text.output.text), /PAGE ONE TEXT/)

    const rendered = run(pdfPath, 1, 'render')
    assert.equal(rendered.status, 0)
    assert.ok(Number(rendered.output.imageWidth) <= 2048)
    assert.ok(Number(rendered.output.imageHeight) <= 2048)
    assert.ok((await readFile(imagePath)).byteLength > 0)

    const tables = run(pdfPath, 2, 'tables')
    assert.equal(tables.status, 0)
    assert.equal(tables.output.requiresVerification, true)
    assert.ok(Array.isArray(tables.output.tables) && tables.output.tables.length > 0)

    const ocr = run(pdfPath, 2, 'ocr')
    if (ocr.status === 0) {
      assert.equal(ocr.output.requiresVerification, true)
      assert.match(String(ocr.output.text), /SCANNED/i)
    } else {
      assert.equal(ocr.output.message, 'OCR_UNAVAILABLE')
    }

    const missingPage = run(pdfPath, 3, 'text')
    assert.equal(missingPage.status, 1)
    assert.equal(missingPage.output.message, 'Page is outside the document')

    const blank = run(blankPdfPath, 1, 'text')
    assert.equal(blank.status, 0)
    assert.equal(blank.output.needsVisualInspection, true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
