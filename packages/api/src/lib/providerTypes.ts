/**
 * The kinds of provider PareCare knows about. A handful are built in and
 * stored as a short code (gp, pharmacy); anything else is stored as the
 * words the person typed ("Neurologist") and joins the shared list of
 * provider types, so the next person to see a neurologist just picks it.
 *
 * The web app keeps the same built-in list in lib/care.ts.
 */

export const BUILT_IN_PROVIDER_TYPES = [
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
 * hub, the Department of Justice) and a professional (a doctor, a lawyer, a
 * caseworker), who is usually based at an organisation.
 */
export type ProviderKind = 'organisation' | 'person';

/** Types an organisation is filed under, built in and offered from day one. */
export const ORGANISATION_TYPES = [
  'practice', 'clinic', 'pharmacy', 'care_facility',
  'Health hub', 'Hospital', 'Medical centre', 'Health centre', 'Pathology', 'Radiology',
  'Government department', 'Government agency', 'Community organisation', 'Charity',
  'Law firm', 'Insurer', 'School', 'Disability service', 'Aged care service',
  'Aged care home', 'Nursing home', 'Care home', 'Retirement village', 'Group home', 'Hospice',
  'Plan management provider', 'Respite service',
];

const ORG_TYPE_SET = new Set(ORGANISATION_TYPES.map((t) => t.toLowerCase()));
const PERSON_BUILT_INS = new Set(['gp', 'specialist', 'psychologist', 'vet', 'allied_health', 'legal', 'financial', 'social_worker']);

/** Whether a type is one organisations are filed under. */
export const isOrganisationType = (type: string | null | undefined): boolean => ORG_TYPE_SET.has(String(type ?? '').trim().toLowerCase());

const PERSON_TITLE = /^(dr|prof|professor|mr|mrs|ms|miss|mx|sister)\.?\s/i;
const ORG_WORDS = /\b(clinic|hospital|centre|center|hub|practice|pharmacy|chemist|department|dept|agency|services|council|commission|ministry|office|authority|tribunal|court|association|foundation|society|trust|charity|institute|university|school|college|group|partners|pty|ltd|limited|inc|corporation|company|network|medical|radiology|pathology|imaging|ndis|centrelink|medicare|government|lawyers|solicitors|insurance|aged care|nursing home|care home|hospice|retirement village)\b/i;

/**
 * Whether a record is an organisation or a professional, worked out from its
 * type and name when nobody said: "Department of Justice" is an
 * organisation, "Dr Karen Sank" a professional. `orgTypes` adds the custom
 * types people have filed organisations under, in lower case.
 */
export function kindFor(type: string | null | undefined, name: string | null | undefined, orgTypes?: Set<string>): ProviderKind {
  const t = String(type ?? '').trim().toLowerCase();
  const n = String(name ?? '').trim();
  if (PERSON_TITLE.test(n)) return 'person';
  if (ORG_TYPE_SET.has(t) || orgTypes?.has(t)) return 'organisation';
  // "Smith Lawyers" filed as a lawyer is still a firm.
  if (ORG_WORDS.test(n)) return 'organisation';
  if (PERSON_BUILT_INS.has(t)) return 'person';
  return 'person';
}

/**
 * A type that suits the kind: an organisation saved as "Other" or as a kind
 * of professional takes a kind of organisation from its name (the
 * Department of Justice is a Government department), and a professional
 * saved as a kind of place is a Doctor when titled Dr, otherwise Other.
 */
export function fitTypeToKind(type: string, kind: ProviderKind, name: string): string {
  if (kind === 'organisation' && (type === 'other' || PERSON_BUILT_INS.has(type))) return placeTypeFromName(name);
  if (kind === 'person' && isOrganisationType(type)) return personTypeForPlace(type, name);
  return type;
}

/**
 * What someone does, from the kind of place they were filed under: a person
 * saved as a School is a Teacher, as a Pharmacy a Pharmacist, as a Law firm
 * a Lawyer; at a hospital or clinic, a Doctor when titled Dr.
 */
export function personTypeForPlace(placeType: string, name: string): string {
  const t = placeType.trim().toLowerCase();
  const titledDr = /^dr\.?\s/i.test(name.trim());
  if (t === 'school') return 'Teacher';
  if (t === 'pharmacy') return 'Pharmacist';
  if (t === 'law firm') return 'legal';
  if (['hospital', 'clinic', 'practice', 'medical centre', 'health centre', 'health hub'].includes(t)) return titledDr ? 'Doctor' : 'other';
  if (['plan management provider'].includes(t)) return 'Plan manager';
  if (['respite service', 'disability service', 'aged care service'].includes(t)) return titledDr ? 'Doctor' : 'Support worker';
  return titledDr ? 'Doctor' : 'other';
}

/** The type a place is filed under when its name does not say what it is. */
export const PRACTICE_TYPE = 'practice';

/** Kinds of provider that are places people work at. */
export const PLACE_TYPES = ['Health hub', 'practice', 'clinic', 'pharmacy', 'care_facility', 'Hospital', 'Medical centre', 'Health centre', 'Pathology', 'Radiology'];

/**
 * What kind of place a name describes, so a newly filed place gets a fitting
 * type without anyone being asked: "Brain Clinic" is a clinic, "Caboolture
 * Hospital" a hospital, "Health Hub Morayfield" a health hub.
 */
export function placeTypeFromName(name: string): string {
  const n = name.toLowerCase();
  if (/\bhealth ?hub\b/.test(n)) return 'Health hub';
  if (/\bclinic\b/.test(n)) return 'clinic';
  if (/\bhospital\b/.test(n)) return 'Hospital';
  if (/\b(pharmacy|chemist)\b/.test(n)) return 'pharmacy';
  if (/\bmedical cent(re|er)\b/.test(n)) return 'Medical centre';
  if (/\bhealth cent(re|er)\b/.test(n)) return 'Health centre';
  if (/\b(pathology|path lab)\b/.test(n)) return 'Pathology';
  if (/\b(radiology|imaging|x-ray)\b/.test(n)) return 'Radiology';
  if (/\bdepartment\b/.test(n)) return 'Government department';
  if (/\b(agency|office of|public guardian|public trustee|tribunal|commission|council|centrelink|services australia)\b/.test(n)) return 'Government agency';
  if (/\b(lawyers|solicitors|legal|law firm|barristers)\b/.test(n)) return 'Law firm';
  if (/\b(insurance|insurer)\b/.test(n)) return 'Insurer';
  if (/\b(school|college)\b/.test(n)) return 'School';
  return PRACTICE_TYPE;
}

/**
 * Common kinds of provider offered from the first day, so most people never
 * have to type one. Anyone can add more just by typing a new one.
 */
export const SEEDED_PROVIDER_TYPES = [
  'Accountant',
  'Audiologist',
  'Behaviour support practitioner',
  'Cardiologist',
  'Care coordinator',
  'Case manager',
  'Chiropractor',
  'Counsellor',
  'Dentist',
  'Dermatologist',
  'Dietitian',
  'Doctor',
  'Endocrinologist',
  'Exercise physiologist',
  'Gastroenterologist',
  'Geriatrician',
  'Gynaecologist',
  'Haematologist',
  'Local Area Coordinator',
  'Nephrologist',
  'Neurologist',
  'Neurosurgeon',
  'Nurse',
  'Obstetrician',
  'Occupational therapist',
  'Oncologist',
  'Ophthalmologist',
  'Optometrist',
  'Orthopaedic surgeon',
  'Osteopath',
  'Paediatrician',
  'Pharmacist',
  'Physiotherapist',
  'Plan manager',
  'Podiatrist',
  'Psychiatrist',
  'Respiratory physician',
  'Rheumatologist',
  'Sleep physician',
  'Speech pathologist',
  'Support coordinator',
  'Support worker',
  'Surgeon',
  'Teacher',
  'Teacher aide',
  'Urologist',
];

const BUILT_IN_VALUES = new Set<string>(BUILT_IN_PROVIDER_TYPES.map((t) => t.value));

export const isBuiltInProviderType = (value: string): boolean => BUILT_IN_VALUES.has(value);

/**
 * Turn whatever was said or typed into the stored type: a built-in code when
 * it names one ("GP", "gp", "Clinic", "care facility"), otherwise
 * the typed words with a capital first letter ("neurologist" becomes
 * "Neurologist"). Empty input falls back to "other".
 */
export function normaliseProviderType(input: string | null | undefined): string {
  const raw = String(input ?? '').trim();
  if (!raw) return 'other';
  const lower = raw.toLowerCase();
  const asCode = lower.replace(/[\s-]+/g, '_');
  for (const t of BUILT_IN_PROVIDER_TYPES) {
    if (t.value === asCode || t.label.toLowerCase() === lower) return t.value;
  }
  // Everyday ways of naming one kind of place.
  if (['medical practice', 'surgery', 'gp practice'].includes(lower)) return PRACTICE_TYPE;
  if (['medical center'].includes(lower)) return 'Medical centre';
  if (['health center'].includes(lower)) return 'Health centre';
  // Keep the person's own spelling of a known shared type.
  if (['solicitor', 'barrister'].includes(lower)) return 'legal';
  if (['financial planner'].includes(lower)) return 'financial';
  const seeded = [...SEEDED_PROVIDER_TYPES, ...ORGANISATION_TYPES].find((s) => s.toLowerCase() === lower);
  if (seeded) return seeded;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** What someone does, in words: built-in codes read as their label ("gp" is "GP"). */
export function providerTypeLabel(type: string | null | undefined): string | null {
  const t = String(type ?? '').trim();
  if (!t || t === 'other') return null;
  return BUILT_IN_PROVIDER_TYPES.find((b) => b.value === t)?.label ?? t;
}
