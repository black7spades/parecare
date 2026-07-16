import PDFDocument from 'pdfkit';
import { PLAN_SECTIONS, SECTION_LABELS, type PlanContent, type PlanSection } from './carePlanUpdater';

const fieldLabel = (f: string): string => f.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const fieldText = (v: string | number | boolean | null | undefined): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

/**
 * Renders a care plan version as a PDF with the version number and
 * integrity hash embedded in the header, footer and document metadata,
 * so any printed or forwarded copy can be traced back to the exact
 * version it came from.
 */
/** Writes a line of the report's markdown subset, honouring **bold** runs. */
function writeInline(doc: PDFKit.PDFDocument, text: string, size: number, options: PDFKit.Mixins.TextOptions = {}): void {
  const parts = text.split(/(\*\*[^*]+\*\*)/).filter((p) => p.length > 0);
  doc.fontSize(size);
  parts.forEach((part, i) => {
    const bold = part.startsWith('**') && part.endsWith('**');
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
    doc.text(bold ? part.slice(2, -2) : part, { ...options, continued: i < parts.length - 1 });
  });
  doc.font('Helvetica');
}

export function renderPlanPdf(input: {
  profileName: string;
  version: number;
  status: string;
  hash: string;
  createdAt: Date;
  content: PlanContent;
  report: string | null;
  changelog: string | null;
  signatures: Array<{ signer_name: string; signed_at: Date; signature_hash: string }>;
}): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    margin: 48,
    info: {
      Title: `Care Plan, ${input.profileName}, version ${input.version}`,
      Subject: `Version ${input.version}. SHA-256 ${input.hash}`,
      Creator: 'PareCare',
    },
  });

  if (input.report) {
    // The prose clinical report is the document. The title block is its
    // first four lines; the integrity metadata follows it.
    const lines = input.report.split('\n');
    lines.forEach((raw, i) => {
      const line = raw.trimEnd();
      if (i === 0 && line === 'Care Plan') {
        doc.font('Helvetica-Bold').fontSize(20).text(line);
        doc.font('Helvetica');
      } else if (i > 0 && i < 4 && !line.startsWith('#')) {
        doc.fontSize(12).text(line);
        if (i === 3) {
          doc.moveDown(0.25);
          doc.fontSize(8).fillColor('#777777').text(`Integrity hash SHA-256 ${input.hash} · ${input.status.replace(/_/g, ' ')}`);
          doc.fillColor('#000000');
        }
      } else if (line.startsWith('#### ')) {
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(11).text(line.slice(5));
        doc.font('Helvetica');
        doc.moveDown(0.2);
      } else if (line.startsWith('### ')) {
        doc.moveDown(0.9);
        doc.font('Helvetica-Bold').fontSize(13).text(line.slice(4));
        doc.font('Helvetica');
        doc.moveDown(0.25);
      } else if (line.startsWith('* ') || line.startsWith('- ')) {
        writeInline(doc, `•  ${line.slice(2)}`, 10, { indent: 12 });
        doc.moveDown(0.15);
      } else if (line.trim() === '') {
        doc.moveDown(0.3);
      } else {
        writeInline(doc, line, 10);
        doc.moveDown(0.15);
      }
    });
  } else {
    // Versions predating the prose report fall back to the data record.
    doc.fontSize(18).text(`Care plan for ${input.profileName}`);
    doc.moveDown(0.25);
    doc
      .fontSize(9)
      .fillColor('#555555')
      .text(`Version ${input.version} (${input.status.replace(/_/g, ' ')})`)
      .text(`Created ${input.createdAt.toISOString()}`)
      .text(`Integrity hash SHA-256 ${input.hash}`);
    doc.fillColor('#000000');

    for (const section of PLAN_SECTIONS as readonly PlanSection[]) {
      const entries = input.content.sections[section] ?? [];
      if (entries.length === 0) continue;
      doc.moveDown(1);
      doc.fontSize(13).text(SECTION_LABELS[section]);
      doc.moveDown(0.25);
      for (const entry of entries) {
        const parts = Object.entries(entry.fields)
          .filter(([, v]) => v !== null && v !== undefined && v !== '')
          .map(([f, v]) => `${fieldLabel(f)}: ${fieldText(v)}`);
        doc.fontSize(10).text(`• ${parts.join('.  ')}`, { indent: 12 });
        doc.moveDown(0.15);
      }
    }
  }

  if (input.changelog) {
    doc.moveDown(1);
    doc.fontSize(13).text('What changed in this version');
    doc.moveDown(0.25);
    doc.fontSize(9).fillColor('#333333').text(input.changelog);
    doc.fillColor('#000000');
  }

  if (input.signatures.length > 0) {
    doc.moveDown(1);
    doc.fontSize(13).text('Signatures');
    doc.moveDown(0.25);
    for (const s of input.signatures) {
      doc
        .fontSize(9)
        .text(`Signed by ${s.signer_name} at ${new Date(s.signed_at).toISOString()}. Signature hash ${s.signature_hash}.`);
    }
  }

  doc.moveDown(1.5);
  doc
    .fontSize(8)
    .fillColor('#777777')
    .text(`PareCare care plan. Version ${input.version}. SHA-256 ${input.hash}.`);

  doc.end();
  return doc;
}
