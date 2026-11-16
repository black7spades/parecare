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
  { value: 'legal', label: 'Legal' },
  { value: 'financial', label: 'Financial' },
  { value: 'social_worker', label: 'Social worker' },
  { value: 'other', label: 'Other' },
] as const;

/** The type a place is filed under when its name does not say what it is. */
export const PRACTICE_TYPE = 'practice';

/** Kinds of provider that are places people work at. */
export const PLACE_TYPES = ['practice', 'clinic', 'pharmacy', 'care_facility', 'Hospital', 'Medical centre', 'Health centre', 'Pathology', 'Radiology'];

/**
 * What kind of place a name describes, so a newly filed place gets a fitting
 * type without anyone being asked: "Brain Clinic" is a clinic, "Caboolture
 * Hospital" a hospital, "Health Hub Morayfield" a practice.
 */
export function placeTypeFromName(name: string): string {
  const n = name.toLowerCase();
  if (/\bclinic\b/.test(n)) return 'clinic';
  if (/\bhospital\b/.test(n)) return 'Hospital';
  if (/\b(pharmacy|chemist)\b/.test(n)) return 'pharmacy';
  if (/\bmedical cent(re|er)\b/.test(n)) return 'Medical centre';
  if (/\bhealth cent(re|er)\b/.test(n)) return 'Health centre';
  if (/\b(pathology|path lab)\b/.test(n)) return 'Pathology';
  if (/\b(radiology|imaging|x-ray)\b/.test(n)) return 'Radiology';
  return PRACTICE_TYPE;
}

/**
 * Common kinds of provider offered from the first day, so most people never
 * have to type one. Anyone can add more just by typing a new one.
 */
export const SEEDED_PROVIDER_TYPES = [
  'Audiologist',
  'Cardiologist',
  'Chiropractor',
  'Counsellor',
  'Dentist',
  'Dermatologist',
  'Dietitian',
  'Endocrinologist',
  'Exercise physiologist',
  'Gastroenterologist',
  'Geriatrician',
  'Gynaecologist',
  'Haematologist',
  'Health centre',
  'Hospital',
  'Medical centre',
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
  'Pathology',
  'Physiotherapist',
  'Podiatrist',
  'Psychiatrist',
  'Radiology',
  'Respiratory physician',
  'Rheumatologist',
  'Sleep physician',
  'Speech pathologist',
  'Surgeon',
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
  if (['medical practice', 'surgery', 'health hub', 'gp practice'].includes(lower)) return PRACTICE_TYPE;
  if (['medical center'].includes(lower)) return 'Medical centre';
  if (['health center'].includes(lower)) return 'Health centre';
  // Keep the person's own spelling of a known shared type.
  const seeded = SEEDED_PROVIDER_TYPES.find((s) => s.toLowerCase() === lower);
  if (seeded) return seeded;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
