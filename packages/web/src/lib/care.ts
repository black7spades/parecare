export const CARE_PHASES = [
  { value: 'early_concern', label: 'Early concern' },
  { value: 'home_with_support', label: 'Home with support' },
  { value: 'increased_dependency', label: 'Increased dependency' },
  { value: 'transition_to_residential', label: 'Transition to residential' },
  { value: 'residential_ongoing', label: 'Residential ongoing' },
  { value: 'end_of_life', label: 'End of life' },
] as const;

export type CarePhase = (typeof CARE_PHASES)[number]['value'];

export const phaseLabel = (phase: string) =>
  CARE_PHASES.find((p) => p.value === phase)?.label ?? phase;

export interface PhaseHistoryEntry {
  phase: string;
  entered_at: string;
  locked_at: string | null;
}

export const LOG_ENTRY_TYPES = [
  { value: 'visit', label: 'Visit' },
  { value: 'medication', label: 'Medication' },
  { value: 'medical_appointment', label: 'Medical appointment' },
  { value: 'phone_call', label: 'Phone call' },
  { value: 'decision_made', label: 'Decision made' },
  { value: 'concern_raised', label: 'Concern raised' },
  { value: 'observation', label: 'Observation' },
  { value: 'handover', label: 'Handover' },
] as const;

export type LogEntryType = (typeof LOG_ENTRY_TYPES)[number]['value'];

export const entryTypeLabel = (type: string) =>
  LOG_ENTRY_TYPES.find((t) => t.value === type)?.label ?? type;

/** The highest-level kind of care profile: a person or a pet. */
export type ProfileKind = 'person' | 'pet';

/**
 * The kinds of animal a pet profile can be. A general list that covers the
 * common companions; anything unusual goes under Other and is spelled out
 * in the breed.
 */
export const PET_SPECIES = [
  'Dog',
  'Cat',
  'Rabbit',
  'Guinea pig',
  'Hamster',
  'Mouse or rat',
  'Ferret',
  'Bird',
  'Fish',
  'Reptile',
  'Amphibian',
  'Horse',
  'Other',
] as const;

/** A natural relationship for a new pet, e.g. Cat becomes "pet cat". */
export const petRelationshipFor = (species: string): string =>
  species && species !== 'Other' ? `pet ${species.toLowerCase()}` : 'pet';

export interface CareProfile {
  id: string;
  /** Person or pet: the top-level category the profile belongs to. */
  kind: ProfileKind;
  /** Composed display name derived from the structured name parts. */
  full_name: string;
  title: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  suffix: string | null;
  owner_relationship?: string | null;
  preferred_name: string | null;
  date_of_birth: string | null;
  /** Expected babies get a profile before birth. */
  due_date?: string | null;
  current_phase: CarePhase;
  pronouns: string | null;
  primary_language: string | null;
  /** Pet only: the kind of animal, e.g. Dog, Cat. */
  species: string | null;
  /** Pet only: the breed, e.g. Ragdoll. */
  breed: string | null;
  /** Pet only: neutered or spayed. */
  desexed: boolean;
  /** Pet only: microchip number. */
  microchip_number: string | null;
  photo_url: string | null;
  photo_color: string | null;
  notes: string | null;
  /** Who to contact about this person: themselves, a platform user, or a new contact. */
  contact_kind?: 'self' | 'user' | 'contact' | null;
  contact_account_id?: string | null;
  contact_name?: string | null;
  contact_relationship?: string | null;
  contact_phone?: string | null;
  contact_phone_type?: 'home' | 'mobile' | null;
  contact_email?: string | null;
}

export interface ChecklistItem {
  id: string;
  /** Legacy phase slug; null for items that live on a journey phase. */
  phase: CarePhase | string | null;
  care_journey_phase_id: string | null;
  title: string;
  description: string | null;
  completed: boolean;
  /** The day it really happened, distinct from when the box was ticked. */
  achieved_on: string | null;
  is_milestone: boolean;
  is_custom: boolean;
  sort_order: number;
  note_count: number;
}

export interface ChecklistNote {
  id: string;
  body: string;
  photo_url?: string | null;
  created_at: string;
  author_name: string | null;
}

export interface CareLogEntry {
  id: string;
  entry_type: LogEntryType;
  title: string | null;
  body: string;
  occurred_at: string;
  created_at: string;
}

export const POA_TYPES = [
  { value: 'enduring', label: 'Enduring power of attorney' },
  { value: 'medical', label: 'Medical treatment decision maker' },
  { value: 'financial', label: 'Financial power of attorney' },
  { value: 'guardianship', label: 'Guardianship' },
] as const;

export const poaLabel = (type: string | null) =>
  POA_TYPES.find((t) => t.value === type)?.label ?? 'Power of attorney';

export type CirclePermission = 'viewer' | 'contributor';
export type AccessLevel = 'owner' | 'admin' | 'contributor' | 'viewer';

/** Sentinel relationship for a profile that tracks the owner's own care. */
export const SELF_RELATIONSHIP = 'Myself';

export const RELATIONSHIPS = [
  SELF_RELATIONSHIP,
  'Mum',
  'Dad',
  'Son',
  'Daughter',
  'Partner',
  'Grandma',
  'Grandpa',
  'Mother-in-law',
  'Father-in-law',
  'Aunt',
  'Uncle',
  'Sister',
  'Brother',
  'Cousin',
  'Friend',
  'Neighbour',
  'Client',
  'Resident',
] as const;

export interface CircleMember {
  id: string;
  account_id: string | null;
  invited_email: string | null;
  display_name: string;
  role: string;
  relationship: string | null;
  role_description: string | null;
  poa_type: string | null;
  poa_activated: boolean;
  can_edit_profile: boolean;
  invite_accepted: boolean;
  permission: CirclePermission;
  created_at: string;
  /** Present for owners and admins while an invite is pending. */
  invite_status?: 'pending' | 'accepted' | 'revoked' | 'expired';
  invite_expires_at?: string;
  invite_url?: string | null;
}

export interface ActivityEntry {
  id: string;
  action: 'created' | 'updated' | 'deleted';
  entity_type: string;
  summary: string | null;
  created_at: string;
  actor_name: string | null;
}

const ENTITY_LABELS: Record<string, string> = {
  circle: 'care circle member',
  log: 'care log entry',
  plan: 'care plan',
  checklists: 'checklist item',
  questions: 'question',
  documents: 'document',
  providers: 'provider',
  reminders: 'task',
  messages: 'message',
  journeys: 'care journey',
  'memory-book': 'memory',
  'care-profiles': 'profile',
  ai: 'AI conversation',
};

export const entityLabel = (type: string) => ENTITY_LABELS[type] ?? type;

export const DOCUMENT_CATEGORIES = [
  { value: 'poa', label: 'Power of attorney' },
  { value: 'will', label: 'Will' },
  { value: 'advance_care_directive', label: 'Advance care directive' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'identity', label: 'Identity' },
  { value: 'medical_record', label: 'Medical record / certificate' },
  { value: 'facility_contract', label: 'Facility contract' },
  { value: 'financial', label: 'Financial' },
  { value: 'other', label: 'Other' },
] as const;

export const documentCategoryLabel = (cat: string) =>
  DOCUMENT_CATEGORIES.find((c) => c.value === cat)?.label ?? cat;

export interface CareDocument {
  id: string;
  category: string;
  label: string;
  file_url: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  visible_to_roles: string[] | null;
  created_at: string;
}

export const PROVIDER_TYPES = [
  { value: 'gp', label: 'GP' },
  { value: 'specialist', label: 'Specialist' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'care_facility', label: 'Care facility' },
  { value: 'allied_health', label: 'Allied health' },
  { value: 'legal', label: 'Legal' },
  { value: 'financial', label: 'Financial' },
  { value: 'social_worker', label: 'Social worker' },
  { value: 'other', label: 'Other' },
] as const;

export const providerTypeLabel = (type: string) =>
  PROVIDER_TYPES.find((t) => t.value === type)?.label ?? type;

export interface Provider {
  id: string;
  provider_type: string;
  name: string;
  organisation: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  poa_type: string | null;
  poa_activated: boolean;
}

export interface Task {
  id: string;
  title: string;
  body: string | null;
  reminder_type: 'once' | 'daily' | 'weekly' | 'monthly';
  next_due_at: string;
  assigned_to: string | null;
  completed: boolean;
  completed_at: string | null;
  completed_by_name: string | null;
}

export interface ChatMessage {
  id: string;
  body: string;
  created_at: string;
  author_account_id: string | null;
  author_name: string | null;
}

export interface OpenQuestion {
  id: string;
  title: string;
  body: string | null;
  status: 'open' | 'resolved' | 'deferred';
  resolution: string | null;
  created_at: string;
}

export interface QuestionResponse {
  id: string;
  body: string;
  created_at: string;
  is_ai: boolean;
  author_name: string | null;
}

export interface MemoryEntry {
  id: string;
  title: string | null;
  body: string;
  photo_url: string | null;
  created_at: string;
  author_account_id: string | null;
  author_name: string | null;
  /** Set when the entry is the story of an achievement. */
  checklist_item_id?: string | null;
  achievement_title?: string | null;
}

export interface Medication {
  name: string;
  dose?: string;
  frequency?: string;
  prescriber?: string;
}

/** What they must not be given, and what happens if they are. */
export interface Allergy {
  id: string;
  substance: string;
  reaction: string | null;
}

/** What they live with, tied to the medications that treat it. */
export interface MedicalCondition {
  id: string;
  name: string;
  notes: string | null;
  medications: { name: string; active: boolean }[];
}

export interface EmergencyContact {
  name: string;
  relationship?: string;
  phone: string;
}

/** A first-class medication record (distinct from the care-plan summary). */
export interface MedicationRecord {
  id: string;
  care_profile_id: string;
  medication_catalogue_id?: string;
  name: string;
  /** How many units make up one dose, e.g. 3 capsules. */
  units_per_dose: number | null;
  /** The strength number, e.g. "20"; dose is the composed display. */
  dose_amount: string | null;
  dose_unit: string | null;
  dose: string | null;
  form: string | null;
  route: string | null;
  /** Recorded only when true; unchecked simply means false. */
  with_food: boolean;
  /** Only taken when needed, not on a schedule. */
  as_needed: boolean;
  medical_condition_id: string | null;
  condition_name?: string | null;
  frequency: string | null;
  schedule_times: string[] | null;
  instructions: string | null;
  /** Counted in units: a full pack provides this many. */
  supply: number | null;
  supply_remaining: number | null;
  /** When a repeat prescription is next due. */
  repeats_due: string | null;
  active: boolean;
}

/** Every way a medication can enter the body, in plain language. */
export const MED_ROUTES = [
  'By mouth',
  'Under the tongue',
  'Inside the cheek',
  'Inhaled',
  'Into the nose',
  'Eye drops',
  'Ear drops',
  'On the skin',
  'Skin patch',
  'Injection under the skin',
  'Injection into muscle',
  'Into a vein',
  'Rectal',
  'Vaginal',
  'Through a feeding tube',
] as const;

/**
 * What the medication physically is. The type suggests the route, names
 * the container a new supply comes in ("a new pack", "a new bottle"),
 * and whether it is counted (tablets) or measured (a volume).
 */
export const MED_TYPES: { value: string; plural: string; defaultRoute: string; container: string; measured: boolean }[] = [
  { value: 'Tablet', plural: 'Tablets', defaultRoute: 'By mouth', container: 'pack', measured: false },
  { value: 'Capsule', plural: 'Capsules', defaultRoute: 'By mouth', container: 'pack', measured: false },
  { value: 'Liquid', plural: 'Doses', defaultRoute: 'By mouth', container: 'bottle', measured: true },
  { value: 'Wafer', plural: 'Wafers', defaultRoute: 'By mouth', container: 'pack', measured: false },
  { value: 'Powder', plural: 'Sachets', defaultRoute: 'By mouth', container: 'box', measured: false },
  { value: 'Injection', plural: 'Injections', defaultRoute: 'Injection under the skin', container: 'box', measured: true },
  { value: 'Patch', plural: 'Patches', defaultRoute: 'Skin patch', container: 'pack', measured: false },
  { value: 'Cream', plural: 'Applications', defaultRoute: 'On the skin', container: 'tube', measured: true },
  { value: 'Ointment', plural: 'Applications', defaultRoute: 'On the skin', container: 'tube', measured: true },
  { value: 'Drops', plural: 'Doses', defaultRoute: 'Eye drops', container: 'bottle', measured: true },
  { value: 'Inhaler', plural: 'Puffs', defaultRoute: 'Inhaled', container: 'inhaler', measured: false },
  { value: 'Spray', plural: 'Sprays', defaultRoute: 'Into the nose', container: 'bottle', measured: false },
  { value: 'Suppository', plural: 'Suppositories', defaultRoute: 'Rectal', container: 'pack', measured: false },
];

/** Common dose measures, offered as a datalist but freely typeable. */
export const DOSE_MEASURES = ['mg', 'mcg', 'g', 'mL', 'IU', 'units', '%'] as const;

/** "3 Capsules", "1 Tablet", or a sensible fallback when type is unknown. */
export function medUnitsLabel(count: number, form: string | null): string {
  const type = MED_TYPES.find((t) => t.value.toLowerCase() === (form ?? '').toLowerCase());
  const one = type?.value ?? 'unit';
  const many = type?.plural ?? 'units';
  const n = Number.isInteger(count) ? String(count) : String(Number(count.toFixed(2)));
  return `${n} ${count === 1 ? one : many}`;
}

/**
 * How supply reads for this form. A liquid or cream is stocked by volume
 * in its dose measure ("195 mL"); a tablet is stocked by count
 * ("3 Tablets"). The right unit for the right kind of medicine.
 */
export function supplyLabel(count: number, m: { form: string | null; dose_unit: string | null }): string {
  const type = MED_TYPES.find((t) => t.value.toLowerCase() === (m.form ?? '').toLowerCase());
  if (type?.measured) {
    const n = Number.isInteger(count) ? String(count) : String(Number(count.toFixed(2)));
    return `${n} ${m.dose_unit ?? ''}`.trim();
  }
  return medUnitsLabel(count, m.form);
}

/**
 * The whole regimen as one readable line composed from its parts:
 * "3 x 20mg Capsules with food, by mouth". Display only; every part
 * stays its own field underneath. With food is mentioned only when true.
 */
export function regimenLine(m: Pick<MedicationRecord, 'units_per_dose' | 'dose' | 'form' | 'with_food' | 'route'>): string {
  const type = MED_TYPES.find((t) => t.value.toLowerCase() === (m.form ?? '').toLowerCase());
  const units = m.units_per_dose && m.units_per_dose > 0 ? m.units_per_dose : null;
  const typeWord = type ? (units && units !== 1 ? type.plural : type.value) : m.form;
  const parts = [
    units ? `${Number.isInteger(units) ? units : units.toFixed(2)} x` : null,
    m.dose,
    typeWord,
    m.with_food ? 'with food' : null,
  ].filter(Boolean);
  const head = parts.join(' ');
  return [head, m.route ? m.route.charAt(0).toLowerCase() + m.route.slice(1) : null].filter(Boolean).join(', ');
}

// Plain-language descriptions accompany every outcome so a family carer who
// has never worked in aged care understands the clinical terms.
export const MED_STATUSES = [
  { value: 'given', label: 'Given', description: 'You gave the dose and it was taken.' },
  { value: 'refused', label: 'Refused', description: 'The person did not want the dose and declined it.' },
  { value: 'omitted', label: 'Omitted', description: 'The dose was skipped this time, for example the person was asleep, unwell or fasting.' },
  { value: 'held', label: 'Held', description: 'The dose was deliberately paused, for example on a doctor or pharmacist instruction.' },
  { value: 'self_administered', label: 'Self-administered', description: 'The person took the dose themselves.' },
] as const;

export const medStatusLabel = (s: string) => MED_STATUSES.find((x) => x.value === s)?.label ?? s;
export const medStatusDescription = (s: string) => MED_STATUSES.find((x) => x.value === s)?.description ?? '';

export const MED_RIGHTS = [
  { key: 'right_patient', label: 'Right patient' },
  { key: 'right_medication', label: 'Right medication' },
  { key: 'right_dose', label: 'Right dose' },
  { key: 'right_route', label: 'Right route' },
  { key: 'right_time', label: 'Right time' },
  { key: 'right_documentation', label: 'Right documentation' },
] as const;

export interface MedicationAdministration {
  id: string;
  medication_id: string;
  medication_name: string;
  medication_dose: string | null;
  medication_route: string | null;
  administered_at: string;
  scheduled_for: string | null;
  administered_by_name: string | null;
  status: string;
  dose_given: string | null;
  route_given: string | null;
  notes: string | null;
  right_patient: boolean;
  right_medication: boolean;
  right_dose: boolean;
  right_route: boolean;
  right_time: boolean;
  right_documentation: boolean;
}

export interface CarePlan {
  conditions: string[];
  medications: Medication[];
  dietary_requirements: string[];
  mobility_aids: string[];
  communication_preferences: string | null;
  advance_care_directive: boolean;
  advance_care_directive_location: string | null;
  gp_name: string | null;
  gp_practice: string | null;
  gp_phone: string | null;
  emergency_contacts: EmergencyContact[];
}
