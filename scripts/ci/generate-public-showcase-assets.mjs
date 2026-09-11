import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { jsPDF } from 'jspdf'

const output = join(process.cwd(), 'public', 'showcase')
await mkdir(output, { recursive: true })

const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
pdf.setFont('helvetica', 'bold')
pdf.setFontSize(22)
pdf.text('Private AI deployment report', 54, 72)
pdf.setFont('helvetica', 'normal')
pdf.setFontSize(11)
const pdfLines = pdf.splitTextToSize(
  'Organizations generally choose among hosted private cloud, customer VPC, and on-premises deployment. The right architecture preserves model portability, access control, and auditable tool use.',
  500,
)
pdf.text(pdfLines, 54, 108)
pdf.setDrawColor(210)
pdf.line(54, 160, 558, 160)
pdf.setFontSize(9)
pdf.setTextColor(110)
pdf.text('Deterministic public Overlay showcase fixture', 54, 184)
await writeFile(join(output, 'private-ai-report.pdf'), Buffer.from(pdf.output('arraybuffer')))

const document = new Document({
  sections: [{
    children: [
      new Paragraph({ text: 'Customer research', heading: HeadingLevel.TITLE }),
      new Paragraph({
        children: [new TextRun({
          text: 'Teams value one interface, durable context, provider choice, and clear control over actions.',
          size: 24,
        })],
      }),
      new Paragraph({ text: 'What people want', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: 'Fast time-to-value without giving up control of models, knowledge, tools, or infrastructure.', bullet: { level: 0 } }),
      new Paragraph({ text: 'A workspace that preserves context across chats, notes, projects, and automations.', bullet: { level: 0 } }),
      new Paragraph({ text: 'Actions that remain visible, permissioned, and reviewable.', bullet: { level: 0 } }),
    ],
  }],
})
await writeFile(join(output, 'customer-research.docx'), await Packer.toBuffer(document))

console.log('Generated public showcase PDF and DOCX fixtures.')
