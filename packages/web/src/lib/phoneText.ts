/**
 * Phone numbers, email addresses and web links in free text, and the person a
 * note names next to a number. The API keeps the same rules in its own
 * lib/phoneText.ts, so what the screen makes tappable is what the server reads.
 *
 * Test list (each should find exactly what is in brackets):
 *   "Neurologist is Dr Anna Chen, 03 9345 6677."   [03 9345 6677] person Dr Anna Chen, Neurologist
 *   "Phone Dr Chen on 03 9345 6677."                [03 9345 6677] person Dr Chen
 *   "Ring 0412 555 019 after 3"                     [0412 555 019]
 *   "Call (03) 9890-1234"                           [(03) 9890-1234]
 *   "Healthdirect 1800 022 222"                     [1800 022 222]
 *   "Poisons 13 11 26"                              [13 11 26]
 *   "+61 3 9345 6677"                               [+61 3 9345 6677]
 *   UK "Call 0808 808 7777", US "(800) 662-4357"    the same, with that country set
 *   "Seen 12/03/2026, 500 mg"                       none: a date and a dose
 *   "Ref 123456789012"                              none: too long
 */

export interface TextPart {
  kind: 'text' | 'phone' | 'email' | 'url';
  text: string;
}

const CANDIDATE = /(?:\+\d{1,3}[\s-]*)?(?:\(\d{1,4}\)[\s-]*)?\d[\d\s\-()]{3,14}\d/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/gi;

/** Digits only, keeping a leading plus. */
export const phoneDigits = (s: string): string => {
  const plus = s.trim().startsWith('+');
  return (plus ? '+' : '') + s.replace(/\D/g, '');
};

/**
 * The shapes of phone numbers in each country, once the country code is
 * taken off: Australian landlines, mobiles, 1800 and 13 numbers; UK 01, 02,
 * 03, 07 and 08 numbers; North American ten-digit numbers; and so on. A
 * short national line such as 116 123 counts too. Dates, doses and long
 * reference numbers never match.
 */
const PHONE_SHAPES: Record<string, { dial: string; shapes: RegExp[] }> = {
  AU: { dial: '61', shapes: [/^0[2378]\d{8}$/, /^04\d{8}$/, /^1[38]00\d{6}$/, /^13\d{4}$/] },
  NZ: { dial: '64', shapes: [/^0[3-79]\d{7}$/, /^02\d{7,9}$/, /^0800\d{6,7}$/, /^0508\d{6}$/] },
  GB: { dial: '44', shapes: [/^0[123]\d{8,9}$/, /^07\d{9}$/, /^08\d{8,9}$/, /^116\d{3}$/] },
  IE: { dial: '353', shapes: [/^0[1-9]\d{6,9}$/, /^1[58]\d{2}\d{6}$/, /^116\d{3}$/] },
  CA: { dial: '1', shapes: [/^1?[2-9]\d{2}[2-9]\d{6}$/] },
  US: { dial: '1', shapes: [/^1?[2-9]\d{2}[2-9]\d{6}$/] },
};

let phoneCountry = 'AU';
/** Which country's numbers to look for; set from the country PareCare is in. */
export function setPhoneCountry(code: string | null | undefined): void {
  if (code && PHONE_SHAPES[code]) phoneCountry = code;
}

/** Whether a run of digits is a phone number where the person lives, or any number written with a + and its country code. */
export function isPhoneNumber(raw: string, country: string = phoneCountry): boolean {
  const rule = PHONE_SHAPES[country] ?? PHONE_SHAPES['AU']!;
  let d = phoneDigits(raw);
  if (d.startsWith(`+${rule.dial}`)) {
    const rest = d.slice(1 + rule.dial.length).replace(/^0/, '');
    d = rule.dial === '1' ? rest : `0${rest}`;
  }
  // Another country's number, written in full with its code.
  if (d.startsWith('+')) return d.length >= 9 && d.length <= 16;
  if (d.length < 6 || d.length > 11) return false;
  return rule.shapes.some((s) => s.test(d));
}

/** Every phone number in the text, as written. */
export function findPhones(text: string): Array<{ text: string; index: number }> {
  const out: Array<{ text: string; index: number }> = [];
  for (const m of text.matchAll(CANDIDATE)) {
    let value = m[0].replace(/[\s-]+$/, '');
    const index = m.index ?? 0;
    const before = text[index - 1] ?? '';
    const after = text[index + value.length] ?? '';
    // Never part of a longer number, a date or a decimal.
    if (/[\d/.]/.test(before) || /[/]/.test(after) || (/[.]/.test(after) && /\d/.test(text[index + value.length + 1] ?? ''))) continue;
    // A bracket left open at the end belongs to the sentence.
    if ((value.match(/\(/g) ?? []).length < (value.match(/\)/g) ?? []).length && value.endsWith(')')) value = value.slice(0, -1);
    if (isPhoneNumber(value)) out.push({ text: value.trim(), index });
  }
  return out;
}

/** Split text into plain runs and tappable phones, emails and links. */
export function splitLinkedText(text: string): TextPart[] {
  type Hit = { start: number; end: number; kind: TextPart['kind']; text: string };
  const hits: Hit[] = [];
  for (const m of text.matchAll(URL_RE)) hits.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, kind: 'url', text: m[0] });
  for (const m of text.matchAll(EMAIL)) hits.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, kind: 'email', text: m[0] });
  for (const p of findPhones(text)) hits.push({ start: p.index, end: p.index + p.text.length, kind: 'phone', text: p.text });
  hits.sort((a, b) => a.start - b.start);
  const parts: TextPart[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start < at) continue;
    if (h.start > at) parts.push({ kind: 'text', text: text.slice(at, h.start) });
    parts.push({ kind: h.kind, text: h.text });
    at = h.end;
  }
  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) });
  return parts;
}

/**
 * Words for what someone does, as people write them, and the type they are
 * filed under. Short forms ("OT", "physio") count.
 */
export const TYPE_WORDS: Array<{ re: RegExp; type: string }> = [
  { re: /\bGPs?\b|\bgeneral practitioner\b|\bfamily doctor\b/i, type: 'GP' },
  { re: /\bneurologist\b|\bneurology\b/i, type: 'Neurologist' },
  { re: /\bcardiologist\b|\bcardiology\b/i, type: 'Cardiologist' },
  { re: /\bgeriatrician\b/i, type: 'Geriatrician' },
  { re: /\bpaediatrician\b|\bpediatrician\b|\bpaed\b/i, type: 'Paediatrician' },
  { re: /\bdermatologist\b/i, type: 'Dermatologist' },
  { re: /\bendocrinologist\b/i, type: 'Endocrinologist' },
  { re: /\boncologist\b/i, type: 'Oncologist' },
  { re: /\brheumatologist\b/i, type: 'Rheumatologist' },
  { re: /\bpsychiatrist\b/i, type: 'Psychiatrist' },
  { re: /\bpsychologist\b|\bpsych\b/i, type: 'Psychologist' },
  { re: /\bophthalmologist\b|\boptometrist\b/i, type: 'Optometrist' },
  { re: /\bsurgeon\b/i, type: 'Surgeon' },
  { re: /\bOTs?\b|\boccupational therap(?:ist|y)\b/i, type: 'Occupational therapist' },
  { re: /\bphysio(?:therapist)?\b/i, type: 'Physiotherapist' },
  { re: /\bspeech (?:therapist|pathologist|therapy)\b|\bspeechie\b/i, type: 'Speech pathologist' },
  { re: /\bpodiatrist\b|\bpodiatry\b/i, type: 'Podiatrist' },
  { re: /\bdietitian\b|\bdietician\b/i, type: 'Dietitian' },
  { re: /\bdentist\b/i, type: 'Dentist' },
  { re: /\bpharmacist\b|\bpharmacy\b|\bchemist\b/i, type: 'Pharmacy' },
  { re: /\bspecialist\b/i, type: 'Specialist' },
];

/** The type a text names, e.g. "Neurologist" for "the neurologist". */
export function typeWordIn(text: string): string | null {
  for (const t of TYPE_WORDS) if (t.re.test(text)) return t.type;
  return null;
}

const TITLED = /\b(Dr|Prof|Professor|Mr|Mrs|Ms|Miss|Mx|Sister)\.?\s+([A-Z][a-zA-Z'-]+)(?:\s+([A-Z][a-zA-Z'-]+))?/g;
const PLAIN = /\b([A-Z][a-z'-]{1,20})\s+([A-Z][a-z'-]{1,30})\b/g;
const NOT_NAMES = new Set(['Phone', 'Call', 'Ring', 'Book', 'See', 'Ask', 'Referral', 'From', 'The', 'Mum', 'Dad', 'Plan', 'Box', 'Hill', 'Royal', 'Melbourne', 'Hospital', 'Clinic', 'Medical', 'Centre']);

/**
 * The person a note names beside a phone number: a titled name ("Dr Anna
 * Chen"), or a first and last name with a word for what they do nearby.
 * `context` (such as the task's title) also counts for that word.
 */
export function findPersonWithPhone(text: string, context = ''): { name: string; phone: string; type: string | null } | null {
  const phones = findPhones(text);
  if (phones.length === 0) return null;
  const type = typeWordIn(`${text} ${context}`);
  for (const p of phones) {
    const lo = Math.max(0, p.index - 40);
    const hi = Math.min(text.length, p.index + p.text.length + 40);
    const near = text.slice(lo, hi);
    const titled = [...near.matchAll(TITLED)];
    if (titled.length > 0) {
      const t = titled[titled.length - 1]!;
      const name = [t[1], t[2], t[3]].filter(Boolean).join(' ');
      return { name, phone: p.text, type };
    }
    if (type) {
      const plain = [...near.matchAll(PLAIN)].filter((m) => !NOT_NAMES.has(m[1]!) && !NOT_NAMES.has(m[2]!));
      if (plain.length > 0) {
        const m = plain[plain.length - 1]!;
        return { name: `${m[1]} ${m[2]}`, phone: p.text, type };
      }
    }
  }
  return null;
}
