import zlib from 'zlib';

/**
 * Pull readable text out of an uploaded file so the assistant can classify it
 * and file what it finds. Text-based PDFs and plain text are handled here; a
 * scanned image needs a vision-capable provider (a later step).
 */
export function extractText(buffer: Buffer, mimetype: string, filename: string): string {
  const name = (filename || '').toLowerCase();
  if (mimetype.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.csv') || mimetype === 'application/json') {
    return cleanup(buffer.toString('utf-8'));
  }
  if (mimetype === 'application/pdf' || name.endsWith('.pdf')) {
    return extractPdfText(buffer);
  }
  return '';
}

/** Drop control and non-printable bytes and collapse whitespace. */
function cleanup(s: string): string {
  return s.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

/** A PDF string token is real text if most of its characters are printable. */
function looksLikeText(s: string): boolean {
  if (s.length < 2) return false;
  const printable = (s.match(/[\x20-\x7E]/g) || []).length;
  return printable / s.length > 0.7;
}

// Decode a PDF literal string: octal escapes (\ddd) and the named escapes.
function decodePdfLiteral(body: string): string {
  return body.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, e: string) => {
    switch (e) {
      case 'n': return '\n';
      case 'r': return '';
      case 't': return ' ';
      case 'b': return '';
      case 'f': return '';
      case '(': return '(';
      case ')': return ')';
      case '\\': return '\\';
      default: return String.fromCharCode(parseInt(e, 8) & 0xff);
    }
  });
}

/**
 * A dependency-free PDF text scan. Only content streams (those inflating to
 * something with text operators) are read, and only tokens that look like real
 * text are kept, so image, font and other binary streams do not leak in. Good
 * enough for a text invoice or letter; a scanned page yields nothing.
 */
function extractPdfText(buffer: Buffer): string {
  const out: string[] = [];
  const data = buffer;
  let i = 0;
  const needle = Buffer.from('stream');
  const endNeedle = Buffer.from('endstream');
  while (i < data.length) {
    const s = data.indexOf(needle, i);
    if (s === -1) break;
    let start = s + needle.length;
    if (data[start] === 0x0d) start++;
    if (data[start] === 0x0a) start++;
    const e = data.indexOf(endNeedle, start);
    if (e === -1) break;
    i = e + endNeedle.length;
    const chunk = data.subarray(start, e);
    // Only inflated streams are used; a raw (non-flate) stream is almost always
    // binary (an image or font), so it is skipped rather than read as garbage.
    let text: string;
    try {
      text = zlib.inflateSync(chunk).toString('latin1');
    } catch {
      continue;
    }
    // Not a content stream (no text-showing operators): skip it.
    if (!/\b(BT|Tj|TJ)\b|\)\s*Tj|\]\s*TJ/.test(text)) continue;
    for (const m of text.matchAll(/\(((?:[^()\\]|\\.)*)\)/g)) {
      const token = decodePdfLiteral(m[1] ?? '');
      if (looksLikeText(token)) out.push(token);
    }
  }
  return cleanup(out.join(' '));
}

/**
 * The instructions handed to the assistant to turn a document into filed
 * records. It classifies the document, writes a short summary, and appends one
 * parecare-action block per record it can extract, using the normal action
 * vocabulary (add_asset, add_provider, add_medication, and so on). Everything
 * is filed against the current profile.
 */
export function buildIngestPrompt(profileName: string, today: string, knownAddresses: string[] = []): string {
  const addressGuard = knownAddresses.length
    ? `\n\nAddresses already on file in this account (they belong to the family, NOT to vendors):\n${knownAddresses.map((a) => `- ${a}`).join('\n')}\nIf an address on the document matches one of these, it is the person's own address (the "invoice to" / "bill to" / "ship to"), so do NOT create a provider or supplier from it. Only a business's own address (usually the letterhead or the top of the page, next to its name, phone and ABN) identifies a vendor.`
    : '';
  return `You are filing an uploaded document into ${profileName}'s care record. Today is ${today}.${addressGuard}

Do two things:
1. In one or two short sentences, say what the document is (an invoice, a care plan, a referral letter, a business card, a prescription) and what you are filing from it. Do NOT quote or repeat the document text back.
2. For each record you can extract, append a fenced code block in exactly this form, opening fence on its own line, one JSON object, closing fence:

\`\`\`parecare-action
{"type": "add_asset", "name": "ResMed AirSense 11 CPAP machine", "make_model": "ResMed AirSense 11 Auto", "serial_number": "22232961781", "price": 2080, "purchase_date": "2024-03-15", "supplier": "Sleep Healthcare Australia", "warranty_expiry": "2029-03-15", "notes": "Includes AirFit P10 mask, ClimateLine tube, humidifier."}
\`\`\`

CRITICAL: the key is "type" (never "action"), the JSON must be valid, one object per block, and the block must be fenced exactly as \`\`\`parecare-action ... \`\`\`. Emit one block per record.

The action types you can use here and their fields:
- {"type": "add_asset", "name" (required), "category"?, "make_model"?, "serial_number"?, "price"? (number), "purchase_date"? ("YYYY-MM-DD"), "supplier"? (who sold it), "warranty_expiry"? ("YYYY-MM-DD"), "condition"?, "location"?, "useful_life_years"? (number), "notes"?}
- {"type": "add_provider", "provider_type": one of gp | specialist | pharmacy | care_facility | allied_health | legal | financial | social_worker | other, "name" (required), "organisation"?, "phone"?, "email"?}
- {"type": "add_medication", "medication_name" (required), "dose"?, "route"?, "frequency"?, "instructions"?}
- {"type": "add_task", "title" (required), "body"?, "due_at" (ISO time), "repeat": once | daily | weekly | monthly}
- {"type": "log_event", "entry_type": visit | medical_appointment | observation | handover, "title"?, "body"?, "occurred_at"? (ISO time)}

What goes where:
- A tax invoice or receipt for a piece of equipment (a CPAP machine, a hoist, a wheelchair, a bed, a monitor) is an asset: add_asset with the unit name, make/model, serial number, the price actually paid, purchase date, the seller as "supplier", and the warranty expiry (compute it from the purchase date if the document gives a warranty length). Put accessories in notes. A GST-free medical device still has a price. The seller of equipment goes in the asset's "supplier" field, NOT as a provider; only use add_provider for a clinician or a clinic, not a retailer.
- The seller is the business named on the letterhead (with its own phone and ABN); the "invoice to" / "bill to" party is the customer, usually ${profileName}, and that address is the person's own, not a vendor's. A provider's or supplier's name is the business name (e.g. "Sleep Healthcare Australia"), never an address.
- A prescription or medication list is one add_medication per drug.
- Only extract facts that are actually in the document. Never invent serial numbers, prices or dates. Use "YYYY-MM-DD" for dates. If you cannot extract anything fileable, say so and emit no blocks.

The document text is in the next message.`;
}
