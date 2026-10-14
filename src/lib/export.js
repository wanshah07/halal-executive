// Export the current segment as CSV, PDF or Word. Rows are the same objects
// the table view renders; `columns` = [{key, label}] from the page.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, HeadingLevel } from 'docx'
import { download } from './util'

const cell = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const stamp = () => new Date().toISOString().slice(0, 10)
// A cell that starts with = + - @ would run as a formula in Excel; prefix it.
const esc = (v) => { let c = cell(v); if (/^[=+\-@\t\r]/.test(c)) c = "'" + c; return `"${c.replace(/"/g, '""')}"` }

export function exportCSV(name, rows, columns) {
  const cols = columns && columns.length ? columns : Object.keys(rows[0] || {}).map((k) => ({ key: k, label: k }))
  const text = [cols.map((c) => esc(c.label)).join(','), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(','))].join('\n')
  download(`halal-executive-${name}-${stamp()}.csv`, '﻿' + text, 'text/csv;charset=utf-8')
}

export function exportPDF(name, title, rows, columns) {
  const cols = columns && columns.length ? columns : Object.keys(rows[0] || {}).map((k) => ({ key: k, label: k }))
  const doc = new jsPDF({ orientation: cols.length > 5 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  doc.setFontSize(16); doc.text(`Halal Executive · ${title}`, 40, 40)
  doc.setFontSize(9); doc.setTextColor(100); doc.text(`halalexecutive.kkmhalalconsultant.com · exported ${new Date().toLocaleString('en-MY')} · ${rows.length} rows`, 40, 56)
  autoTable(doc, {
    startY: 70, head: [cols.map((c) => c.label)], body: rows.map((r) => cols.map((c) => cell(r[c.key]))),
    styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' }, headStyles: { fillColor: [11, 107, 58] }, alternateRowStyles: { fillColor: [248, 250, 252] },
    didDrawPage: () => { doc.setFontSize(8); doc.setTextColor(120); doc.text('Developed by Wanshah', 40, doc.internal.pageSize.getHeight() - 20) },
  })
  doc.save(`halal-executive-${name}-${stamp()}.pdf`)
}

export async function exportDOCX(name, title, rows, columns) {
  const cols = columns && columns.length ? columns : Object.keys(rows[0] || {}).map((k) => ({ key: k, label: k }))
  const mk = (t, bold = false) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, bold, size: 18 })] })] })
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, children: cols.map((c) => mk(c.label, true)) }), ...rows.map((r) => new TableRow({ children: cols.map((c) => mk(cell(r[c.key]))) }))],
  })
  const doc = new Document({
    sections: [{ children: [
      new Paragraph({ text: `Halal Executive · ${title}`, heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun({ text: `halalexecutive.kkmhalalconsultant.com · exported ${new Date().toLocaleString('en-MY')} · ${rows.length} rows`, size: 16, color: '666666' })] }),
      table,
      new Paragraph({ children: [new TextRun({ text: 'Developed by Wanshah', size: 16, color: '888888' })] }),
    ] }],
  })
  const blob = await Packer.toBlob(doc)
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `halal-executive-${name}-${stamp()}.docx`; a.click()
}
