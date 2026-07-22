import zlib from 'zlib';

/**
 * Pull readable text out of an uploaded file so the assistant can classify it
 * and file what it finds. Text-based PDFs and plain text are handled here; a
 * scanned image needs a vision-capable provider (a later step).
 */
export function extractText(buffer: Buffer, mimetype: string, filename: string): string {
  const name = (filename || '').toLowerCase();
  if (mimetype.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.csv') || mimetype === 'application/json') {
    return buffer.toString('utf-8');
  }
  if (mimetype === 'application/pdf' || name.endsWith('.pdf')) {
    return extractPdfText(buffer);
  }
  // Last resort: strip to printable characters, so a DOCX or odd type still
  // yields something the model can read.
  const ascii = buffer.toString('latin1').replace(/[^\x20-\x7E\n]+/g, ' ');
  return ascii.length > 40 ? ascii : '';
}

/**
 * A dependency-free PDF text scan: inflate each content stream and pull the
 * strings out of the text-showing operators. Good enough for a text invoice or
 * letter; a scanned page yields nothing (there is no text to find).
 */
function extractPdfText(buffer: Buffer): string {
  const out: string[] = [];
  const data = buffer;
  let i = 0;
  const needle = Buffer.from('stream');
  while (i < data.length) {
    const s = data.indexOf(needle, i);
    if (s === -1) break;
    let start = s + needle.length;
    if (data[start] === 0x0d) start++;
    if (data[start] === 0x0a) start++;
    const e = data.indexOf(Buffer.from('endstream'), start);
    if (e === -1) break;
    const chunk = data.subarray(start, e);
    let text: Buffer;
    try {
      text = zlib.inflateSync(chunk);
    } catch {
      text = chunk;
    }
    for (const m of text.toString('latin1').matchAll(/\((?:[^()\\]|\\.)*\)/g)) {
      const raw = m[0].slice(1, -1).replace(/\\([()\\])/g, '$1');
      if (raw.trim()) out.push(raw);
    }
    i = e + 9;
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * The instructions handed to the assistant to turn a document into filed
 * records. It classifies the document, writes a short summary, and appends one
 * parecare-action block per record it can extract, using the normal action
 * vocabulary (add_asset, add_provider, add_medication, and so on). Everything
 * is filed against the current profile.
 */
export function buildIngestPrompt(profileName: string, today: string): string {
  return `You are filing an uploaded document into ${profileName}'s care record. Today is ${today}.

Read the document text below and do two things:
1. In one or two short sentences, say what the document is (an invoice, a care plan, a referral letter, a business card, a receipt, and so on) and what you filed.
2. Append one \`\`\`parecare-action\`\`\` fenced JSON block per record you can extract, using the action vocabulary you have been given. File everything against this profile.

Guidance on what goes where:
- A tax invoice or receipt for a piece of equipment (a CPAP machine, a hoist, a wheelchair, a bed) is an asset: emit add_asset with the unit name, make/model, serial number, price actually paid, purchase date, supplier (who sold it), warranty expiry (compute it if the document gives a warranty length from the purchase date), and put the included accessories in notes. A GST-free medical device still has a price.
- A business card or a letterhead for a clinician or clinic is a provider: emit add_provider.
- A prescription or medication list is one add_medication per drug.
- Only extract facts that are actually in the document. Do not invent serial numbers, prices or dates. Use "YYYY-MM-DD" for dates. If you truly cannot extract anything fileable, say so and emit no blocks.

The document text is in the next message.`;
}
