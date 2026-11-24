import { parseDateOnly } from './datetime';
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
  /** Who manages this profile, by name, so a helper is told who can change what they cannot. */
  manager_name?: string | null;
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
  /** Pet only: the id of the person profile who owns this pet. */
  owner_profile_id?: string | null;
  /** Pet only: resolved owner, when owner_profile_id is set. */
  owner_profile?: { id: string; full_name: string; preferred_name: string | null } | null;
  preferred_name: string | null;
  date_of_birth: string | null;
  /** Recorded when someone dies; unlocks their secrets to a power of attorney. */
  died_on?: string | null;
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
  /** Who to contact: themselves, a platform user, a new contact, a provider, or another person. */
  contact_kind?: 'self' | 'user' | 'contact' | 'provider' | 'profile' | null;
  contact_account_id?: string | null;
  contact_provider_id?: string | null;
  /** The primary carer when they are another person in the system. */
  contact_profile_id?: string | null;
  /** Resolved carer person, when contact_kind is 'profile'. */
  contact_profile?: { id: string; full_name: string; preferred_name: string | null; contact_phone: string | null; contact_email: string | null } | null;
  contact_name?: string | null;
  contact_relationship?: string | null;
  contact_phone?: string | null;
  contact_phone_type?: 'home' | 'mobile' | null;
  contact_email?: string | null;
  /** Resolved from contact_account_id when the contact is a platform user. */
  contact_account_name?: string | null;
  contact_account_email?: string | null;
  /** Resolved provider used as the contact, when contact_kind is 'provider'. */
  contact_provider?: ResidenceProvider | null;
  /** Where they live, each fact its own field. */
  residence_type?: 'private_residence' | 'care_facility' | 'retirement_village' | 'group_home' | 'hospital' | 'other' | null;
  address_line1?: string | null;
  address_line2?: string | null;
  address_suburb?: string | null;
  address_state?: string | null;
  address_postcode?: string | null;
  address_country?: string | null;
  residence_provider_id?: string | null;
  room_number?: string | null;
  room_area_name?: string | null;
  room_area_type?: 'wing' | 'floor' | 'unit' | 'building' | 'house' | 'ward' | 'block' | 'other' | null;
  /** Resolved facility provider, when residence_provider_id is set. */
  residence_provider?: ResidenceProvider | null;
}

/** The provider fields the overview needs when a provider is a contact or residence. */
export interface ResidenceProvider {
  id: string;
  name: string;
  organisation: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  booking_link: string | null;
}

export const RESIDENCE_TYPES = [
  { value: 'private_residence', label: 'Private residence' },
  { value: 'care_facility', label: 'Care facility' },
  { value: 'retirement_village', label: 'Retirement village' },
  { value: 'group_home', label: 'Group home' },
  { value: 'hospital', label: 'Hospital' },
  { value: 'other', label: 'Other' },
] as const;

export const residenceTypeLabel = (v: string | null | undefined) =>
  RESIDENCE_TYPES.find((t) => t.value === v)?.label ?? '';

/** Residence types that live inside a facility rather than a private address. */
export const FACILITY_RESIDENCE_TYPES = ['care_facility', 'retirement_village', 'group_home', 'hospital'] as const;

export const isFacilityResidence = (v: string | null | undefined): boolean =>
  !!v && (FACILITY_RESIDENCE_TYPES as readonly string[]).includes(v);

export const ROOM_AREA_TYPES = [
  { value: 'wing', label: 'Wing' },
  { value: 'floor', label: 'Floor' },
  { value: 'unit', label: 'Unit' },
  { value: 'building', label: 'Building' },
  { value: 'house', label: 'House' },
  { value: 'ward', label: 'Ward' },
  { value: 'block', label: 'Block' },
  { value: 'other', label: 'Other' },
] as const;

export const roomAreaTypeLabel = (v: string | null | undefined) =>
  ROOM_AREA_TYPES.find((t) => t.value === v)?.label ?? '';

/** Whole years lived, from the date of birth to today. */
export function ageFrom(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  // A plain day, read as that day here, not as midnight UTC.
  const born = parseDateOnly(dateOfBirth) ?? new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const monthDiff = now.getMonth() - born.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < born.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

export interface ChecklistItem extends Partial<import('./journeyActions').JourneyItemAction> {
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
  /** 1 (angry) to 6 (overjoyed), matching the task outcome scale. */
  sentiment: number | null;
  /** Where the rating came from: analysed by the assistant, or set by a person. */
  sentiment_source: 'ai' | 'manual' | null;
  occurred_at: string;
  created_at: string;
  /** Who wrote it, by name. */
  author_name?: string | null;
  author_account_id?: string | null;
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
/** Their own profile, however it was written down: Myself, self or me. */
export const isSelfRelationship = (r: string | null | undefined): boolean => ['myself', 'self', 'me'].includes(String(r ?? '').trim().toLowerCase());

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

/** Standard care circle roles. Members can also carry a custom role string. */
export const CIRCLE_ROLES = [
  { value: 'family', label: 'Family' },
  { value: 'friend', label: 'Friend' },
  { value: 'carer', label: 'Carer' },
  { value: 'support_worker', label: 'Support worker' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'organisation', label: 'Organisation' },
  { value: 'legal', label: 'Legal representative' },
  { value: 'other', label: 'Other' },
] as const;

export const circleRoleLabel = (role: string) =>
  CIRCLE_ROLES.find((r) => r.value === role.trim().toLowerCase())?.label ?? role.charAt(0).toUpperCase() + role.slice(1);

export type CircleStatus = 'active' | 'invited' | 'added';

export const circleStatusLabel = (m: { status?: CircleStatus; invite_accepted: boolean }) =>
  m.status === 'added' ? 'No login' : m.invite_accepted ? 'Active' : 'Invite pending';

export interface CircleMember {
  id: string;
  account_id: string | null;
  invited_email: string | null;
  /** The linked account's email, for showing a POA holder's contact details. */
  account_email?: string | null;
  display_name: string;
  role: string;
  relationship: string | null;
  role_description: string | null;
  poa_type: string | null;
  poa_activated: boolean;
  can_edit_profile: boolean;
  invite_accepted: boolean;
  permission: CirclePermission;
  /** Phone for anyone; email for someone added by name, who has no login. */
  phone?: string | null;
  email?: string | null;
  /** active: logs in. invited: invite not yet accepted. added: added by name, no login. */
  status?: CircleStatus;
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
  /** How the change was made: a person's own hands, Pare, or an outside assistant. */
  source?: 'person' | 'pare' | 'assistant' | null;
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
  treatments: 'treatment',
  allergies: 'allergy',
  conditions: 'condition',
  medications: 'medication',
  'health-statuses': 'health status',
  doses: 'dose',
  appointments: 'appointment',
  calendar: 'calendar entry',
  records: 'note',
  'hospital-stays': 'hospital stay',
  results: 'test result',
  'funding-plans': 'funding plan',
  'care-moves': 'move into care',
  equipment: 'equipment',
  assets: 'equipment',
  recalls: 'suggested reminder',
  identifiers: 'ID numbers',
  'emergency-contacts': 'emergency contact',
};

export const entityLabel = (type: string) => ENTITY_LABELS[type] ?? type;

/** What recording or clearing a date of death stopped or put back. */
export interface DeathChange {
  kind: 'stopped' | 'restored';
  tasks: number;
  appointments: number;
  /** One plain sentence for the screen. */
  message: string;
}

/** The activity kind for a recorded dose. Its summary is "Metoprolol as refused". */
export const DOSE_ENTITY = 'doses';

/**
 * The words after a person's name for a dose activity line, so it reads
 * "Jess recorded Metoprolol as refused" rather than "Medication added".
 * With a profile name, it says whose dose it was.
 */
export function doseActivityWords(action: string | null, summary: string | null, profileName?: string): string {
  const what = summary ?? 'a dose';
  if (action === 'deleted') return `removed a dose record${profileName ? ` for ${profileName}` : ''}: ${what}`;
  if (action === 'updated') return `corrected a dose record${profileName ? ` for ${profileName}` : ''}: ${what}`;
  return `recorded ${profileName ? `${profileName}'s ` : ''}${what}`;
}

export interface CareDocument {
  id: string;
  /** The account's category it is filed under, with its name joined in. */
  category_id: string | null;
  category_name: string | null;
  /** Set for built-in categories, e.g. "advance_care_directive". */
  category_key: string | null;
  label: string;
  file_url: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  visible_to_roles: string[] | null;
  /** The condition it was filed against, if any. */
  medical_condition_id?: string | null;
  /** The date it was written. */
  issued_on?: string | null;
  /** When it started counting, e.g. the first visit with the specialist. */
  valid_from?: string | null;
  valid_from_appointment_id?: string | null;
  valid_until?: string | null;
  no_expiry?: boolean;
  /** The referral rule set Valid until, not a person. */
  valid_until_worked_out?: boolean;
  /** How the dates were worked out, in a sentence for the screen. */
  validity_note?: string | null;
  from_provider_id?: string | null;
  to_provider_id?: string | null;
  /** Who wrote it and who it is to, as someone to call. */
  from?: ContactSummary | null;
  to?: ContactSummary | null;
  renewal_task_id?: string | null;
  /** Every record it is attached to, named, with the page that opens it. */
  attached_to?: AttachedTo[];
  created_at: string;
}

/** A record a document is attached to. */
export interface AttachedTo {
  kind: string;
  id: string;
  label: string;
  kind_label: string;
  path: string;
}

/** Categories whose documents usually run out, so Valid until is asked plainly. */
export const EXPIRING_CATEGORY_KEYS = ['referral', 'prescription', 'test_request', 'service_agreement', 'behaviour_support_plan'];

export const PROVIDER_TYPES = [
  { value: 'gp', label: 'GP' },
  { value: 'specialist', label: 'Specialist' },
  { value: 'psychologist', label: 'Psychologist' },
  { value: 'vet', label: 'Vet' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'practice', label: 'Practice' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'care_facility', label: 'Care facility' },
  { value: 'allied_health', label: 'Allied health' },
  { value: 'legal', label: 'Lawyer' },
  { value: 'financial', label: 'Financial adviser' },
  { value: 'social_worker', label: 'Social worker' },
  { value: 'other', label: 'Other' },
] as const;

/**
 * Two kinds of record in the directory: an organisation (a clinic, a health
 * hub, a government department) and a professional (a doctor, a lawyer, a
 * caseworker), usually based at an organisation. Stored as "organisation"
 * and "person".
 */
export type ProviderKind = 'organisation' | 'person';

/** Built-in types organisations are filed under. The rest are for professionals. */
const ORGANISATION_BUILT_INS = new Set(['practice', 'clinic', 'pharmacy', 'care_facility']);

/** The built-in types offered when filing this kind of record. */
export function pickableTypesFor(kind: ProviderKind | 'any') {
  return PROVIDER_TYPES.filter(
    (t) => t.value !== 'other' && (kind === 'any' || ORGANISATION_BUILT_INS.has(t.value) === (kind === 'organisation'))
  );
}

/** What each kind is called on screen, one way everywhere. */
export const KIND_WORDS: Record<ProviderKind, { one: string; many: string; other: ProviderKind }> = {
  organisation: { one: 'organisation', many: 'Organisations', other: 'person' },
  person: { one: 'professional', many: 'Professionals', other: 'organisation' },
};

export const providerTypeLabel = (type: string) =>
  PROVIDER_TYPES.find((t) => t.value === type)?.label ?? type;

/**
 * The stored value for what someone picked or typed as a provider type: a
 * built-in code when it names one ("GP" is stored as gp), otherwise their
 * words with a capital first letter ("neurologist" becomes "Neurologist").
 * The server applies the same rule.
 */
export function providerTypeValue(input: string): string {
  const raw = input.trim();
  if (!raw) return 'other';
  const lower = raw.toLowerCase();
  const hit = PROVIDER_TYPES.find((t) => t.label.toLowerCase() === lower || t.value === lower.replace(/[\s-]+/g, '_'));
  if (hit) return hit.value;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Built-in types offered in the type picker. "Other" is never needed: type the real kind. */
export const PICKABLE_PROVIDER_TYPES = PROVIDER_TYPES.filter((t) => t.value !== 'other');

/** The free-typed provider types in use, beyond the built-in list. */
export function customProviderTypes(rows: Array<{ provider_type: string }>): string[] {
  const known = new Set<string>(PROVIDER_TYPES.map((t) => t.value));
  return [...new Set(rows.map((r) => r.provider_type).filter((t) => !!t && !known.has(t)))].sort(
    (a, b) => a.localeCompare(b)
  );
}

/**
 * Filter options for provider type: the built-in list plus any custom
 * types actually in use, so a custom-typed provider stays filterable.
 */
export function providerTypeFilterOptions(
  rows: Array<{ provider_type: string }>,
  kind?: ProviderKind
): { value: string; label: string }[] {
  const inUse = new Set(rows.map((r) => r.provider_type));
  const builtIns = kind ? PROVIDER_TYPES.filter((t) => pickableTypesFor(kind).some((k) => k.value === t.value) || inUse.has(t.value)) : PROVIDER_TYPES;
  return [
    ...builtIns.map((t) => ({ value: t.value, label: t.label })),
    ...customProviderTypes(rows).map((c) => ({ value: c, label: c })),
  ];
}

export interface Provider {
  id: string;
  provider_type: string;
  name: string;
  organisation: string | null;
  phone: string | null;
  email: string | null;
  /** Composed one-line display, kept in step with the segmented parts. */
  address: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  address_suburb?: string | null;
  address_state?: string | null;
  address_postcode?: string | null;
  address_country?: string | null;
  booking_link: string | null;
  directions_link: string | null;
  /** The provider this one is based at, such as their clinic, or the health hub a clinic is in. */
  practice_id?: string | null;
  /** Whether their address is kept in step with the practice's. */
  uses_practice_address?: boolean;
  /** How many people are filed as working here. */
  member_count?: number;
  /** Other names it goes by, such as a merged duplicate's name. */
  also_known_as?: string[];
  /** An organisation, or a professional. */
  kind?: ProviderKind;
  /** Contact details taken from where they are based, kept in step with it. */
  inherited_fields?: string[];
  poa_type: string | null;
  poa_activated: boolean;
  linked?: boolean;
  after_hours_phone?: string | null;
  fax?: string | null;
  opening_hours?: OpeningHours | null;
  /** For this person: their main contact of this kind (their GP, their pharmacy). */
  is_main?: boolean;
  /** For this person: no longer seeing them since this date. */
  ended_on?: string | null;
}

/** Someone filed as working at a practice. */
export interface PracticeMember {
  id: string;
  name: string;
  provider_type: string;
  kind?: ProviderKind;
}

/** Each day of the week a place opens, Monday = 1, times as HH:MM. */
export type OpeningHours = Array<{ day: 1 | 2 | 3 | 4 | 5 | 6 | 7; opens: string; closes: string }>;

/** One shape for anyone to call, wherever they are named. The API builds it. */
export interface ContactSummary {
  source: 'contact' | 'supplier' | 'circle' | 'account' | 'typed';
  id: string | null;
  name: string;
  role_label: string | null;
  organisation: { id: string | null; name: string } | null;
  phone: string | null;
  after_hours_phone: string | null;
  fax: string | null;
  email: string | null;
  booking_link: string | null;
  order_link: string | null;
  directions_link: string | null;
  address: string | null;
  opening_hours: OpeningHours | null;
  /** Which details came from their practice. */
  inherited: string[];
  is_main: boolean;
  ended_on: string | null;
}

/** A contact record as someone to call. */
export function summaryFromProvider(
  p: Pick<Provider, 'id' | 'name' | 'provider_type' | 'organisation' | 'phone' | 'email' | 'booking_link' | 'directions_link' | 'address' | 'practice_id' | 'inherited_fields'> &
    Partial<Pick<Provider, 'after_hours_phone' | 'fax' | 'opening_hours' | 'is_main' | 'ended_on'>>
): ContactSummary {
  return {
    source: 'contact',
    id: p.id,
    name: p.name,
    role_label: p.provider_type && p.provider_type !== 'other' ? providerTypeLabel(p.provider_type) : null,
    organisation: p.organisation ? { id: p.practice_id ?? null, name: p.organisation } : null,
    phone: p.phone,
    after_hours_phone: p.after_hours_phone ?? null,
    fax: p.fax ?? null,
    email: p.email,
    booking_link: p.booking_link,
    order_link: null,
    directions_link: p.directions_link,
    address: p.address,
    opening_hours: p.opening_hours ?? null,
    inherited: p.inherited_fields ?? [],
    is_main: p.is_main ?? false,
    ended_on: p.ended_on ?? null,
  };
}

/** "Main GP", "Main pharmacy": the type in words, GP kept in capitals. */
export const mainTypeWords = (type: string): string => {
  const label = providerTypeLabel(type);
  return label === 'GP' ? 'GP' : label.toLowerCase();
};

/** Someone who can be picked for a job: the account holder first, then the circle. */
export interface PickablePerson {
  ref: { account_id: string } | { circle_member_id: string };
  name: string;
  label: string | null;
  /** What the person in care is to them ("Mum"). */
  relationship?: string | null;
  phone: string | null;
  email: string | null;
  has_login: boolean;
}

export const personKey = (ref: PickablePerson['ref']) => ('account_id' in ref ? `a:${ref.account_id}` : `m:${ref.circle_member_id}`);

export interface Task {
  id: string;
  title: string;
  body: string | null;
  reminder_type: 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** The repeat choice, e.g. fortnightly or yearly. */
  repeat?: string;
  next_due_at: string;
  /** Any time that day: next_due_at is midnight that day. */
  all_day?: boolean;
  assigned_to: string | null;
  /** Assigned to the account holder, who is not a circle member. */
  assigned_account_id?: string | null;
  assigned_name?: string | null;
  provider_id?: string | null;
  provider_name?: string | null;
  /** Who it is with, as someone to call. */
  provider?: ContactSummary | null;
  next_step_type_id?: string | null;
  kind?: { id: string; name: string; system_key: string | null; books: boolean } | null;
  /** Done by booking an appointment. */
  books?: boolean;
  medical_condition_id?: string | null;
  condition?: { id: string; name: string } | null;
  documents?: Array<{ id: string; label: string; category_name: string | null }>;
  /** Details worked out from the words rather than chosen. */
  inferred_fields?: string[];
  booked_appointment?: { id: string; title: string; starts_at: string; status: string } | null;
  possible_duplicate_of?: { id: string; title: string } | null;
  /** Rounds of a repeating task already done, newest first. */
  rounds_done?: Array<{ id: string; due_at: string; done_at: string; done_by_name: string | null }>;
  merged_into_id?: string | null;
  merged_into_title?: string | null;
  created_at?: string;
  completed: boolean;
  completed_at: string | null;
  completed_by_name: string | null;
  /** Set when recording a death closed this task; clearing the date reopens it. */
  stopped_by_death_at?: string | null;
  desired_outcome: string | null;
  sentiment: number | null;
  completion_reason: string | null;
  completion_note: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  claimed_by_name: string | null;
  co_owners: { id: string; display_name: string }[];
  /** Set when this task is a next step from an appointment. */
  appointment_id?: string | null;
  appointment_title?: string | null;
  appointment_starts_at?: string | null;
  next_step_type_name?: string | null;
  /** An appointment waiting on this to-do for its date: doing it means adding the date. */
  to_book_appointment_id?: string | null;
  to_book_title?: string | null;
}

export const COMPLETION_REASONS = [
  { value: 'achieved', label: 'Goal achieved' },
  { value: 'partially_achieved', label: 'Partially achieved' },
  { value: 'not_achieved', label: 'Not achieved' },
  { value: 'no_longer_needed', label: 'No longer needed' },
  { value: 'delegated', label: 'Delegated to someone else' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'unable_to_complete', label: 'Unable to complete' },
  { value: 'other', label: 'Other' },
] as const;

export const SENTIMENTS = [
  { value: 1, label: 'Angry', emoji: '\u{1F621}' },
  { value: 2, label: 'Sad', emoji: '\u{1F622}' },
  { value: 3, label: 'Disappointed', emoji: '\u{1F61E}' },
  { value: 4, label: 'Neutral', emoji: '\u{1F610}' },
  { value: 5, label: 'Happy', emoji: '\u{1F642}' },
  { value: 6, label: 'Overjoyed', emoji: '\u{1F929}' },
] as const;

export const sentimentLabel = (v: number) => SENTIMENTS.find((s) => s.value === v)?.label ?? '';
export const sentimentEmoji = (v: number) => SENTIMENTS.find((s) => s.value === v)?.emoji ?? '';

export const HEALTH_STATUS_CATEGORIES = [
  { value: 'illness', label: 'Illness' },
  { value: 'injury', label: 'Injury' },
  { value: 'post_operative', label: 'Post-operative' },
  { value: 'recovery', label: 'Recovery' },
  { value: 'mental_health', label: 'Mental health' },
  { value: 'chronic_flare', label: 'Chronic flare-up' },
  { value: 'acute_illness', label: 'Acute illness' },
  { value: 'other', label: 'Other' },
] as const;

export const healthStatusCategoryLabel = (c: string) =>
  HEALTH_STATUS_CATEGORIES.find((x) => x.value === c)?.label ?? c;

export const HEALTH_STATUS_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'resolving', label: 'Resolving' },
  { value: 'resolved', label: 'Resolved' },
] as const;

export const healthStatusStatusLabel = (s: string) =>
  HEALTH_STATUS_STATUSES.find((x) => x.value === s)?.label ?? s;

export interface HealthStatusSymptom {
  id: string;
  health_status_id: string;
  name: string;
  severity: number;
  noted_at: string;
  resolved_at: string | null;
  notes: string | null;
}

export interface HealthStatusDocument {
  id: string;
  category: string;
  label: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  created_at: string;
}

/** One entry in a condition's own log, kept apart from the care log. */
export interface ConditionLogEntry {
  id: string;
  medical_condition_id: string;
  entry_type: string;
  title: string | null;
  body: string;
  occurred_at: string;
  author_name: string | null;
}

/** An appointment that came out of a condition, seen from the condition. */
export interface ConditionAppointment {
  id: string;
  title: string;
  appointment_type: string;
  /** Empty while it is not booked yet. */
  starts_at: string | null;
  status: string;
  location: string | null;
  provider_name: string | null;
  /** How it went, once recorded. */
  outcome?: string | null;
  /** Set when this appointment was booked to carry out an earlier next step. */
  from_reminder_id?: string | null;
  /** What it set off, each a task. */
  next_steps?: Array<{
    id: string;
    title: string;
    type_name: string;
    completed: boolean;
    next_due_at: string;
    led_to: { id: string; title: string; starts_at: string | null } | null;
  }>;
}

/** A document filed against a condition, seen from the condition. */
export interface ConditionDocument {
  id: string;
  label: string;
  category: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  created_at: string;
}

/** A therapy being done for a condition, seen from the condition. */
export interface HealthStatusTreatment {
  id: string;
  name: string;
  category: string;
  active: boolean;
  frequency: string | null;
}

export const CONDITION_LOG_TYPES = [
  { value: 'note', label: 'Note' },
  { value: 'symptom_change', label: 'Change in symptoms' },
  { value: 'treatment', label: 'Treatment' },
  { value: 'appointment_outcome', label: 'What came of an appointment' },
  { value: 'test_result', label: 'Test result' },
  { value: 'scan_result', label: 'Scan result' },
  { value: 'other', label: 'Other' },
] as const;

export const conditionLogTypeLabel = (v: string): string =>
  CONDITION_LOG_TYPES.find((t) => t.value === v)?.label ?? 'Note';

export interface HealthStatus {
  id: string;
  care_profile_id: string;
  name: string;
  category: string;
  status: string;
  onset_date: string;
  expected_resolution_date: string | null;
  actual_resolution_date: string | null;
  is_contagious: boolean;
  isolation_required: boolean;
  escalation_notes: string | null;
  region: string | null;
  linked_condition_id: string | null;
  symptoms: HealthStatusSymptom[];
  documents: HealthStatusDocument[];
  created_at: string;
  updated_at: string;
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
  /** How bad the reaction is. */
  severity: AllergySeverity | null;
}

export const ALLERGY_SEVERITIES = [
  { value: 'mild', label: 'Mild' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
  { value: 'life_threatening', label: 'Life threatening' },
] as const;
export type AllergySeverity = (typeof ALLERGY_SEVERITIES)[number]['value'];
export const severityLabel = (v: string | null | undefined): string | null => ALLERGY_SEVERITIES.find((s) => s.value === v)?.label ?? null;
export const SEVERITY_RANK: Record<string, number> = { mild: 1, moderate: 2, severe: 3, life_threatening: 4 };

/** Checked: no known allergies, with who checked and when. */
export interface NoKnownAllergies {
  on: string;
  by_name: string | null;
}

/** A person's ID numbers, each its own field. */
export interface Identifiers {
  medicare_number: string | null;
  medicare_irn: number | null;
  /** The last day of the month on the card, YYYY-MM-DD. */
  medicare_valid_to: string | null;
  ihi_number: string | null;
  dva_number: string | null;
  dva_card_colour: 'gold' | 'white' | 'orange' | null;
  ndis_number: string | null;
  health_fund_name: string | null;
  health_fund_member_number: string | null;
  my_aged_care_number: string | null;
}
export type IdentifierField = keyof Identifiers;
export const DVA_CARD_COLOURS = [
  { value: 'gold', label: 'Gold' },
  { value: 'white', label: 'White' },
  { value: 'orange', label: 'Orange' },
] as const;

/**
 * How a condition stands right now, in plain language. Anyone can be
 * afflicted with a temporary condition, so the lifecycle is explicit.
 */
export const CONDITION_STATUSES = [
  { value: 'active', label: 'Active', description: 'Being experienced now.' },
  { value: 'improving', label: 'Improving', description: 'On the mend and getting better.' },
  { value: 'managed', label: 'Managed', description: 'Under control with treatment.' },
  { value: 'resolved', label: 'Resolved', description: 'No longer present.' },
] as const;

export const conditionStatusLabel = (s: string) =>
  CONDITION_STATUSES.find((x) => x.value === s)?.label ?? s;

/**
 * Why a condition resolved. Optional, like the date: resolving can simply mean
 * "stop tracking it". Kept in step with packages/api/src/lib/conditionResolution.ts.
 */
export const CONDITION_RESOLUTION_REASONS = [
  { value: 'recovered', label: 'Got better' },
  { value: 'treatment', label: 'Treatment worked' },
  { value: 'surgery', label: 'Surgery fixed it' },
  { value: 'outgrown', label: 'Grew out of it' },
  { value: 'ruled_out', label: 'Ruled out' },
  { value: 'wrong_diagnosis', label: 'Wrong diagnosis' },
  { value: 'not_tracking', label: 'No longer tracking' },
  { value: 'other', label: 'Other' },
] as const;

export const resolutionReasonLabel = (s: string | null | undefined) =>
  s ? CONDITION_RESOLUTION_REASONS.find((x) => x.value === s)?.label ?? s : '';

/**
 * Substance use: which substances a person takes (legal or illegal), how,
 * how much, how often, and where each sits in a lifecycle. Each fact is its
 * own field. The substance and its class come from the shared catalogue.
 */
export interface SubstanceUse {
  id: string;
  substance: string;
  substance_class: string;
  status: string;
  route: string | null;
  quantity: string | null;
  quantity_unit: string | null;
  frequency: string | null;
  started_on: string | null;
  quit_on: string | null;
  notes: string | null;
}

export const SUBSTANCE_CLASSES = [
  { value: 'nicotine', label: 'Nicotine' },
  { value: 'alcohol', label: 'Alcohol' },
  { value: 'cannabis', label: 'Cannabis' },
  { value: 'opioid', label: 'Opioid' },
  { value: 'stimulant', label: 'Stimulant' },
  { value: 'depressant', label: 'Depressant' },
  { value: 'hallucinogen', label: 'Hallucinogen' },
  { value: 'inhalant', label: 'Inhalant' },
  { value: 'other', label: 'Other' },
] as const;

export const SUBSTANCE_STATUSES = [
  { value: 'active', label: 'Using now', description: 'Currently taking it.' },
  { value: 'reducing', label: 'Cutting down', description: 'Using less over time.' },
  { value: 'in_recovery', label: 'In recovery', description: 'Working to stop or stay stopped.' },
  { value: 'in_remission', label: 'In remission', description: 'Stopped, with dependence in the past.' },
  { value: 'former', label: 'Former use', description: 'No longer takes it.' },
] as const;

export const SUBSTANCE_ROUTES = [
  { value: 'smoked', label: 'Smoked' },
  { value: 'vaped', label: 'Vaped' },
  { value: 'oral', label: 'Swallowed' },
  { value: 'drunk', label: 'Drunk' },
  { value: 'injected', label: 'Injected' },
  { value: 'inhaled', label: 'Inhaled' },
  { value: 'other', label: 'Other' },
] as const;

export const substanceClassLabel = (s: string) => SUBSTANCE_CLASSES.find((x) => x.value === s)?.label ?? s;
export const substanceStatusLabel = (s: string) => SUBSTANCE_STATUSES.find((x) => x.value === s)?.label ?? s;
export const substanceRouteLabel = (s: string | null) => (s ? SUBSTANCE_ROUTES.find((x) => x.value === s)?.label ?? s : '');

/** What they live with, tied to the medications and treatments that manage it. */
export interface ConditionSymptom {
  id: string;
  condition_id: string;
  name: string;
  severity: number;
  noted_at: string;
  resolved_at: string | null;
  notes: string | null;
  /** Dated severity readings, oldest first: the course of the symptom. */
  readings?: { id: string; severity: number; recorded_at: string }[];
}

export interface MedicalCondition {
  id: string;
  name: string;
  notes: string | null;
  is_temporary: boolean;
  status: string;
  started_on: string | null;
  resolved_on: string | null;
  /** Why it resolved, from CONDITION_RESOLUTION_REASONS. */
  resolution_reason: string | null;
  /** What happened, in the carer's words. */
  resolution_notes: string | null;
  condition_type: string | null;
  severity: string | null;
  /** The person's normal level on the 1 to 10 symptom scale for this condition;
   * health alerts fire only above it. Null falls back to the standard rule. */
  baseline_severity: number | null;
  is_permanent: boolean | null;
  expected_duration: string | null;
  category: string | null;
  is_contagious: boolean;
  isolation_required: boolean;
  region: string | null;
  neurotype: string | null;
  diagnosis_status: string | null;
  diagnosis_date: string | null;
  diagnosing_provider: string | null;
  diagnosis_document_id: string | null;
  catalogue_icd10_code?: string | null;
  catalogue_snomed_code?: string | null;
  medications: { id?: string; name: string; active: boolean }[];
  /** Who treats it. */
  treating_provider_id?: string | null;
  treating?: ContactSummary | null;
  treatments?: ConditionTreatment[];
  codes?: ConditionCode[];
  functions?: ConditionFunction[];
  symptoms?: ConditionSymptom[];
  attributes?: NeurotypeAttribute[];
  // The condition's own tracking thread: what has been noted about it, the
  // appointments booked under it, and the documents filed against it.
  log_entries?: ConditionLogEntry[];
  appointments?: ConditionAppointment[];
  documents?: ConditionDocument[];
}

/** A standard diagnosis code on a condition: the system and the code. */
export interface ConditionCode {
  id: string;
  system: 'icd10' | 'snomed';
  code: string;
}

/** One affected domain of daily life, per the classification of functioning. */
export interface ConditionFunction {
  id: string;
  domain: string;
  limitation_level: string;
  temporal_pattern: string | null;
  impact_on_activities: string | null;
}

/**
 * A trait, need or support recorded against a neurotype: what the
 * neurodivergence actually looks like for this person, chosen from the shared
 * research-informed library and extendable with their own words.
 */
export interface NeurotypeAttribute {
  id: string;
  condition_id: string;
  catalogue_id: string;
  kind: 'trait' | 'need' | 'support';
  label: string;
  domain: string | null;
  description: string | null;
  notes: string | null;
  sort_order: number;
}

export const ATTRIBUTE_KINDS = [
  { value: 'trait', label: 'Traits', singular: 'trait', blurb: 'How it shows up for them.' },
  { value: 'need', label: 'Needs', singular: 'need', blurb: 'What they need to do well.' },
  { value: 'support', label: 'Supports', singular: 'support', blurb: 'What helps in practice.' },
] as const;

/** Plain-language names for the area of life an attribute touches. */
export const ATTRIBUTE_DOMAIN_LABELS: Record<string, string> = {
  sensory: 'Senses',
  social_communication: 'Social and communication',
  executive_function: 'Planning and focus',
  motor: 'Movement and coordination',
  cognitive: 'Thinking and learning',
  emotional: 'Emotions',
  language: 'Reading and language',
  self_care: 'Daily living',
  attention: 'Attention',
  other: 'Other',
};

export const attributeDomainLabel = (v: string | null | undefined): string =>
  v ? ATTRIBUTE_DOMAIN_LABELS[v] ?? v : '';

/** A treatment tied to a condition, as returned inside the condition. */
export interface ConditionTreatment {
  id: string;
  name: string;
  category: string;
  current_status: string;
  last_review_date: string | null;
  active: boolean;
}

export const CONDITION_TYPES = [
  { value: 'chronic', label: 'Chronic', description: 'Long lasting, managed over months or years.' },
  { value: 'acute', label: 'Acute', description: 'Short lived, expected to pass.' },
  { value: 'disability', label: 'Disability', description: 'Limits daily activities, may be temporary or permanent.' },
  { value: 'other', label: 'Other', description: 'Does not fit the categories above.' },
] as const;

export const conditionTypeLabel = (v: string | null | undefined) =>
  CONDITION_TYPES.find((x) => x.value === v)?.label ?? '';

export const CONDITION_CATEGORIES = [
  { value: 'illness', label: 'Illness' },
  { value: 'injury', label: 'Injury' },
  { value: 'post_operative', label: 'Post-operative' },
  { value: 'recovery', label: 'Recovery' },
  { value: 'mental_health', label: 'Mental health' },
  { value: 'chronic_flare', label: 'Chronic flare-up' },
  { value: 'acute_illness', label: 'Acute illness' },
  { value: 'disability', label: 'Disability' },
  { value: 'neurotype', label: 'Neurotype' },
  { value: 'other', label: 'Other' },
] as const;

export const NEUROTYPE_LABELS = [
  { value: 'autism', label: 'Autism spectrum' },
  { value: 'adhd', label: 'ADHD' },
  { value: 'dyslexia', label: 'Dyslexia' },
  { value: 'dyspraxia', label: 'Dyspraxia' },
  { value: 'dyscalculia', label: 'Dyscalculia' },
  { value: 'tourette', label: 'Tourette syndrome' },
  { value: 'intellectual_disability', label: 'Intellectual disability' },
  { value: 'sensory_processing', label: 'Sensory processing difference' },
  { value: 'other', label: 'Other' },
] as const;

export const neurotypeLabelText = (v: string | null | undefined) =>
  NEUROTYPE_LABELS.find((x) => x.value === v)?.label ?? '';

export const DIAGNOSIS_STATUSES = [
  { value: 'formal', label: 'Formally diagnosed' },
  { value: 'self_identified', label: 'Self-identified' },
  { value: 'suspected', label: 'Suspected' },
  { value: 'in_assessment', label: 'In assessment' },
] as const;

export const diagnosisStatusLabel = (v: string | null | undefined) =>
  DIAGNOSIS_STATUSES.find((x) => x.value === v)?.label ?? '';

export const conditionCategoryLabel = (v: string | null | undefined) =>
  CONDITION_CATEGORIES.find((x) => x.value === v)?.label ?? '';

export const CONDITION_SEVERITIES = [
  { value: 'mild', label: 'Mild' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
  { value: 'profound', label: 'Profound' },
] as const;

export const EXPECTED_DURATIONS = [
  { value: 'self_limiting', label: 'Days to weeks' },
  { value: 'short_term', label: 'Weeks to months' },
  { value: 'long_term', label: 'Months to years' },
  { value: 'lifelong', label: 'Lifelong' },
] as const;

export const expectedDurationLabel = (v: string | null | undefined) =>
  EXPECTED_DURATIONS.find((x) => x.value === v)?.label ?? '';

export const FUNCTION_DOMAINS = [
  { value: 'mobility', label: 'Mobility', description: 'Moving around, standing, walking.' },
  { value: 'cognition', label: 'Thinking and memory', description: 'Concentration, memory, decision making.' },
  { value: 'sensation', label: 'Senses', description: 'Seeing, hearing, feeling.' },
  { value: 'self_care', label: 'Self care', description: 'Washing, dressing, eating.' },
  { value: 'communication', label: 'Communication', description: 'Speaking, understanding, being understood.' },
  { value: 'social', label: 'Social life', description: 'Relationships and taking part.' },
  { value: 'work_study', label: 'Work and study', description: 'Holding a job or keeping up with school.' },
  { value: 'other', label: 'Other', description: 'Anything not covered above.' },
] as const;

export const functionDomainLabel = (v: string) => FUNCTION_DOMAINS.find((x) => x.value === v)?.label ?? v;

export const LIMITATION_LEVELS = [
  { value: 'none', label: 'None' },
  { value: 'mild', label: 'Mild' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
  { value: 'complete', label: 'Complete' },
] as const;

export const TEMPORAL_PATTERNS = [
  { value: 'constant', label: 'Constant' },
  { value: 'intermittent', label: 'Comes and goes' },
  { value: 'progressive', label: 'Getting worse' },
  { value: 'improving', label: 'Improving' },
] as const;

export const temporalPatternLabel = (v: string | null | undefined) =>
  TEMPORAL_PATTERNS.find((x) => x.value === v)?.label ?? '';

export const TREATMENT_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'discontinued', label: 'Stopped' },
] as const;

export const treatmentStatusLabel = (v: string) =>
  TREATMENT_STATUS_OPTIONS.find((x) => x.value === v)?.label ?? v;

export const CODE_SYSTEMS = [
  { value: 'icd10', label: 'ICD-10' },
  { value: 'snomed', label: 'SNOMED CT' },
] as const;

export const codeSystemLabel = (v: string) => CODE_SYSTEMS.find((x) => x.value === v)?.label ?? v;

/**
 * Who to call in an emergency: someone in the circle, the account holder or
 * a contact, read live from their own record; or someone not in PareCare.
 */
export type EmergencyContact = ContactSummary & {
  /** The row; null for the worked-out default. */
  row_id: string | null;
  relationship: string | null;
  sort_order: number;
  /** Worked out from the profile, not chosen. */
  inferred: boolean;
};

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
  /** Loose units left in the open pack. */
  supply_remaining: number | null;
  /** Unopened full packs on hand, on top of the loose units. */
  packs_on_hand: number | null;
  /** When a repeat prescription is next due. */
  repeats_due: string | null;
  /** The account's shared supplier this medication is reordered from. */
  supplier_id?: string | null;
  /** The pharmacy or shop this medication is reordered from. */
  supplier: string | null;
  /** The supplier's branch suburb, telling apart two of the same vendor. */
  supplier_suburb?: string | null;
  /** A direct link to reorder it from that supplier. */
  supplier_order_url: string | null;
  /** When a repeat was ordered, for the reorder workflow. Null when not on
   * order (either well stocked, or depleted and not yet ordered). */
  reorder_ordered_at: string | null;
  /** Dangerous to miss: overdue and out-of-stock alerts are urgent. */
  critical: boolean;
  active: boolean;
  /** Who writes the script. */
  prescriber_provider_id?: string | null;
  prescriber_name?: string | null;
  prescriber?: ContactSummary | null;
  /** Where it is reordered from, as someone to call. */
  supplier_contact?: ContactSummary | null;
  /** The visit it started at. */
  source_appointment_id?: string | null;
  source_appointment?: { id: string; title: string; starts_at: string | null } | null;
  /** The last day it was taken, why it stopped and their words. */
  stopped_on?: string | null;
  stop_reason?: StopReason | null;
  stop_notes?: string | null;
  /** The last day of a course, such as antibiotics. */
  course_ends_on?: string | null;
  /** Repeats left on the script. */
  repeats_left?: number | null;
  /** Its history, newest first. */
  changes?: MedicationChange[];
  /** What an as-needed medicine is for, e.g. breakthrough pain. */
  as_needed_for?: string | null;
  /** At least this many hours between doses. */
  min_hours_between_doses?: number | null;
  /** No more than this many in 24 hours. */
  max_doses_per_day?: number | null;
  /** Last given, by whom, and the given times lately, for as-needed medicines. */
  dose_history?: DoseHistory | null;
  /** Set when a dose found it not in stock, until it is restocked. */
  not_in_stock_admin_id?: string | null;
}

export interface DoseHistory {
  last_given_at: string | null;
  last_given_by: string | null;
  given_24h: number;
  recent_given: string[];
}

export const STOP_REASONS = [
  { value: 'finished', label: 'Course finished' },
  { value: 'side_effects', label: 'Side effects' },
  { value: 'not_working', label: 'Not working' },
  { value: 'changed', label: 'Changed to another medicine' },
  { value: 'doctor_stopped', label: 'Doctor stopped it' },
  { value: 'no_longer_needed', label: 'No longer needed' },
  { value: 'other', label: 'Other' },
] as const;
export type StopReason = (typeof STOP_REASONS)[number]['value'];
export const stopReasonLabel = (v: string | null | undefined): string | null => STOP_REASONS.find((r) => r.value === v)?.label ?? null;

/** One change in a medicine's history. */
export interface MedicationChange {
  id: string;
  medication_id: string;
  changed_on: string;
  change_kind: 'started' | 'dose' | 'times' | 'stopped' | 'restarted' | 'other';
  dose_amount_before: string | null;
  dose_amount_after: string | null;
  dose_unit_before: string | null;
  dose_unit_after: string | null;
  schedule_times_before: string[] | null;
  schedule_times_after: string[] | null;
  reason: string | null;
  source_appointment_id: string | null;
  source_appointment_title: string | null;
  source_appointment_starts_at: string | null;
  source_document_id: string | null;
  source_document_label: string | null;
  changed_by_name: string | null;
  /** Who said so, when a carer recorded a change a doctor asked for. */
  source_provider_id?: string | null;
  source_provider_name?: string | null;
}

const doseText = (amount: string | null, unit: string | null): string => `${amount ?? ''}${unit ?? ''}`.trim();
const timesText = (t: string[] | null): string => (t && t.length ? t.join(' and ') : 'as needed');

/**
 * What changed, in words: "50mg to 25mg", "08:00 and 20:00 to 08:00", or
 * "Started at 50mg". The reason and source are said separately.
 */
export function medicationChangeWhat(c: MedicationChange): string {
  if (c.change_kind === 'started') {
    const dose = doseText(c.dose_amount_after, c.dose_unit_after);
    return dose ? `Started at ${dose}` : 'Started';
  }
  if (c.change_kind === 'stopped') return 'Stopped';
  if (c.change_kind === 'restarted') return 'Started again';
  const parts: string[] = [];
  const before = doseText(c.dose_amount_before, c.dose_unit_before);
  const after = doseText(c.dose_amount_after, c.dose_unit_after);
  if (before !== after) parts.push(`${before || 'no dose'} to ${after || 'no dose'}`);
  const tb = timesText(c.schedule_times_before);
  const ta = timesText(c.schedule_times_after);
  if (tb !== ta) parts.push(`${tb} to ${ta}`);
  return parts.join(', ') || 'Changed';
}

/** A pharmacy or shop a medication is reordered from, shared per account.
 * Mirrors a provider field for field, with a reorder link in place of the
 * booking and directions links. */
export interface Supplier {
  id: string;
  account_id: string;
  /** The vendor name, e.g. "Chemist Warehouse". */
  name: string;
  phone: string | null;
  email: string | null;
  /** Composed one-line display, kept in step with the segmented parts. */
  address: string | null;
  address_line1: string | null;
  address_line2: string | null;
  /** The branch suburb, telling apart two branches of one vendor. */
  address_suburb: string | null;
  address_state: string | null;
  address_postcode: string | null;
  address_country: string | null;
  /** A direct link to reorder from this supplier. */
  order_url: string | null;
  /** A map link to the supplier, the same as a provider's directions link. */
  directions_link: string | null;
}

/** A piece of equipment kept for someone's care: the account's asset register. */
export interface Asset {
  id: string;
  account_id: string;
  /** The unit name, e.g. "Electric hospital bed". */
  name: string;
  /** What kind of equipment it is, e.g. mobility, monitoring. */
  category: string | null;
  /** The maker's serial number or an internal unit/asset number. */
  serial_number: string | null;
  /** The maker or model, for a replacement or a part. */
  make_model: string | null;
  /** What it cost to buy. */
  price: number | null;
  /** When it was bought (YYYY-MM-DD). */
  purchase_date: string | null;
  /** Where it was bought from. */
  supplier: string | null;
  /** The supplier on file, and who to call there. */
  supplier_id?: string | null;
  supplier_contact?: ContactSummary | null;
  /** When the warranty runs out (YYYY-MM-DD). */
  warranty_expiry: string | null;
  /** new | good | fair | poor | retired */
  condition: string | null;
  /** Where the equipment is kept. */
  location: string | null;
  notes: string | null;
  /** Years the equipment is written down over, for depreciation. */
  useful_life_years: number | null;
  /** Straight-line yearly write-down, computed from price and useful life. */
  annual_depreciation?: number | null;
  /** How much has been written down so far, computed. */
  depreciated_amount?: number | null;
  /** Current book value (price less depreciation so far), computed. */
  book_value?: number | null;
  /** owned | loaned | hired */
  ownership?: 'owned' | 'loaned' | 'hired' | null;
  /** When loaned or hired equipment goes back (YYYY-MM-DD). */
  return_by?: string | null;
  /** When it is next due a service (YYYY-MM-DD). */
  service_due_on?: string | null;
  /** Its return and service tasks, on a person's Equipment page. */
  tasks?: Array<{ id: string; title: string; next_due_at: string; all_day: boolean; completed: boolean }>;
}

/**
 * Label a supplier for the picker. When two suppliers share a vendor name,
 * the branch suburb disambiguates them as "Vendor (Suburb)"; a lone vendor
 * shows its name alone. `all` is the full list, so duplicates can be found.
 */
export function supplierLabel(supplier: Supplier, all: Supplier[]): string {
  const sameName = all.filter((s) => s.name.trim().toLowerCase() === supplier.name.trim().toLowerCase());
  if (sameName.length > 1 && supplier.address_suburb?.trim()) return `${supplier.name} (${supplier.address_suburb.trim()})`;
  return supplier.name;
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
/**
 * Everything on hand: the loose units in the open pack plus the units in
 * every unopened pack. Null when supply is not tracked for this medication.
 */
export function totalOnHand(m: {
  supply: number | null;
  supply_remaining: number | null;
  packs_on_hand: number | null;
}): number | null {
  if (m.supply_remaining == null) return null;
  const packUnits = m.packs_on_hand != null && m.supply != null ? m.packs_on_hand * m.supply : 0;
  return m.supply_remaining + packUnits;
}

/**
 * How many days of a medication remain at its current use. Units used per day
 * is units-per-dose times the number of scheduled times a day, so this only
 * applies to scheduled medications with a tracked supply. Returns null when
 * that cannot be worked out (as-needed, no schedule, or no supply on hand).
 */
export function daysOfSupply(m: Pick<MedicationRecord, 'as_needed' | 'units_per_dose' | 'schedule_times' | 'supply' | 'supply_remaining' | 'packs_on_hand'>): number | null {
  if (m.as_needed) return null;
  const onHand = totalOnHand(m);
  if (onHand == null) return null;
  const dosesPerDay = (m.schedule_times ?? []).length;
  if (dosesPerDay <= 0) return null;
  const unitsPerDose = m.units_per_dose && m.units_per_dose > 0 ? m.units_per_dose : 1;
  const perDay = dosesPerDay * unitsPerDose;
  if (perDay <= 0) return null;
  return onHand / perDay;
}

/**
 * Whether a medication has dropped to under five days of supply, the point at
 * which it is worth reordering. Scheduled medications (tablets or liquids, as
 * days-of-supply is worked out from the dose either way) use the days-of-supply
 * figure; as-needed or unscheduled ones fall back to a low fraction of a pack.
 */
export function isLowSupply(m: Pick<MedicationRecord, 'as_needed' | 'units_per_dose' | 'schedule_times' | 'supply' | 'supply_remaining' | 'packs_on_hand'>): boolean {
  const days = daysOfSupply(m);
  if (days != null) return days < 5;
  const onHand = totalOnHand(m);
  return onHand != null && onHand > 0 && m.supply != null && onHand <= m.supply * 0.15;
}

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
  { value: 'not_in_stock', label: 'Not in stock', description: 'There was none to give. The alert says who to call.' },
] as const;

/**
 * An allergy's reaction as it reads after the substance: "rash", but
 * "SJS" and "Stevens-Johnson syndrome" kept as typed.
 */
export function reactionWords(reaction: string | null | undefined): string | null {
  const r = (reaction ?? '').trim();
  if (!r) return null;
  // Lower the first letter only when the rest of the first word is lower
  // case, so names and short forms keep their capitals.
  const firstWord = r.split(/\s/)[0] ?? '';
  return /^[A-Z][^A-Z]*$/.test(firstWord) ? `${r.charAt(0).toLowerCase()}${r.slice(1)}` : r;
}

/** The red chip each allergy is shown in, one chip per allergy. */
export const ALLERGY_CHIP = 'inline-block rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200';

/** "As needed for breakthrough pain. At least 4 hours apart. No more than 8 in 24 hours." */
export function asNeededLine(m: Pick<MedicationRecord, 'as_needed' | 'as_needed_for' | 'min_hours_between_doses' | 'max_doses_per_day'>): string | null {
  // Only an as-needed medicine has limits: a scheduled one runs to its times.
  if (!m.as_needed) return null;
  const parts: string[] = [];
  if (m.as_needed) parts.push(m.as_needed_for ? `As needed for ${m.as_needed_for}.` : 'As needed.');
  if (m.min_hours_between_doses != null) parts.push(`At least ${m.min_hours_between_doses} hours apart.`);
  if (m.max_doses_per_day != null) parts.push(`No more than ${m.max_doses_per_day} in 24 hours.`);
  return parts.length ? parts.join(' ') : null;
}

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
  /** Why an as-needed dose was needed now. */
  reason?: string | null;
  /** Given inside the gap or over the most in 24 hours. */
  outside_limits?: boolean;
  /** Why it had to be given anyway. */
  outside_limits_reason?: string | null;
  right_patient: boolean;
  right_medication: boolean;
  right_dose: boolean;
  right_route: boolean;
  right_time: boolean;
  right_documentation: boolean;
}

/**
 * The kinds of treatment beyond medications, in plain language. A device
 * covers machines like a CPAP unit or oxygen concentrator whose output is
 * logged in whatever the machine reports.
 */
export const TREATMENT_CATEGORIES = [
  { value: 'device', label: 'Device', description: 'A machine used regularly, like a CPAP unit or oxygen concentrator.' },
  { value: 'therapy', label: 'Therapy', description: 'A session with or prescribed by a practitioner, like physiotherapy.' },
  { value: 'exercise', label: 'Exercise', description: 'A prescribed movement or activity program.' },
  { value: 'wound_care', label: 'Wound care', description: 'Dressing changes and wound checks.' },
  { value: 'diet', label: 'Diet', description: 'A dietary program or restriction being followed.' },
  { value: 'surgery', label: 'Surgery', description: 'An operation, done or planned.' },
  { value: 'lifestyle', label: 'Lifestyle change', description: 'A change in daily habits, like quitting smoking.' },
  { value: 'assistive_device', label: 'Assistive device', description: 'An aid used day to day, like a walking frame or hearing aid.' },
  { value: 'other', label: 'Other', description: 'Anything else done to manage a condition.' },
] as const;

export const treatmentCategoryLabel = (c: string) =>
  TREATMENT_CATEGORIES.find((x) => x.value === c)?.label ?? c;

/** The kinds of value a measure can record. */
export const METRIC_VALUE_TYPES = [
  { value: 'number', label: 'Number' },
  { value: 'text', label: 'Text' },
  { value: 'yes_no', label: 'Yes or no' },
] as const;

/**
 * One thing a session of a treatment records, in the unit the device or
 * therapy actually reports. Name and unit are two data points.
 */
export interface TreatmentMetric {
  id: string;
  treatment_id: string;
  name: string;
  unit: string | null;
  value_type: 'number' | 'text' | 'yes_no';
  sort_order: number;
}

/** A therapy or device treatment; medications are their own tranche. */
export interface Treatment {
  id: string;
  care_profile_id: string;
  name: string;
  category: string;
  medical_condition_id: string | null;
  condition_name?: string | null;
  /** The current health entry this treatment came out of, when it did. */
  health_status_id?: string | null;
  instructions: string | null;
  frequency: string | null;
  schedule_times: string[] | null;
  as_needed: boolean;
  active: boolean;
  metrics: TreatmentMetric[];
  last_observed_at?: string | null;
  /** Who provides it. */
  practitioner_provider_id?: string | null;
  practitioner?: ContactSummary | null;
}

/** One recorded reading within an observation. */
export interface ObservationValue {
  id: string;
  observation_id: string;
  treatment_metric_id: string;
  value_number: number | null;
  value_text: string | null;
  value_boolean: boolean | null;
  metric_name: string;
  metric_unit: string | null;
  metric_value_type: 'number' | 'text' | 'yes_no';
}

/** One logged session of a treatment, with its readings. */
export interface Observation {
  id: string;
  care_profile_id: string;
  treatment_id: string;
  treatment_name?: string;
  observed_at: string;
  recorded_by_name: string | null;
  source: 'manual' | 'device';
  status: string;
  notes: string | null;
  values: ObservationValue[];
}

// Plain-language descriptions accompany every outcome, mirroring the MAR.
export const OBSERVATION_STATUSES = [
  { value: 'completed', label: 'Completed', description: 'The session happened in full.' },
  { value: 'partial', label: 'Partly done', description: 'The session happened but was cut short or incomplete.' },
  { value: 'skipped', label: 'Skipped', description: 'The session did not happen this time, for example the person was unwell or away.' },
  { value: 'refused', label: 'Refused', description: 'The person did not want the session and declined it.' },
] as const;

export const observationStatusLabel = (s: string) =>
  OBSERVATION_STATUSES.find((x) => x.value === s)?.label ?? s;
export const observationStatusDescription = (s: string) =>
  OBSERVATION_STATUSES.find((x) => x.value === s)?.description ?? '';

/** A device's credentials for pushing readings; the secret shows once. */
export interface DeviceKey {
  id: string;
  treatment_id: string;
  name: string;
  token_prefix: string;
  active: boolean;
  last_used_at: string | null;
  created_at: string;
}

/**
 * Ready-made treatment set-ups so common therapies start with the right
 * measures. Every measure stays editable after picking one.
 */
export const TREATMENT_TEMPLATES: {
  name: string;
  category: string;
  frequency: string;
  metrics: { name: string; unit: string | null; value_type: 'number' | 'text' | 'yes_no' }[];
}[] = [
  {
    name: 'CPAP therapy',
    category: 'device',
    frequency: 'Every night',
    metrics: [
      { name: 'Hours used', unit: 'hours', value_type: 'number' },
      { name: 'Events per hour', unit: 'events', value_type: 'number' },
      { name: 'Mask leak', unit: 'litres per minute', value_type: 'number' },
    ],
  },
  {
    name: 'Oxygen therapy',
    category: 'device',
    frequency: 'As directed',
    metrics: [
      { name: 'Flow rate', unit: 'litres per minute', value_type: 'number' },
      { name: 'Hours used', unit: 'hours', value_type: 'number' },
    ],
  },
  {
    name: 'Blood glucose check',
    category: 'device',
    frequency: 'Before meals',
    metrics: [{ name: 'Reading', unit: 'mmol/L', value_type: 'number' }],
  },
  {
    name: 'Blood pressure check',
    category: 'device',
    frequency: 'Every morning',
    metrics: [
      { name: 'Top number when the heart beats', unit: 'mmHg', value_type: 'number' },
      { name: 'Bottom number between beats', unit: 'mmHg', value_type: 'number' },
      { name: 'Pulse', unit: 'beats per minute', value_type: 'number' },
    ],
  },
  {
    name: 'Physiotherapy exercises',
    category: 'exercise',
    frequency: 'Twice a day',
    metrics: [
      { name: 'Time spent', unit: 'minutes', value_type: 'number' },
      { name: 'Pain level from 0 to 10', unit: null, value_type: 'number' },
    ],
  },
  {
    name: 'Wound dressing change',
    category: 'wound_care',
    frequency: 'Every second day',
    metrics: [
      { name: 'Healing well', unit: null, value_type: 'yes_no' },
      { name: 'Appearance', unit: null, value_type: 'text' },
    ],
  },
];

export interface CarePlan {
  dietary_requirements: string[];
  mobility_aids: string[];
  communication_needs: string[];
  /** What keeps eating and drinking safe, such as "Sit upright to eat and drink". */
  swallowing_needs?: string[];
  advance_care_directive: boolean;
  advance_care_directive_location: string | null;
  /** Read only: who to call, as lines. They are kept on their own list (/emergency-contacts). */
  emergency_contacts?: Array<{ name: string; relationship: string | null; phone: string | null }>;
}

// --- The versioned care plan document ------------------------------------

/** One entry in a plan section; every fact is its own field. */
export interface PlanEntry {
  key: string;
  fields: Record<string, string | number | boolean | null>;
}

export interface PlanContent {
  sections: Record<string, PlanEntry[]>;
}

export const PLAN_SECTION_LABELS: Record<string, string> = {
  goals: 'Goals and preferences',
  strategies: 'Care strategies',
  risks: 'Risks and considerations',
  review: 'Review schedule',
  allergies: 'Allergies',
  conditions: 'Conditions',
  medications: 'Medications',
  treatments: 'Treatments',
  needs: 'Day-to-day needs',
  directive: 'Advance care directive',
  emergency_contacts: 'Emergency contacts',
  providers: 'Professionals and organisations',
};

/** Presentation order: the synthesized narrative leads, the record follows. */
export const PLAN_SECTION_ORDER = [
  'goals',
  'strategies',
  'risks',
  'review',
  'allergies',
  'conditions',
  'medications',
  'treatments',
  'needs',
  'directive',
  'emergency_contacts',
  'providers',
];

/** Sections written by the plan editor from the recorded facts. */
export const PLAN_NARRATIVE_SECTIONS = new Set(['goals', 'strategies', 'risks', 'review']);

export const planSectionLabel = (s: string) => PLAN_SECTION_LABELS[s] ?? s;

export const PLAN_VERSION_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'awaiting_signoff', label: 'Awaiting sign-off' },
  { value: 'published', label: 'Published' },
] as const;

export const planVersionStatusLabel = (s: string) =>
  PLAN_VERSION_STATUSES.find((x) => x.value === s)?.label ?? s;

export interface PlanVersionMeta {
  id: string;
  version: number;
  status: string;
  content_hash: string;
  changelog: string | null;
  author_account_id: string | null;
  author_name: string | null;
  applied_event_ids: string[];
  document_id: string | null;
  restored_from_version: number | null;
  locked: boolean;
  created_at: string;
  published_at: string | null;
  signature_count: number;
}

export interface PlanPermissions {
  view: boolean;
  comment: boolean;
  edit: boolean;
  sign: boolean;
}

export interface PlanChange {
  id: string;
  op: 'add' | 'modify' | 'remove';
  section: string;
  entry_key: string;
  before: Record<string, string | number | boolean | null> | null;
  after: Record<string, string | number | boolean | null> | null;
  source_event_ids: string[];
  created_at: string;
  version: number;
  version_status?: string;
  actor_name: string | null;
}

export interface PlanSignature {
  id: string;
  signer_account_id?: string | null;
  signer_name: string;
  signed_at: string;
  signature_hash: string;
  consent?: boolean;
}

export interface PlanReview {
  id: string;
  invited_email: string | null;
  invited_name: string | null;
  can_comment: boolean;
  can_approve: boolean;
  status: string;
  comment: string | null;
  created_at: string;
  responded_at: string | null;
  expires_at: string;
}

export interface PlanAccessRow {
  id: string;
  account_id: string | null;
  account_name?: string | null;
  account_email?: string | null;
  email: string | null;
  access_role: string;
  can_view: boolean;
  can_comment: boolean;
  can_edit: boolean;
  can_sign: boolean;
}

export const PLAN_ACCESS_ROLES = [
  { value: 'lead_coordinator', label: 'Lead coordinator' },
  { value: 'provider', label: 'Assigned professional' },
  { value: 'carer', label: 'Nominated carer' },
  { value: 'emergency_contact', label: 'Emergency contact' },
  { value: 'shared', label: 'Explicit share' },
] as const;

export const planAccessRoleLabel = (v: string) =>
  PLAN_ACCESS_ROLES.find((x) => x.value === v)?.label ?? v;

export interface PlanPendingEvent {
  id: string;
  source_table: string;
  action: string;
  summary: string | null;
  created_at: string;
}

export interface PlanBaselineGaps {
  allergies: boolean;
  emergency_contacts: boolean;
  gp: boolean;
  needs: boolean;
}

export interface PlanPendingInfo {
  pending_events: PlanPendingEvent[];
  has_versions: boolean;
  awaiting_signoff: PlanVersionMeta | null;
  baseline_gaps: PlanBaselineGaps;
}

/**
 * What someone is to the person, from what the person is to them: Dorothy
 * is Linda's mother, so Linda is her daughter. Gender picks the word when it
 * is known; otherwise only an answer that needs no gender is given.
 */
export function inverseRelationship(personIsTheir: string | null | undefined, gender?: string | null): string | null {
  const rel = String(personIsTheir ?? '').trim().toLowerCase();
  const g = String(gender ?? '').trim().toLowerCase();
  const female = /^(f|female|woman|girl)$/.test(g);
  const male = /^(m|male|man|boy)$/.test(g);
  const pick = (f: string, m: string) => (female ? f : male ? m : null);
  if (['mother', 'mum', 'mom', 'father', 'dad', 'parent'].includes(rel)) return pick('Daughter', 'Son');
  if (['son', 'daughter', 'child'].includes(rel)) return pick('Mother', 'Father');
  if (['grandma', 'grandmother', 'grandpa', 'grandfather', 'nan', 'nana'].includes(rel)) return pick('Granddaughter', 'Grandson');
  if (['grandson', 'granddaughter'].includes(rel)) return pick('Grandmother', 'Grandfather');
  if (['sister', 'brother'].includes(rel)) return pick('Sister', 'Brother');
  if (['aunt', 'uncle'].includes(rel)) return pick('Niece', 'Nephew');
  if (['niece', 'nephew'].includes(rel)) return pick('Aunt', 'Uncle');
  if (['mother-in-law', 'father-in-law'].includes(rel)) return pick('Daughter-in-law', 'Son-in-law');
  if (['partner', 'wife', 'husband', 'spouse'].includes(rel)) return 'Partner';
  if (rel === 'friend') return 'Friend';
  if (rel === 'neighbour' || rel === 'neighbor') return 'Neighbour';
  if (rel === 'cousin') return 'Cousin';
  return null;
}

/** Words for what an emergency contact is to the person, offered as suggestions. */
export const EMERGENCY_RELATIONSHIPS = [
  'Daughter', 'Son', 'Partner', 'Mother', 'Father', 'Sister', 'Brother', 'Granddaughter', 'Grandson',
  'Niece', 'Nephew', 'Friend', 'Neighbour', 'Carer', 'Support worker', 'Guardian',
] as const;
