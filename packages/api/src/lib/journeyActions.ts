import { findPhones } from './phoneText';
import { repeatColumns, type RepeatChoice } from './repeat';
import { normaliseProviderType } from './providerTypes';

/**
 * What a journey item does when tapped. Every item that asks someone to do
 * something has one: book it, add it as a task, upload the paper, call the
 * number, add the record it is about, or open the page it happens on. The
 * web app keeps the same list in lib/journeyActions.ts.
 */
export const JOURNEY_ACTIONS = ['book', 'task', 'upload', 'call', 'equipment', 'hospital_stay', 'care_move', 'funding', 'result', 'open'] as const;
export type JourneyAction = (typeof JOURNEY_ACTIONS)[number];

/** The pages an "open" item goes to. "care-log" is the care log on the overview; "reports" is the report maker. */
export const JOURNEY_PAGES = [
  'medications', 'providers', 'circle', 'plan', 'emergency', 'documents', 'conditions', 'care-needs', 'questions',
  'care-log', 'memory-book', 'tasks', 'appointments', 'messages', 'substance-use', 'reports',
] as const;
export type JourneyPage = (typeof JOURNEY_PAGES)[number];

/** The action columns a template task and a journey item both carry. */
export interface ItemAction {
  action: JourneyAction | null;
  action_provider_type: string | null;
  action_contact_name: string | null;
  action_phone: string | null;
  action_document_category: string | null;
  action_page: JourneyPage | null;
  due_in_days: number | null;
  repeat_rrule: string | null;
}

export const NO_ACTION: ItemAction = {
  action: null, action_provider_type: null, action_contact_name: null, action_phone: null,
  action_document_category: null, action_page: null, due_in_days: null, repeat_rrule: null,
};

/** The short form the catalogue sweep is written in. */
export interface ActionSpec {
  action: JourneyAction;
  /** Who to book or call: a built-in code ("gp", "vet") or the words ("Physiotherapist"). */
  type?: string;
  name?: string;
  phone?: string;
  /** Document category system key for an upload, e.g. "referral". */
  category?: string;
  page?: JourneyPage;
  due?: number;
  repeat?: RepeatChoice;
}

export function fromSpec(s: ActionSpec): ItemAction {
  return {
    action: s.action,
    action_provider_type: s.type ? normaliseProviderType(s.type) : null,
    action_contact_name: s.name ?? null,
    action_phone: s.phone ?? null,
    action_document_category: s.category ?? null,
    action_page: s.page ?? null,
    due_in_days: s.due ?? null,
    repeat_rrule: s.repeat ? repeatColumns(s.repeat).rrule : null,
  };
}

/** Words for who a booking is with, the first that fits wins. */
const TYPE_WORDS: Array<{ re: RegExp; type: string }> = [
  { re: /\bvet\b|\bveterinar/i, type: 'vet' },
  { re: /\bgeneral practitioner\b|\bgp\b|\bdoctor\b/i, type: 'gp' },
  { re: /\bmidwife\b/i, type: 'Midwife' },
  { re: /\bdentist\b|\bdental\b/i, type: 'Dentist' },
  { re: /\bchild health nurse\b/i, type: 'Child health nurse' },
  { re: /\bphysio(therapist|therapy)?\b/i, type: 'Physiotherapist' },
  { re: /\boccupational therap(ist|y)\b|\bot\b/i, type: 'Occupational therapist' },
  { re: /\bspeech (patholog|therap)/i, type: 'Speech pathologist' },
  { re: /\bpsychologist\b|\bcounsellor\b|\btherapist\b/i, type: 'psychologist' },
  { re: /\bpaediatrician\b|\bpaediatric\b/i, type: 'Paediatrician' },
  { re: /\bobstetrician\b/i, type: 'Obstetrician' },
  { re: /\bgeriatrician\b/i, type: 'Geriatrician' },
  { re: /\boptometrist\b|\beye test\b/i, type: 'Optometrist' },
  { re: /\bpharmacist\b|\bpharmacy\b|\bchemist\b/i, type: 'pharmacy' },
  { re: /\bdietitian\b/i, type: 'Dietitian' },
  { re: /\bpodiatrist\b/i, type: 'Podiatrist' },
  { re: /\bspecialist\b/i, type: 'specialist' },
];

const typeFrom = (text: string): string | undefined => TYPE_WORDS.find((t) => t.re.test(text))?.type;

/** "Quitline 13 7848": the words just before a number name who it is. */
function contactBeforePhone(text: string, index: number): string | null {
  const before = text.slice(0, index).replace(/[\s,:]+$/, '');
  const words = before.split(/\s+/).slice(-3);
  // Keep the run of capitalised words nearest the number.
  const named: string[] = [];
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i]!.replace(/[^A-Za-z'&-]/g, '');
    if (!w || !/^[A-Z]/.test(w) || /^(In|Call|Ring|Phone|On)$/.test(w)) break;
    named.unshift(w);
  }
  return named.length ? named.join(' ') : null;
}

/**
 * Work out what an item does from its words: "Book ..." books, "Call ..."
 * calls, "Upload", "Scan", "File" or "Keep a copy" uploads, "Set a ...
 * date" or "Add it as a task" adds a task. A number in the description goes
 * on a call. Anything else that asks for something to be done is a task. A
 * milestone with nothing to do has no action.
 */
export function inferItemAction(item: { title: string; description?: string | null; is_milestone?: boolean }): ItemAction {
  const title = item.title.trim();
  const desc = item.description ?? '';
  const words = `${title} ${desc}`;
  const descPhone = findPhones(desc)[0];
  const phone = descPhone ?? findPhones(title)[0];
  if (/^(call|ring|phone|contact)\b/i.test(title)) {
    if (phone) {
      const text = descPhone ? desc : title;
      return fromSpec({ action: 'call', phone: phone.text, name: contactBeforePhone(text, phone.index) ?? undefined, type: typeFrom(words) });
    }
    const type = typeFrom(words);
    if (type) return fromSpec({ action: 'call', type });
  }
  if (/^(book|make an appointment|see a|see the|see your)\b/i.test(title)) {
    return fromSpec({ action: 'book', type: typeFrom(words) });
  }
  if (/^(upload|scan|file)\b|\bkeep a copy\b/i.test(title)) return fromSpec({ action: 'upload' });
  if (/\badd it as a task\b|^set an? .*\bdate\b/i.test(words)) return fromSpec({ action: 'task' });
  if (item.is_milestone) return NO_ACTION;
  return fromSpec({ action: 'task' });
}

/**
 * An item's action: the sweep's choice for a catalogue item ("slug/title"
 * first, for a title two journeys use differently), else worked out from
 * its words.
 */
export function actionForItem(
  item: { title: string; description?: string | null; is_milestone?: boolean },
  sweep: Record<string, ActionSpec | null>,
  slug?: string | null,
): ItemAction {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(sweep, k);
  const title = item.title.trim();
  const key = slug && has(`${slug}/${title}`) ? `${slug}/${title}` : title;
  if (has(key)) {
    const spec = sweep[key];
    if (!spec) return NO_ACTION;
    const out = fromSpec(spec);
    // A call to a number in the words: the number comes from the description.
    if (out.action === 'call' && !out.action_phone) {
      const desc = item.description ?? '';
      const p = findPhones(desc)[0];
      if (p) {
        out.action_phone = p.text;
        out.action_contact_name = out.action_contact_name ?? contactBeforePhone(desc, p.index);
      }
    }
    return out;
  }
  return inferItemAction(item);
}

export const ITEM_ACTION_COLUMNS = [
  'action', 'action_provider_type', 'action_contact_name', 'action_phone', 'action_document_category', 'action_page', 'due_in_days', 'repeat_rrule',
] as const;

/** Just the action columns of a row, for copying a template task into a journey. */
export function actionColumnsOf(row: Record<string, unknown>): ItemAction {
  const out = { ...NO_ACTION } as Record<string, unknown>;
  for (const k of ITEM_ACTION_COLUMNS) if (row[k] !== undefined) out[k] = row[k] ?? null;
  return out as unknown as ItemAction;
}
