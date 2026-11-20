import zlib from 'zlib';
import { BUILT_IN_NEXT_STEPS } from './nextStepTypes';

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
/** The built-in kinds of next step, named so documents are filed with the same words as the outcome form. */
const NEXT_STEP_NAMES = BUILT_IN_NEXT_STEPS.map((s) => `"${s.name}"`).join(', ');

/** A medicine already on their list, as the reader is told about it. */
export interface CurrentMedicine {
  name: string;
  dose: string | null;
  times: string[];
}

/**
 * Split a long document into parts of about `size` characters, broken at
 * paragraph breaks (or line breaks when a paragraph is longer), so each part
 * is read whole rather than the end being cut off.
 */
export function splitIntoParts(text: string, size = 10000): string[] {
  if (text.length <= size) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= size) pieces.push(p);
    else {
      // A very long paragraph: break at lines, then at the size itself.
      let buf = '';
      for (const line of p.split('\n')) {
        if ((buf + '\n' + line).length > size && buf) {
          pieces.push(buf);
          buf = '';
        }
        if (line.length > size) {
          for (let i = 0; i < line.length; i += size) pieces.push(line.slice(i, i + size));
        } else buf = buf ? `${buf}\n${line}` : line;
      }
      if (buf) pieces.push(buf);
    }
  }
  const parts: string[] = [];
  let cur = '';
  for (const piece of pieces) {
    if (cur && (cur.length + 2 + piece.length) > size) {
      parts.push(cur);
      cur = piece;
    } else cur = cur ? `${cur}\n\n${piece}` : piece;
  }
  if (cur) parts.push(cur);
  return parts;
}

/** The most parts of one document Pare reads. */
export const MAX_PARTS = 6;

export function buildIngestPrompt(
  profileName: string,
  today: string,
  knownAddresses: string[] = [],
  categories: string[] = [],
  medicines: CurrentMedicine[] = []
): string {
  const medicineList = medicines.length
    ? `\n\nMedicines already on ${profileName}'s list (name, dose, times):\n${medicines.map((m) => `- ${m.name}${m.dose ? `, ${m.dose}` : ''}${m.times.length ? `, at ${m.times.join(' and ')}` : ''}`).join('\n')}\nA letter that changes one of these is update_medication with its exact name and the reason; one that stops it is stop_medication. Never add_medication for a medicine already on this list.`
    : `\n\n${profileName} has no medicines on the list yet.`;
  const addressGuard = knownAddresses.length
    ? `\n\nAddresses already on file in this account (they belong to the family, NOT to vendors):\n${knownAddresses.map((a) => `- ${a}`).join('\n')}\nIf an address on the document matches one of these, it is the person's own address (the "invoice to" / "bill to" / "ship to"), so do NOT create a provider or supplier from it. Only a business's own address (usually the letterhead or the top of the page, next to its name, phone and ABN) identifies a vendor.`
    : '';
  return `You are filing an uploaded document into ${profileName}'s care record. Today is ${today}.${addressGuard}${medicineList}

Do three things:
1. In one or two short sentences, say what the document is (an invoice, a care plan, a referral letter, a business card, a prescription) and what you are filing from it. Do NOT quote or repeat the document text back.
2. Always emit exactly one file_document block that files the document itself: the category it belongs in, and a short clear name for it such as "Discharge letter, Example Hospital, March 2026" or "Tax invoice, ResMed CPAP machine". Pick a category from this list whenever one fits: ${categories.length ? categories.join(', ') : 'Other'}. Only when none fits, give a short new category name of one to three words, such as "Tax" or "Hospital". Never use "Other" when you can tell what the document is.
3. For each record you can extract, append a fenced code block in exactly this form, opening fence on its own line, one JSON object, closing fence:

\`\`\`parecare-action
{"type": "add_asset", "name": "ResMed AirSense 11 CPAP machine", "make_model": "ResMed AirSense 11 Auto", "serial_number": "22232961781", "price": 2080, "purchase_date": "2024-03-15", "supplier": "Sleep Healthcare Australia", "warranty_expiry": "2029-03-15", "notes": "Includes AirFit P10 mask, ClimateLine tube, humidifier."}
\`\`\`

CRITICAL: the key is "type" (never "action"), the JSON must be valid, one object per block, and the block must be fenced exactly as \`\`\`parecare-action ... \`\`\`. Emit one block per record.

The action types you can use here and their fields:
- {"type": "file_document", "category": the category to file this document under, "label": a short clear name for the document, "issued_on"? ("YYYY-MM-DD", the date it was written), "valid_until"? ("YYYY-MM-DD", only when the document itself says when it runs out), "no_expiry"? (true only when it says it does not expire, such as an "indefinite" referral), "from_name"? (who wrote it), "from_type"? (what they do, e.g. "GP"), "to_name"? (who it is addressed to), "to_type"? (what they do, e.g. "Neurologist"), "to_phone"? (their phone from the letter), "to_practice"? (the clinic or hospital they are at)}
- {"type": "add_asset", "name" (required), "category"?, "make_model"?, "serial_number"?, "price"? (number), "purchase_date"? ("YYYY-MM-DD"), "supplier"? (who sold it), "warranty_expiry"? ("YYYY-MM-DD"), "condition"?, "location"?, "useful_life_years"? (number), "notes"?}
- {"type": "add_provider", "kind"?: "organisation" for a clinic, hospital, pharmacy, government department, agency or other body, "person" for a professional such as a doctor or caseworker, "provider_type": for a professional gp | specialist | psychologist | allied_health | legal | financial | social_worker or plain words such as "Neurologist"; for an organisation practice | clinic | pharmacy | care_facility or plain words such as "Hospital" or "Government department", "name" (required), "organisation"? (the organisation they are based at), "phone"?, "email"?, "after_hours_phone"?, "fax"?, "opening_hours"? ([{"day": "mon".."sun", "opens": "HH:MM", "closes": "HH:MM"}])}
- {"type": "add_medication", "medication_name" (required), "dose"?, "route"?, "frequency"?, "instructions"?, "prescriber"? (the doctor who wrote it, by name), "prescriber_type"?, "started_at_appointment"? (the title of the visit it came from), "course_ends_on"? ("YYYY-MM-DD", the last day of a course such as antibiotics), "repeats_left"? (number of repeats on the script), "reason"? (why it was started)}
- {"type": "update_medication", "medication_name": exact name from the list above, then any of "dose", "schedule_times" (array of "HH:MM"), "frequency", "instructions", "course_ends_on", "repeats_left", and "reason" (why it changed, in the letter's words), "changed_on"? ("YYYY-MM-DD")}
- {"type": "stop_medication", "medication_name": exact name from the list above, "stopped_on"? ("YYYY-MM-DD"), "stop_reason"? (finished | side_effects | not_working | changed | doctor_stopped | no_longer_needed | other), "stop_notes"? (why, in the letter's words)}
- {"type": "book_appointment", "title": what it is for, "appointment_type": consultation | test | procedure | therapy | review | vaccination | other, "provider_name"? (who it is with), "with_type"?, "with_phone"?, "location"?, "starts_at": ISO time from the letter, "preparation"? (how to get ready, such as fasting), "documents_to_bring"? (leave out; this letter is brought automatically)} for a letter that gives a booked date and time
- {"type": "add_condition", "name" (required), "status"? (active | improving | managed | resolved), "started_on"? ("YYYY-MM-DD"), "notes"?, "treated_by"? (who treats it), "treated_by_type"?} for a diagnosis the letter makes
- {"type": "add_allergy", "substance" (required), "reaction"?} for an allergy the letter records
- {"type": "record_cost", "amount" (number), "spent_on"? ("YYYY-MM-DD"), "description"?, "tax_amount"?, "claimable_amount"?} for an amount paid on a receipt or invoice that is not a piece of equipment
- A phone number for someone already on file goes on their record with update_provider, never in a note.
- {"type": "add_task", "title" (required), "body"?, "due_at" (ISO time, or YYYY-MM-DD for any time that day), "repeat": once | daily | weekly | fortnightly | monthly | three_monthly | six_monthly | yearly, "with"? (who it is with, e.g. the specialist a letter names), "with_type"? (what they do), "with_phone"? (their phone from the letter)}
- {"type": "log_event", "entry_type": visit | medical_appointment | observation | handover, "title"?, "body"?, "occurred_at"? (ISO time)}
- {"type": "record_appointment_outcome", "appointment_title"? (only the title of an appointment already on file that this letter is about; leave it out when none clearly is), "visit_title"? (what the visit was, such as "Box Hill Hospital stay" or "Cardiology review", used when no appointment on file matches), "visited_on"? ("YYYY-MM-DD", the day of the visit or the discharge), "outcome"? (what was found or decided, in a sentence), "next_steps": array of {"kind" (one of: ${NEXT_STEP_NAMES}; or a short new name when none fits), "details"? (who, what or where), "due_on"? ("YYYY-MM-DD")}}

What goes where:
- A tax invoice or receipt for a piece of equipment (a CPAP machine, a hoist, a wheelchair, a bed, a monitor) is an asset: add_asset with the unit name, make/model, serial number, the price actually paid, purchase date, the seller as "supplier", and the warranty expiry (compute it from the purchase date if the document gives a warranty length). Put accessories in notes. A GST-free medical device still has a price. The seller of equipment goes in the asset's "supplier" field, NOT as a provider; only use add_provider for a clinician or a clinic, not a retailer.
- The seller is the business named on the letterhead (with its own phone and ABN); the "invoice to" / "bill to" party is the customer, usually ${profileName}, and that address is the person's own, not a vendor's. A provider's or supplier's name is the business name (e.g. "Sleep Healthcare Australia"), never an address.
- A prescription or medication list is one add_medication per drug that is not already on their list, with the prescribing doctor as "prescriber". A drug already on the list with a new dose or times is update_medication, and one the letter stops is stop_medication, each with the reason.
- A referral is file_document with "from_name", "to_name" and "issued_on" filled in, with the category "Referral". Never a new task for it: the person usually has a task for it already, and the referral is matched to it. Give "valid_until" only when the letter says how long it lasts; otherwise it is worked out.
- A letter that gives a booked appointment (a date and a time) is book_appointment.
- A letter about a visit that has happened (a specialist's letter to the GP, a consult summary, a discharge summary, test results with a plan) is one record_appointment_outcome: the outcome in a sentence, and one next step for each thing it says should happen next, such as a referral, a blood test, a sample to give, a scan, a follow-up or a prescription to fill. Use these next steps in place of add_task for anything the letter asks for. Name the visit in "visit_title" and its day in "visited_on"; it is filed against an appointment on file only when its title matches, and otherwise as a visit of its own, never against whatever appointment was last.
- Only extract facts that are actually in the document. Never invent serial numbers, prices or dates. Use "YYYY-MM-DD" for dates. If you cannot extract anything fileable, say so and emit no blocks.

The document text is in the next message.`;
}
