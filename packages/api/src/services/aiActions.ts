import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { accountIdForProfile, resolveCategoryByName, withCategory } from './documentCategories';
import { db } from '../config/database';
import { auditContext, currentAuditSource, currentUndoBatch, type AuditSource } from './auditContext';
import type { Account, CareAccess, CareCircleMember, CareProfile } from '../types';
import { parseZonedTime, formatInZone, dateInZone, isValidTimeZone } from '../lib/timezone';
import { matchProfileNames, type NameCandidate } from '../lib/nameMatch';
import { drawDownOnHand, perDoseDrawdown } from './medicationSupply';
import { resolveSupplierId } from '../routes/medications';
import { resolveConditionCatalogueId } from '../routes/conditionCatalogue';
import { CONDITION_RESOLUTION_REASONS } from '../lib/conditionResolution';
import { DOSE_AUDIT_ENTITY, doseSummary } from '../lib/doseOutcome';
import { CIRCLE_ROLE_VALUES, roleMaySee } from '../lib/circleRoles';
import { resolveAssetSupplier, resolveContactInput, setContactStanding } from './professionals';
import { parseHoursList } from '../lib/openingHours';
import { addEmergencyContact, EmergencyContactError, emergencyContactsFor, removeEmergencyContact, type EmergencyRef } from './emergencyContacts';
import { resolveSubstanceCatalogueId, SUBSTANCE_CLASSES } from '../routes/substanceCatalogue';
import { SUBSTANCE_STATUSES, SUBSTANCE_ROUTES } from '../routes/substanceUse';
import { resolveSymptomCatalogueId } from '../routes/symptomCatalogue';
import { resolveNeurotypeAttributeCatalogueId, ATTRIBUTE_KINDS } from '../routes/neurotypeAttributeCatalogue';
import { linkAddressToProfile, syncProfileResidence, RESIDENCE_KIND } from './addresses';
import { addNextSteps } from '../routes/appointments';
import { APPOINTMENT_TYPES, APPOINTMENT_STATUSES, BookingProblem, bookAppointment, updateAppointment, type AppointmentInput } from './booking';
import { TaskProblem, createTask, updateTask, type TaskInput } from './tasks';
import { findPickablePerson } from './people';
import { REPEAT_CHOICE_VALUES } from '../lib/repeat';
import { findPhones } from '../lib/phoneText';
import { createForwards, type ForwardItem } from './noteForwards';
import { addCirclePerson, findCircleMemberByName, isAddedPerson } from './circlePeople';
import { OBSERVATION_STATUSES } from '../routes/treatments';
import { FUNDING_SOURCES, CLAIM_STATUSES } from './healthSpend';
import { addPracticeMember, syncPracticeMembers, whereNamed } from './providerPractices';
import { linkContactToSuppliers } from './professionals';
import type { Knex } from 'knex';
import { providerWriteColumns } from '../routes/providers';

/**
 * Actions the assistant can carry out on the user's behalf: logging a care
 * event, recording a medication dose, or adding a task. The model emits a
 * fenced ```parecare-action``` block containing one JSON action; the server
 * validates it against these schemas and executes it with the SAME
 * permission rules as the equivalent API endpoint (viewers cannot write).
 * Every action lands in the audit log like any other change.
 */

export const LOG_ENTRY_TYPES = [
  'visit',
  'medication',
  'medical_appointment',
  'phone_call',
  'decision_made',
  'concern_raised',
  'observation',
  'handover',
] as const;

const MEDICATION_STATUSES = ['given', 'refused', 'omitted', 'held', 'self_administered'] as const;

const logEventSchema = z.object({
  type: z.literal('log_event'),
  entry_type: z.enum(LOG_ENTRY_TYPES),
  title: z.string().max(255).optional().nullable(),
  body: z.string().min(1),
  occurred_at: z.string().optional().nullable(),
});

const recordMedicationSchema = z.object({
  type: z.literal('record_medication'),
  medication_name: z.string().min(1),
  status: z.enum(MEDICATION_STATUSES).default('given'),
  dose_given: z.string().max(255).optional().nullable(),
  notes: z.string().optional().nullable(),
  administered_at: z.string().optional().nullable(),
});

const recordMedicationBatchSchema = z.object({
  type: z.literal('record_medications'),
  entries: z
    .array(
      z.object({
        medication_name: z.string().min(1),
        status: z.enum(MEDICATION_STATUSES).default('self_administered'),
        dose_given: z.string().max(255).optional().nullable(),
        notes: z.string().optional().nullable(),
        administered_at: z.string().optional().nullable(),
      })
    )
    .min(1)
    .max(20),
});

/**
 * A task. "with" is who it is with (a contact by name; a new name is filed
 * in Contacts) and "with_phone" their number, so a number is never left only
 * in the notes. A date with no time (YYYY-MM-DD) means any time that day.
 * The same task service as the task form, so who and what are worked out
 * from the words and a second task for one booking joins the first.
 */
const taskFields = {
  title: z.string().min(1).max(255),
  body: z.string().optional().nullable(),
  due_at: z.string(),
  repeat: z.enum(REPEAT_CHOICE_VALUES).default('once'),
  with: z.string().max(255).optional().nullable(),
  with_type: z.string().max(100).optional().nullable(),
  with_phone: z.string().max(50).optional().nullable(),
  kind: z.string().max(100).optional().nullable(),
  for_condition: z.string().max(255).optional().nullable(),
  assign_to: z.string().max(255).optional().nullable(),
  documents: z.array(z.string().max(255)).max(20).optional().nullable(),
};

const addTaskSchema = z.object({
  type: z.literal('add_task'),
  ...taskFields,
});

const CARE_PHASES = [
  'early_concern',
  'home_with_support',
  'increased_dependency',
  'transition_to_residential',
  'residential_ongoing',
  'end_of_life',
] as const;

// Any kind of provider: a built-in code (gp, pharmacy, practice ...) or plain
// words ("Neurologist"). Stored through normaliseProviderType, so "GP",
// "clinic" and "neurologist" all land as the person would expect.
const providerTypeField = z.string().min(1).max(100);

const addMedicationSchema = z.object({
  type: z.literal('add_medication'),
  medication_name: z.string().min(1).max(255),
  dose: z.string().max(255).optional().nullable(),
  route: z.string().max(100).optional().nullable(),
  form: z.string().max(100).optional().nullable(),
  frequency: z.string().max(255).optional().nullable(),
  schedule_times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(12).optional().nullable(),
  instructions: z.string().optional().nullable(),
  units_per_dose: z.number().nonnegative().optional().nullable(),
  supply: z.number().nonnegative().optional().nullable(),
  packs_on_hand: z.number().nonnegative().optional().nullable(),
  supplier: z.string().max(255).optional().nullable(),
  supplier_order_url: z.string().url().max(2000).optional().nullable(),
  with_food: z.boolean().optional(),
  as_needed: z.boolean().optional(),
  critical: z.boolean().optional(),
  // Who writes the script: a contact by name, filed in Contacts when new.
  prescriber: z.string().max(255).optional().nullable(),
  prescriber_type: providerTypeField.optional().nullable(),
  // The title of the visit it started at, matched among their appointments.
  started_at_appointment: z.string().max(255).optional().nullable(),
});

const updateMedicationSchema = z.object({
  type: z.literal('update_medication'),
  medication_name: z.string().min(1).max(255),
  dose: z.string().max(255).optional().nullable(),
  route: z.string().max(100).optional().nullable(),
  frequency: z.string().max(255).optional().nullable(),
  schedule_times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(12).optional().nullable(),
  instructions: z.string().optional().nullable(),
  units_per_dose: z.number().nonnegative().optional().nullable(),
  supply: z.number().nonnegative().optional().nullable(),
  supply_remaining: z.number().nonnegative().optional().nullable(),
  packs_on_hand: z.number().nonnegative().optional().nullable(),
  supplier: z.string().max(255).optional().nullable(),
  supplier_order_url: z.string().url().max(2000).optional().nullable(),
  with_food: z.boolean().optional(),
  as_needed: z.boolean().optional(),
  critical: z.boolean().optional(),
  // Who writes the script: a contact by name, filed in Contacts when new.
  prescriber: z.string().max(255).optional().nullable(),
  prescriber_type: providerTypeField.optional().nullable(),
  // The title of the visit it started at, matched among their appointments.
  started_at_appointment: z.string().max(255).optional().nullable(),
});

// "Picked up two packs of Perindopril": set what is on hand after a restock.
const restockMedicationSchema = z.object({
  type: z.literal('restock_medication'),
  medication_name: z.string().min(1).max(255),
  packs_on_hand: z.number().nonnegative().optional().nullable(),
  units_remaining: z.number().nonnegative().optional().nullable(),
});

const stopMedicationSchema = z.object({
  type: z.literal('stop_medication'),
  medication_name: z.string().min(1).max(255),
});

const addAllergySchema = z.object({
  type: z.literal('add_allergy'),
  substance: z.string().min(1).max(255),
  reaction: z.string().optional().nullable(),
});

const removeAllergySchema = z.object({
  type: z.literal('remove_allergy'),
  substance: z.string().min(1).max(255),
});

const CONDITION_CATEGORIES = [
  'illness',
  'injury',
  'post_operative',
  'recovery',
  'mental_health',
  'chronic_flare',
  'acute_illness',
  'disability',
  'other',
] as const;

const CONDITION_STATUSES = ['active', 'improving', 'managed', 'resolved'] as const;

const CONDITION_SEVERITIES = ['mild', 'moderate', 'severe', 'critical'] as const;

const addConditionSchema = z.object({
  type: z.literal('add_condition'),
  name: z.string().min(1).max(255),
  category: z.enum(CONDITION_CATEGORIES).optional().nullable(),
  severity: z.enum(CONDITION_SEVERITIES).optional().nullable(),
  status: z.enum(CONDITION_STATUSES).optional().nullable(),
  started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().optional().nullable(),
  // Who treats it: a contact by name, filed in Contacts when new.
  treated_by: z.string().max(255).optional().nullable(),
  treated_by_type: providerTypeField.optional().nullable(),
});

// Change a condition already on file, found by its exact name.
const updateConditionSchema = z.object({
  type: z.literal('update_condition'),
  name: z.string().min(1).max(255),
  treated_by: z.string().max(255).optional().nullable(),
  treated_by_type: providerTypeField.optional().nullable(),
  severity: z.enum(CONDITION_SEVERITIES).optional().nullable(),
  status: z.enum(CONDITION_STATUSES).optional().nullable(),
  notes: z.string().optional().nullable(),
});

// Add to a condition's own tracking log: how the sprained ankle is going,
// what the scan showed, what the doctor said. Kept apart from the care log.
const logConditionSchema = z.object({
  type: z.literal('log_condition'),
  // The condition by name, matched within this person's conditions.
  condition: z.string().min(1).max(255),
  entry_type: z
    .enum(['note', 'symptom_change', 'treatment', 'appointment_outcome', 'test_result', 'scan_result', 'other'])
    .optional()
    .nullable(),
  title: z.string().max(255).optional().nullable(),
  body: z.string().min(1).max(10000),
  occurred_at: z.string().optional().nullable(),
});

const removeConditionSchema = z.object({
  type: z.literal('remove_condition'),
  name: z.string().min(1).max(255),
});

const resolveConditionSchema = z.object({
  type: z.literal('resolve_condition'),
  name: z.string().min(1).max(255),
  // Only when the user says when. Never guessed: resolving can simply mean
  // the user has stopped tracking it.
  resolved_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  resolution_reason: z.enum(CONDITION_RESOLUTION_REASONS).optional().nullable(),
  resolution_notes: z.string().max(2000).optional().nullable(),
});

const addSubstanceSchema = z.object({
  type: z.literal('add_substance'),
  substance: z.string().min(1).max(255),
  substance_class: z.enum(SUBSTANCE_CLASSES).optional().nullable(),
  status: z.enum(SUBSTANCE_STATUSES).optional().nullable(),
  route: z.enum(SUBSTANCE_ROUTES).optional().nullable(),
  quantity: z.string().max(100).optional().nullable(),
  quantity_unit: z.string().max(60).optional().nullable(),
  frequency: z.string().max(120).optional().nullable(),
  started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  quit_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

const updateSubstanceSchema = z.object({
  type: z.literal('update_substance'),
  substance: z.string().min(1).max(255),
  status: z.enum(SUBSTANCE_STATUSES).optional().nullable(),
  route: z.enum(SUBSTANCE_ROUTES).optional().nullable(),
  quantity: z.string().max(100).optional().nullable(),
  quantity_unit: z.string().max(60).optional().nullable(),
  frequency: z.string().max(120).optional().nullable(),
  quit_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

const removeSubstanceSchema = z.object({
  type: z.literal('remove_substance'),
  substance: z.string().min(1).max(255),
});

// Neurotype traits, needs and supports: what a neurodivergence actually looks
// like for this person. neurotype_name matches a recorded neurotype (e.g.
// "Autism"); kind is trait, need or support; label is the item itself.
const addNeurotypeAttributeSchema = z.object({
  type: z.literal('add_neurotype_attribute'),
  neurotype_name: z.string().min(1).max(255),
  kind: z.enum(ATTRIBUTE_KINDS),
  label: z.string().min(1).max(255),
  notes: z.string().max(2000).optional().nullable(),
});

const removeNeurotypeAttributeSchema = z.object({
  type: z.literal('remove_neurotype_attribute'),
  neurotype_name: z.string().min(1).max(255),
  kind: z.enum(ATTRIBUTE_KINDS),
  label: z.string().min(1).max(255),
});

// The acute illness tracker: record a symptom on a condition, or move an
// existing symptom's severity up or down as things progress.
const addSymptomSchema = z.object({
  type: z.literal('add_symptom'),
  condition_name: z.string().min(1).max(255),
  symptom_name: z.string().min(1).max(255),
  severity: z.number().int().min(1).max(10).default(5),
});

const updateSymptomSchema = z.object({
  type: z.literal('update_symptom'),
  symptom_name: z.string().min(1).max(255),
  condition_name: z.string().max(255).optional().nullable(),
  severity: z.number().int().min(1).max(10).optional().nullable(),
  resolved: z.boolean().optional().nullable(),
});

const TREATMENT_CATEGORIES = [
  'device',
  'therapy',
  'exercise',
  'wound_care',
  'diet',
  'surgery',
  'lifestyle',
  'assistive_device',
  'other',
] as const;

const addTreatmentSchema = z.object({
  type: z.literal('add_treatment'),
  name: z.string().min(1).max(255),
  category: z.enum(TREATMENT_CATEGORIES).default('other'),
  condition_name: z.string().max(255).optional().nullable(),
  // Who provides it: a contact by name, filed in Contacts when new.
  provided_by: z.string().max(255).optional().nullable(),
  provided_by_type: providerTypeField.optional().nullable(),
});

const raiseQuestionSchema = z.object({
  type: z.literal('raise_question'),
  title: z.string().min(1).max(255),
  body: z.string().optional().nullable(),
});

const setCarePhaseSchema = z.object({
  type: z.literal('set_care_phase'),
  phase: z.enum(CARE_PHASES),
});

// An organisation (a clinic, a health hub, a government department) or a
// professional (a doctor, a lawyer, a caseworker). Worked out from the name
// and type when left out.
const providerKindField = z.enum(['organisation', 'person']);

const addProviderSchema = z.object({
  type: z.literal('add_provider'),
  kind: providerKindField.optional(),
  provider_type: providerTypeField,
  name: z.string().min(1).max(255),
  // The clinic or practice they work at. It is found in the directory, or
  // filed if new, and they share its address.
  organisation: z.string().max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().max(255).optional().nullable(),
  booking_link: z.string().url().optional().nullable(),
  directions_link: z.string().url().optional().nullable(),
  after_hours_phone: z.string().max(50).optional().nullable(),
  fax: z.string().max(50).optional().nullable(),
  // A row per open day: { "day": "mon".."sun", "opens": "HH:MM", "closes": "HH:MM" }.
  opening_hours: z
    .array(z.object({ day: z.string().max(10), opens: z.string().max(5), closes: z.string().max(5) }))
    .max(21)
    .optional()
    .nullable(),
  // The person's main contact of this kind (their GP, their pharmacy).
  main: z.boolean().optional(),
  // They no longer see this contact, from today.
  no_longer_seeing: z.boolean().optional(),
});

const addAssetSchema = z.object({
  type: z.literal('add_asset'),
  name: z.string().min(1).max(255),
  category: z.string().max(100).optional().nullable(),
  serial_number: z.string().max(120).optional().nullable(),
  make_model: z.string().max(255).optional().nullable(),
  price: z.number().nonnegative().optional().nullable(),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  supplier: z.string().max(255).optional().nullable(),
  warranty_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  condition: z.string().max(30).optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  useful_life_years: z.number().int().nonnegative().optional().nullable(),
});

/**
 * File a document already on record under a category, and optionally give it
 * a clearer name. The category is a name: a new one is added to the account's
 * list. When Pare reads a document the server fills in which document.
 */
const fileDocumentSchema = z.object({
  type: z.literal('file_document'),
  document_id: z.string().uuid().optional(),
  /** The document's current name, when the id is not known (the chat). */
  document: z.string().max(255).optional(),
  category: z.string().trim().max(100).optional().nullable(),
  label: z.string().trim().max(255).optional().nullable(),
});

const updateProviderSchema = z.object({
  type: z.literal('update_provider'),
  name: z.string().min(1).max(255),
  kind: providerKindField.optional(),
  provider_type: providerTypeField.optional(),
  organisation: z.string().max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().max(255).optional().nullable(),
  booking_link: z.string().url().optional().nullable(),
  directions_link: z.string().url().optional().nullable(),
  after_hours_phone: z.string().max(50).optional().nullable(),
  fax: z.string().max(50).optional().nullable(),
  // A row per open day: { "day": "mon".."sun", "opens": "HH:MM", "closes": "HH:MM" }.
  opening_hours: z
    .array(z.object({ day: z.string().max(10), opens: z.string().max(5), closes: z.string().max(5) }))
    .max(21)
    .optional()
    .nullable(),
  // The person's main contact of this kind (their GP, their pharmacy).
  main: z.boolean().optional(),
  // They no longer see this contact, from today.
  no_longer_seeing: z.boolean().optional(),
});

const linkProviderSchema = z.object({
  type: z.literal('link_provider'),
  // The name of an existing provider in the account's directory to attach to
  // this profile, the same way providers can be shared across people.
  name: z.string().min(1).max(255),
  main: z.boolean().optional(),
});

// Who to call in an emergency. "me" is whoever is speaking; otherwise a
// circle person, a contact, or a new name with a phone.
const setEmergencyContactSchema = z.object({
  type: z.literal('set_emergency_contact'),
  name: z.string().min(1).max(255),
  relationship: z.string().max(100).optional().nullable(),
  // Saved on their own record, so it changes everywhere.
  phone: z.string().max(50).optional().nullable(),
  first: z.boolean().optional(),
  remove: z.boolean().optional(),
});

// File a practitioner at a practice in the account's directory: "add Dr
// Carly Examplename to Health Hub Morayfield". Either side is found by name
// or filed if new, and the practitioner shares the practice's address. It
// does not link anyone to this profile; add_provider does that.
const addToPracticeSchema = z.object({
  type: z.literal('add_to_practice'),
  practitioner: z.string().min(1).max(255),
  practice: z.string().min(1).max(255),
  // The bigger place the practice is in, such as a health hub.
  part_of: z.string().max(255).optional().nullable(),
  provider_type: providerTypeField.optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().max(255).optional().nullable(),
});

const linkAddressSchema = z.object({
  type: z.literal('link_address'),
  // Text to find an existing address in the account's book by: its label, its
  // one-line form, or a street line. Linking it records where they live.
  address: z.string().min(1).max(500),
});

const updateCarePlanSchema = z.object({
  type: z.literal('update_care_plan'),
  dietary_requirements: z.array(z.string()).max(50).optional().nullable(),
  mobility_aids: z.array(z.string()).max(50).optional().nullable(),
  // A list of discrete needs; the GP lives in providers (use the provider
  // actions to change it).
  communication_needs: z.array(z.string()).max(50).optional().nullable(),
  advance_care_directive: z.boolean().optional().nullable(),
  advance_care_directive_location: z.string().optional().nullable(),
});

const updateProfileSchema = z.object({
  type: z.literal('update_profile'),
  preferred_name: z.string().max(100).optional().nullable(),
  pronouns: z.string().max(50).optional().nullable(),
  primary_language: z.string().max(100).optional().nullable(),
  notes: z.string().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  // A pet's owner, named as a person already in the account (a care profile).
  owner_name: z.string().max(255).optional().nullable(),
});

/**
 * Booking an appointment creates the appointment record that feeds the
 * calendar, not a care log entry. The provider is named, then resolved
 * against the account's directory the same way link_provider does. A cost
 * given at booking time becomes an estimated spend entry, exactly as the
 * appointment form does.
 */
const appointmentExtras = {
  with_type: z.string().max(100).optional().nullable(),
  with_phone: z.string().max(50).optional().nullable(),
  for_condition: z.string().max(255).optional().nullable(),
  // A day with no set time, such as a walk-in blood test.
  no_set_time: z.boolean().optional().nullable(),
  repeat: z.enum(REPEAT_CHOICE_VALUES).optional().nullable(),
  repeat_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  telehealth_link: z.string().max(2000).optional().nullable(),
  // Setting a language marks that an interpreter is needed.
  interpreter_language: z.string().max(100).optional().nullable(),
  // Who is going, by name, or "me"; the driver is one of them.
  going: z.array(z.string().max(255)).max(20).optional().nullable(),
  driver: z.string().max(255).optional().nullable(),
  preparation: z.string().max(4000).optional().nullable(),
  documents_to_bring: z.array(z.string().max(255)).max(20).optional().nullable(),
};

const bookAppointmentSchema = z.object({
  type: z.literal('book_appointment'),
  title: z.string().min(1).max(255),
  appointment_type: z.enum(APPOINTMENT_TYPES).default('consultation'),
  provider_name: z.string().max(255).optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  // Left out when it is not booked yet: the details are kept and a to-do
  // waits for the date.
  starts_at: z.string().optional().nullable(),
  ends_at: z.string().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  cost_estimate: z.number().min(0).max(1e9).optional().nullable(),
  // The title of the open task or next step this booking is for, such as
  // "Book a neurologist" or "Dr Patel, neurologist". Booking it ticks the task
  // off and anything forwarded to it lands on this appointment.
  for_next_step: z.string().max(255).optional().nullable(),
  ...appointmentExtras,
});

/**
 * Pass on what was noted at one appointment to another, or to a next step not
 * booked yet (it lands when booked), exactly as the Forward notes form does.
 * include picks the pieces: outcome (what happened), details (the
 * appointment's notes box), added_notes (every note added to it). All by
 * default.
 */
const forwardAppointmentNotesSchema = z.object({
  type: z.literal('forward_appointment_notes'),
  from_appointment_title: z.string().max(255).optional().nullable(),
  to_appointment_title: z.string().max(255).optional().nullable(),
  to_next_step: z.string().max(255).optional().nullable(),
  include: z.array(z.enum(['outcome', 'details', 'added_notes'])).max(3).optional().nullable(),
});

/**
 * The people around someone who were added rather than invited: a neighbour,
 * a friend who drives, a support worker. No login, no email invite. A doctor,
 * psychologist or any other professional is add_provider instead, so the
 * same person is linked to appointments.
 */
const addCirclePersonSchema = z.object({
  type: z.literal('add_circle_person'),
  name: z.string().min(1).max(255),
  role: z.enum(CIRCLE_ROLE_VALUES).default('other'),
  relationship: z.string().max(100).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().max(255).optional().nullable(),
});

const updateCirclePersonSchema = z.object({
  type: z.literal('update_circle_person'),
  name: z.string().min(1).max(255),
  new_name: z.string().max(255).optional().nullable(),
  role: z.enum(CIRCLE_ROLE_VALUES).optional(),
  relationship: z.string().max(100).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().max(255).optional().nullable(),
});

const removeCirclePersonSchema = z.object({
  type: z.literal('remove_circle_person'),
  name: z.string().min(1).max(255),
});

/**
 * Change an appointment already on the calendar: move it (starts_at),
 * cancel it or mark it attended (status), or confirm what it actually cost
 * (cost_actual). Found by title among this profile's appointments.
 */
const updateAppointmentSchema = z.object({
  type: z.literal('update_appointment'),
  title: z.string().min(1).max(255),
  new_title: z.string().max(255).optional().nullable(),
  appointment_type: z.enum(APPOINTMENT_TYPES).optional(),
  provider_name: z.string().max(255).optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  starts_at: z.string().optional().nullable(),
  ends_at: z.string().optional().nullable(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  notes: z.string().max(4000).optional().nullable(),
  cost_estimate: z.number().min(0).max(1e9).optional().nullable(),
  cost_actual: z.number().min(0).max(1e9).optional().nullable(),
  ...appointmentExtras,
});

/**
 * How an appointment went and what it set off. The outcome is a short note on
 * the appointment; each next step (a referral, a blood test, a prescription to
 * fill, a semen sample, anything) becomes a task tied to it, exactly as the
 * outcome form files them. The kind is one of the account's next-step kinds
 * by name, or a new name, which is added to their list.
 */
const recordAppointmentOutcomeSchema = z.object({
  type: z.literal('record_appointment_outcome'),
  // An appointment already on file, by its title. Never guessed: with no
  // title, or one that matches nothing, the outcome is filed as its own visit.
  appointment_title: z.string().max(255).optional().nullable(),
  // What the visit was when it is not on file, e.g. "Box Hill Hospital stay",
  // and the day it happened.
  visit_title: z.string().max(255).optional().nullable(),
  visited_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  outcome: z.string().max(4000).optional().nullable(),
  next_steps: z
    .array(
      z.object({
        kind: z.string().min(1).max(100),
        details: z.string().max(255).optional().nullable(),
        due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        // Who it is with, such as who a referral is to, and what they do.
        // Filed in Contacts automatically.
        to_name: z.string().max(255).optional().nullable(),
        to_type: z.string().max(100).optional().nullable(),
      })
    )
    .max(20)
    .default([]),
});

const completeTaskSchema = z.object({
  type: z.literal('complete_task'),
  title: z.string().min(1).max(255),
  completion_note: z.string().max(240).optional().nullable(),
});

const rescheduleTaskSchema = z.object({
  type: z.literal('reschedule_task'),
  title: z.string().min(1).max(255),
  // A date with no time (YYYY-MM-DD) means any time that day.
  due_at: z.string(),
  repeat: z.enum(REPEAT_CHOICE_VALUES).optional(),
});

/**
 * A care cost goes on the health spend ledger as its own dated entry, with
 * the accounting fields kept as separate data points. The ledger is owner
 * and admin only, matching requireProfileOwner on the REST route.
 */
const recordCostSchema = z.object({
  type: z.literal('record_cost'),
  amount: z.number().min(0).max(1e9),
  spent_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  tax_amount: z.number().min(0).max(1e9).optional().nullable(),
  funding_source: z.enum(FUNDING_SOURCES).optional().nullable(),
  claimable_amount: z.number().min(0).max(1e9).optional().nullable(),
  claim_status: z.enum(CLAIM_STATUSES).optional(),
  account_code: z.string().max(50).optional().nullable(),
});

/**
 * One session of a treatment, with its measured readings. Each reading names
 * the measure it belongs to ("Systolic", "Weight"); the measure is resolved
 * within that treatment, so a value never lands on the wrong metric.
 */
const recordReadingSchema = z.object({
  type: z.literal('record_reading'),
  treatment_name: z.string().min(1).max(255),
  observed_at: z.string().optional().nullable(),
  status: z.enum(OBSERVATION_STATUSES).default('completed'),
  notes: z.string().max(4000).optional().nullable(),
  values: z
    .array(
      z.object({
        metric_name: z.string().min(1).max(255),
        value_number: z.number().finite().optional().nullable(),
        value_text: z.string().max(2000).optional().nullable(),
        value_boolean: z.boolean().optional().nullable(),
      })
    )
    .max(50)
    .optional(),
});

/**
 * Not a change at all: the assistant asking back rather than guessing. It
 * writes nothing, and renders as a question with the choices it needs an
 * answer to, so an ambiguous name or a missing time stops the action instead
 * of landing a wrong record.
 */
const needClarificationSchema = z.object({
  type: z.literal('need_clarification'),
  question: z.string().min(1).max(500),
  options: z.array(z.string().max(200)).max(8).optional(),
});

export const actionSchema = z.discriminatedUnion('type', [
  logEventSchema,
  recordMedicationSchema,
  recordMedicationBatchSchema,
  addTaskSchema,
  addMedicationSchema,
  updateMedicationSchema,
  stopMedicationSchema,
  restockMedicationSchema,
  addAllergySchema,
  removeAllergySchema,
  addConditionSchema,
  updateConditionSchema,
  logConditionSchema,
  removeConditionSchema,
  addSubstanceSchema,
  updateSubstanceSchema,
  removeSubstanceSchema,
  addNeurotypeAttributeSchema,
  removeNeurotypeAttributeSchema,
  resolveConditionSchema,
  addSymptomSchema,
  updateSymptomSchema,
  addTreatmentSchema,
  raiseQuestionSchema,
  setCarePhaseSchema,
  addProviderSchema,
  addAssetSchema,
  fileDocumentSchema,
  updateProviderSchema,
  linkProviderSchema,
  setEmergencyContactSchema,
  addToPracticeSchema,
  linkAddressSchema,
  updateCarePlanSchema,
  updateProfileSchema,
  bookAppointmentSchema,
  updateAppointmentSchema,
  recordAppointmentOutcomeSchema,
  forwardAppointmentNotesSchema,
  addCirclePersonSchema,
  updateCirclePersonSchema,
  removeCirclePersonSchema,
  completeTaskSchema,
  rescheduleTaskSchema,
  recordCostSchema,
  recordReadingSchema,
  needClarificationSchema,
]);
export type AssistantAction = z.infer<typeof actionSchema>;

/**
 * A plain JSON schema for constrained ("structured output") decoding. Given a
 * Zod schema, produce the JSON schema a provider can enforce so the model
 * cannot emit malformed output. Internal references are inlined because some
 * local grammar builders do not follow "$ref", and the "$schema" key is
 * dropped because some providers reject unknown top-level keys.
 */
export function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // The schema is widened at this boundary: zod-to-json-schema's generic
  // overloads instantiate excessively deep on a union this large, and the
  // runtime call does not need the precise type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = zodToJsonSchema(schema as any, { $refStrategy: 'none' }) as Record<string, unknown>;
  delete json['$schema'];
  return json;
}

/**
 * The constrained-output envelope: the assistant's spoken reply plus the
 * actions it wants carried out, as one object. When a provider supports
 * structured output (see aiProvider.supportsStructuredOutput), this is the
 * shape the model is forced to fill, so an action can never come back
 * malformed: the prose lands in "reply" and every action, already well
 * formed, lands in "actions". The tolerant text parsing below stays as a
 * fallback for providers that cannot be constrained.
 */
export const actionResponseSchema = z.object({
  reply: z.string(),
  actions: z.array(actionSchema),
});
export type ActionResponse = z.infer<typeof actionResponseSchema>;

export const ACTION_RESPONSE_JSON_SCHEMA = toJsonSchema(actionResponseSchema);

/**
 * Actions the dashboard assistant can take across more than one care
 * profile at once. Each entry names its target profile, so one sentence
 * ("we took both cats to the vet") can land on every relevant record.
 */
const crossProfileLogSchema = z.object({
  type: z.literal('cross_profile_log'),
  entries: z
    .array(
      z.object({
        profile_name: z.string().min(1),
        entry_type: z.enum(LOG_ENTRY_TYPES),
        title: z.string().max(255).optional().nullable(),
        body: z.string().min(1),
        occurred_at: z.string().optional().nullable(),
      })
    )
    .min(1)
    .max(20),
});

const crossProfileTaskSchema = z.object({
  type: z.literal('cross_profile_task'),
  entries: z
    .array(
      z.object({
        profile_name: z.string().min(1),
        ...taskFields,
      })
    )
    .min(1)
    .max(20),
});

const crossProfileMedicationSchema = z.object({
  type: z.literal('cross_profile_medications'),
  entries: z
    .array(
      z.object({
        profile_name: z.string().min(1),
        medication_name: z.string().min(1),
        status: z.enum(MEDICATION_STATUSES).default('self_administered'),
        dose_given: z.string().max(255).optional().nullable(),
        notes: z.string().optional().nullable(),
        administered_at: z.string().optional().nullable(),
      })
    )
    .min(1)
    .max(20),
});

/**
 * The general dashboard action: run any single-profile action against a
 * named profile. This is what lets Pare do, from one conversation, anything
 * that can be done by hand on a person's record: change a medication
 * schedule, add an allergy, resolve a question, move a care phase, and so
 * on, without a bespoke cross-profile wrapper for each.
 */
const profileActionsSchema = z.object({
  type: z.literal('profile_actions'),
  entries: z
    .array(
      z.object({
        profile_name: z.string().min(1),
        action: actionSchema,
      })
    )
    .min(1)
    .max(20),
});

export const crossProfileActionSchema = z.discriminatedUnion('type', [
  crossProfileLogSchema,
  crossProfileTaskSchema,
  crossProfileMedicationSchema,
  profileActionsSchema,
]);
export type CrossProfileAction = z.infer<typeof crossProfileActionSchema>;

export interface ExtractedActions<T = AssistantAction> {
  /** The reply with action blocks removed. */
  cleanedReply: string;
  actions: T[];
  parseErrors: string[];
}

// Any fenced code block: ``` or ~~~ (three or more), an optional info string,
// then a body, then a matching closing fence. Model-agnostic on purpose —
// the action is carried by the JSON inside, not by a single exact fence.
const FENCE_RE = /(`{3,}|~{3,})[ \t]*([^\n]*?)[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*\1[ \t]*(?=\r?\n|$)/g;

// An info string that explicitly marks a PareCare action, tolerating the ways
// models spell it: parecare-action, parecare_action, "parecare action".
const ACTION_INFO_RE = /parecare[\s_-]*action/i;

// Which generic (non-action-labelled) fences we are willing to read as
// actions when their JSON validates: an unlabelled block or a json block.
const GENERIC_INFO_RE = /^(json|json5|jsonc)?$/i;

/**
 * The index just past a balanced JSON value that starts at `start` (on a `{`
 * or `[`), respecting strings and escapes, or -1 if it never closes. Used to
 * lift a bare JSON action out of prose when a model forgets the code fence.
 */
function jsonSpanEnd(text: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth += 1;
    else if (c === '}' || c === ']') {
      depth -= 1;
      if (depth === 0) return i + 1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/**
 * Lift bare, unfenced JSON actions out of a reply. Some models narrate the
 * confirmation and drop the code fence entirely; without this, the action
 * would silently not happen. Only spans that parse and fully validate as
 * actions are consumed, so ordinary prose and non-action JSON are untouched.
 */
function scanBareActions<T>(
  text: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  actions: T[],
): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    // A JSON action always begins with an object or array whose first key is
    // a quote; anything else is prose and is copied through untouched.
    if ((c === '{' || c === '[') && /["[{]/.test(text.slice(i + 1).trimStart()[0] ?? '')) {
      const end = jsonSpanEnd(text, i);
      if (end > i) {
        const candidate = text.slice(i, end);
        try {
          const parsed = JSON.parse(candidate);
          const items = Array.isArray(parsed) ? parsed : [parsed];
          if (items.length > 0 && items.every((it) => schema.safeParse(it).success)) {
            for (const it of items) actions.push(schema.parse(it));
            i = end;
            continue;
          }
        } catch {
          // Not valid JSON: fall through and treat as ordinary text.
        }
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Validate one candidate against the schema, collecting the action or an error. */
function takeCandidate<T>(
  raw: unknown,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  actions: T[],
  parseErrors: string[],
): boolean {
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    actions.push(parsed.data);
    return true;
  }
  const attempted =
    String((raw as { type?: unknown; action?: unknown })?.type ?? (raw as { action?: unknown })?.action ?? '')
      .replace(/_/g, ' ') || 'take an unrecognised action';
  const first = parsed.error.issues[0];
  const where = first?.path?.length ? ` (problem with "${first.path.join('.')}": ${first.message.toLowerCase()})` : '';
  console.warn('Assistant action validation failed:', attempted, parsed.error.format());
  parseErrors.push(
    `Pare tried to ${attempted} but that action could not be validated${where}, so it was not carried out. Try asking again in different words.`,
  );
  return false;
}

/**
 * Tidy a spoken reply for display: drop any confirmation tick the model
 * invented (the app writes the real ones itself, after an action runs) and
 * collapse runaway blank lines. Shared by the tolerant text parser and the
 * constrained-output path, so both show the same clean prose.
 */
export function tidyReply(text: string): string {
  return text
    .replace(/^[ \t]*[✔✓☑].*(?:\n|$)/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Pull every action the assistant proposed out of a reply and validate it
 * against the given schema. Shared by the profile-level assistant and the
 * dashboard assistant, which understand different action sets.
 *
 * This is deliberately tolerant of how a model fences its action JSON, so
 * that swapping the AI provider or model does not silently stop actions from
 * being carried out. It accepts:
 *   - an explicit fence whose info string names a parecare action, in any of
 *     its spellings (the block is always consumed, and a bad one reports why);
 *   - a plain ```json or unlabelled fence whose entire contents validate as
 *     one action or an array of actions (consumed only when it validates, so
 *     ordinary example JSON is left in the reply untouched).
 * A single block may carry one action object or an array of them.
 */
export function extractActionBlocks<T>(reply: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): ExtractedActions<T> {
  const actions: T[] = [];
  const parseErrors: string[] = [];

  let out = '';
  let cursor = 0;
  for (const m of reply.matchAll(FENCE_RE)) {
    const whole = m[0];
    const info = (m[2] ?? '').trim();
    const body = (m[3] ?? '').trim();
    const start = m.index ?? 0;

    const isActionFence = ACTION_INFO_RE.test(info);
    const isGenericFence = GENERIC_INFO_RE.test(info);
    if (!isActionFence && !isGenericFence) {
      // A fenced block that is clearly something else (e.g. ```sql): leave it.
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      if (isActionFence) {
        out += reply.slice(cursor, start);
        cursor = start + whole.length;
        parseErrors.push('Pare suggested an action that could not be read, so it was not carried out.');
      }
      continue;
    }

    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    if (isActionFence) {
      // An explicit action block is always consumed; each item is validated.
      out += reply.slice(cursor, start);
      cursor = start + whole.length;
      for (const c of candidates) takeCandidate(c, schema, actions, parseErrors);
    } else {
      // A generic block is only treated as actions when everything in it
      // validates; otherwise it is ordinary content and stays in the reply.
      const allValid = candidates.length > 0 && candidates.every((c) => schema.safeParse(c).success);
      if (allValid) {
        out += reply.slice(cursor, start);
        cursor = start + whole.length;
        for (const c of candidates) takeCandidate(c, schema, actions, parseErrors);
      }
    }
  }
  out += reply.slice(cursor);

  // Some models drop the code fence and leave the action JSON bare in prose.
  // Lift out any that fully validate, so a change of model cannot silently
  // stop actions from being carried out.
  let cleanedReply = scanBareActions(out, schema, actions);

  // A reply cut off mid-action (provider token limit) leaves an opening fence
  // with no closing one, so the loop above never matched it. Never show the
  // half-written JSON; say plainly that nothing was recorded for it.
  const dangling = cleanedReply.search(/(`{3,}|~{3,})[ \t]*[^\n]*parecare[\s_-]*action/i);
  if (dangling !== -1) {
    cleanedReply = cleanedReply.slice(0, dangling);
    parseErrors.push('The reply was cut off before this could be recorded, so nothing was saved. Please ask again.');
  }
  // A model sometimes fakes the app's own confirmation lines ("✔ Logged ...")
  // in its prose. Those are never the model's to write, and the real ones are
  // appended by the route after execution, so drop any the model invented.
  cleanedReply = tidyReply(cleanedReply);
  return { cleanedReply, actions, parseErrors };
}

export function extractActions(reply: string): ExtractedActions {
  return extractActionBlocks(reply, actionSchema);
}

/**
 * Validate a list of already-structured action objects, as a provider's
 * constrained output hands them back, against the schema. Collects each valid
 * action and a plain-language message for any that does not fit, exactly as
 * the text parser does, so one bad action never sinks the rest. This is the
 * constrained-output counterpart to extractActionBlocks.
 */
export function collectActions<T>(
  raw: unknown[],
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): { actions: T[]; parseErrors: string[] } {
  const actions: T[] = [];
  const parseErrors: string[] = [];
  for (const item of raw) takeCandidate(item, schema, actions, parseErrors);
  return { actions, parseErrors };
}

/**
 * Turn an assistant-supplied time into a UTC instant. A naive wall-clock
 * time ("2026-07-10T11:00:00") is read in the user's own time zone, so
 * "11am this morning" is stored as 11am where they are, not 11am UTC.
 */
function parseWhen(value: string | null | undefined, timeZone: string | null | undefined): Date {
  if (!value) return new Date();
  const d = parseZonedTime(value, timeZone);
  if (!d) return new Date();
  // Never record anything in the future; clamp to now (same rule as the MAR).
  return d.getTime() > Date.now() + 60_000 ? new Date() : d;
}

/**
 * The same wall-clock reading as parseWhen, but for things that are meant to
 * be in the future: an appointment at 11:45 tomorrow, a task due next
 * Tuesday. Nothing is clamped to now, and an unreadable time returns null so
 * the caller asks rather than booking something at the wrong moment.
 */
function parseFutureWhen(value: string | null | undefined, timeZone: string | null | undefined): Date | null {
  if (!value) return null;
  return parseZonedTime(value, timeZone) ?? null;
}

/**
 * Marks an outcome line as a question back to the person rather than a
 * change that was made, so the chat shows it as a question instead of a tick.
 */
export const CLARIFY_MARK = '❓';

/**
 * Record one change in the audit trail. Attribution (person, Pare, or an
 * outside assistant) and the undo batch ride along from the request context, so
 * the executors below never have to carry them. When a create action passes the
 * id of the row it inserted, that id is stored too, which is what lets the
 * change be undone later.
 */
async function audit(
  profileId: string,
  accountId: string,
  entityType: string,
  summary: string,
  entityId?: string | null
): Promise<void> {
  await db('audit_log')
    .insert({
      care_profile_id: profileId,
      actor_account_id: accountId,
      action: 'created',
      entity_type: entityType,
      summary: summary.slice(0, 255),
      source: currentAuditSource(),
      undo_batch: currentUndoBatch(),
      entity_id: entityId ?? null,
    })
    .catch(() => {});
}

const GIVEN = new Set(['given', 'self_administered']);

interface MedicationEntry {
  medication_name: string;
  status: (typeof MEDICATION_STATUSES)[number];
  dose_given?: string | null;
  notes?: string | null;
  administered_at?: string | null;
}

/**
 * Record one medication administration: look the medication up on the
 * profile's active list, insert the MAR row, draw down the supply and audit.
 * Shared by the singular and batch actions.
 */
const normDose = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function recordOneMedication(
  entry: MedicationEntry,
  profileId: string,
  account: Account,
  timeZone: string | null | undefined,
  // Medication rows already recorded this turn, so several doses of a drug
  // that exists at more than one strength land on the different strengths
  // instead of piling onto the first one.
  usedMedIds?: Set<string>
): Promise<string> {
  const matches = await db('medications as m')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .where({ 'm.care_profile_id': profileId, 'm.active': true })
    .whereRaw('lower(c.name) = lower(?)', [entry.medication_name.trim()])
    .select('m.*', 'c.name as name', 'c.form as form')
    .orderBy([{ column: 'm.created_at', order: 'asc' }, { column: 'm.id', order: 'asc' }]);
  if (matches.length === 0) {
    return `Could not record the dose: no active medication called "${entry.medication_name}" is on the list.`;
  }
  // The same drug can be listed at two strengths (e.g. Escitalopram 20mg and
  // 10mg). Prefer a row whose dose matches what was said; otherwise take the
  // next one not already used this turn, so "record all" hits each strength.
  let med = matches[0];
  if (matches.length > 1) {
    const want = normDose(entry.dose_given);
    const byDose = want
      ? matches.filter((m) => {
          const sig = normDose(m.dose) || normDose(`${m.dose_amount ?? ''}${m.dose_unit ?? ''}`);
          return sig && (sig === want || sig.includes(want) || want.includes(sig));
        })
      : [];
    const pool = byDose.length > 0 ? byDose : matches;
    med = pool.find((m) => !usedMedIds?.has(m.id)) ?? pool[0];
  }
  usedMedIds?.add(med.id);
  if (!GIVEN.has(entry.status) && !entry.notes?.trim()) {
    return `Could not record the ${entry.status} dose of ${med.name}: a note explaining why is required.`;
  }
  const administeredAt = parseWhen(entry.administered_at, timeZone);
  const [doseRow] = await db('medication_administrations').insert({
    medication_id: med.id,
    care_profile_id: profileId,
    administered_at: administeredAt,
    administered_by_account_id: account.id,
    administered_by_name: account.display_name,
    status: entry.status,
    dose_given: entry.dose_given ?? med.dose ?? null,
    route_given: med.route ?? null,
    notes: [entry.notes?.trim(), 'Recorded through the PareCare assistant.'].filter(Boolean).join(' '),
    right_patient: true,
    right_medication: true,
    right_documentation: true,
    // Dose, route and time must be verified by a person at the point of
    // care; a conversational log cannot confirm them.
    right_dose: false,
    right_route: false,
    right_time: false,
  }).returning('id');
  if (GIVEN.has(entry.status)) {
    // Draw supply down by units taken each time; the dose volume only counts
    // for measured, liquid-style forms. Shared with the REST record path.
    await drawDownOnHand(med.id, perDoseDrawdown(med));
  }
  await audit(profileId, account.id, DOSE_AUDIT_ENTITY, doseSummary(med.name, entry.status), (doseRow as { id: string } | undefined)?.id ?? null);
  const at = formatInZone(administeredAt, timeZone);
  return `Recorded ${med.name}${entry.dose_given ?? med.dose ? ` ${entry.dose_given ?? med.dose}` : ''} as ${entry.status.replace(/_/g, ' ')} at ${at}.`;
}

/**
 * Find the appointment a spoken title refers to: an exact title first, then a
 * partial match, preferring the next one still to come so "move my
 * physio appointment" lands on the upcoming one rather than last month's.
 */
/**
 * The appointment an outcome belongs to: one that has already started, found
 * by title (exact first, then partial), most recent first. Never a guess:
 * with no title there is no match, so a letter is never filed against
 * whatever visit happened to be last.
 */
async function findPastAppointment(
  title: string,
  profileId: string
): Promise<{ id: string; title: string; status: string } | undefined> {
  const rows = (await db('appointments')
    .where({ care_profile_id: profileId })
    .whereNot('status', 'cancelled')
    .where('starts_at', '<=', new Date())
    .select('id', 'title', 'status')
    .orderBy('starts_at', 'desc')) as Array<{ id: string; title: string; status: string }>;
  const needle = title.trim().toLowerCase();
  if (!needle) return undefined;
  return (
    rows.find((r) => r.title.toLowerCase() === needle) ??
    rows.find((r) => r.title.toLowerCase().includes(needle) || needle.includes(r.title.toLowerCase()))
  );
}

async function findAppointmentByTitle(
  title: string,
  profileId: string
): Promise<{ id: string; title: string; starts_at: string | Date } | undefined> {
  const needle = title.trim().toLowerCase();
  const rows = await db('appointments')
    .where({ care_profile_id: profileId })
    .whereNot('status', 'cancelled')
    .select('id', 'title', 'starts_at')
    .orderBy('starts_at', 'asc');
  const upcoming = (r: { starts_at: string | Date }) => new Date(r.starts_at).getTime() >= Date.now();
  const exact = rows.filter((r) => String(r.title).toLowerCase() === needle);
  const partial = rows.filter((r) => String(r.title).toLowerCase().includes(needle));
  const pool = exact.length > 0 ? exact : partial;
  return pool.find(upcoming) ?? pool[pool.length - 1];
}

/** The open task a spoken title refers to, exact match first, then partial. */
async function findOpenTaskByTitle(
  title: string,
  profileId: string
): Promise<{ id: string; title: string } | undefined> {
  const needle = title.trim().toLowerCase();
  const rows = await db('reminders')
    .where({ care_profile_id: profileId, completed: false })
    .select('id', 'title')
    .orderBy('next_due_at', 'asc');
  return (
    rows.find((r) => String(r.title).toLowerCase() === needle) ??
    rows.find((r) => String(r.title).toLowerCase().includes(needle))
  );
}

/**
 * The open task or next step a booking is for, found by its title, who it is
 * with or its kind.
 */
async function findOpenNextStep(
  name: string,
  profileId: string
): Promise<{ id: string; title: string; provider_id: string | null } | undefined> {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  const rows = (await db('reminders as r')
    .leftJoin('next_step_types as t', 'r.next_step_type_id', 't.id')
    .leftJoin('providers as p', 'r.provider_id', 'p.id')
    .where({ 'r.care_profile_id': profileId, 'r.completed': false })
    .whereNull('r.merged_into_id')
    .orderBy('r.created_at', 'desc')
    .select('r.id', 'r.title', 'r.provider_id', 't.name as type_name', 'p.name as provider_name')) as Array<{
    id: string;
    title: string;
    provider_id: string | null;
    type_name: string | null;
    provider_name: string | null;
  }>;
  const hit =
    rows.find((r) => r.title.toLowerCase() === needle) ??
    rows.find((r) => (r.provider_name ?? '').toLowerCase() === needle) ??
    rows.find((r) => (r.type_name ?? '').toLowerCase() === needle) ??
    rows.find((r) => r.title.toLowerCase().includes(needle) || needle.includes(r.title.toLowerCase()));
  return hit ? { id: hit.id, title: hit.title, provider_id: hit.provider_id } : undefined;
}

/** A condition on this person, by what it is called. */
async function findConditionByName(name: string | null | undefined, profileId: string): Promise<{ id: string; name: string } | undefined> {
  const needle = name?.trim().toLowerCase();
  if (!needle) return undefined;
  const rows = (await db('medical_conditions').where({ care_profile_id: profileId }).select('id', 'name')) as Array<{ id: string; name: string }>;
  return rows.find((r) => r.name.toLowerCase() === needle) ?? rows.find((r) => r.name.toLowerCase().includes(needle) || needle.includes(r.name.toLowerCase()));
}

/** Documents on file, by what they are called; names that match nothing are returned too. */
async function findDocumentsByNames(names: string[] | null | undefined, profileId: string): Promise<{ ids: string[]; missing: string[] }> {
  const wanted = (names ?? []).map((n) => n.trim()).filter(Boolean);
  if (wanted.length === 0) return { ids: [], missing: [] };
  const rows = (await db('documents').where({ care_profile_id: profileId }).orderBy('created_at', 'desc').select('id', 'label')) as Array<{ id: string; label: string }>;
  const ids: string[] = [];
  const missing: string[] = [];
  for (const w of wanted) {
    const l = w.toLowerCase();
    const hit = rows.find((r) => r.label.toLowerCase() === l) ?? rows.find((r) => r.label.toLowerCase().includes(l) || l.includes(r.label.toLowerCase()));
    if (hit) ids.push(hit.id);
    else missing.push(w);
  }
  return { ids: [...new Set(ids)], missing };
}

/** "With" a person by name: someone in Contacts, or a new name to file, with their phone. */
/**
 * Who a record is with, named by Pare: found in Contacts or filed there,
 * linked to the person. Returns the contact id, or a sentence on why not.
 */
async function namedContact(profileId: string, name: string | null | undefined, type: string | null | undefined, defaultType: string): Promise<{ id: string | null; note: string }> {
  if (!name?.trim()) return { id: null, note: '' };
  const who = await resolveContactInput(db, profileId, { name, type }, defaultType);
  if ('error' in who) return { id: null, note: ` ${who.error}` };
  return { id: who.id, note: who.filed ? ` Added ${who.filed.name} to Contacts.` : '' };
}

/** The visit a medicine started at, by title: the latest one with that title. */
async function appointmentByTitle(profileId: string, title: string | null | undefined): Promise<string | null> {
  if (!title?.trim()) return null;
  const row = (await db('appointments')
    .where({ care_profile_id: profileId })
    .whereRaw('lower(title) = lower(?)', [title.trim()])
    .orderByRaw('starts_at DESC NULLS LAST')
    .first('id')) ?? (await db('appointments')
    .where({ care_profile_id: profileId })
    .whereRaw('title ilike ?', [`%${title.trim()}%`])
    .orderByRaw('starts_at DESC NULLS LAST')
    .first('id'));
  return (row as { id: string } | undefined)?.id ?? null;
}

/** Contact details Pare can set beyond the basics: after hours, fax, hours. */
function extraContactColumns(a: { after_hours_phone?: string | null; fax?: string | null; opening_hours?: unknown }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (a.after_hours_phone !== undefined) out['after_hours_phone'] = a.after_hours_phone?.trim() || null;
  if (a.fax !== undefined) out['fax'] = a.fax?.trim() || null;
  if (a.opening_hours !== undefined) out['opening_hours'] = parseHoursList(a.opening_hours);
  return out;
}

function withFields(a: { with?: string | null; with_type?: string | null; with_phone?: string | null; body?: string | null }): Pick<TaskInput, 'provider_name' | 'provider_type' | 'provider_phone'> {
  if (!a.with?.trim()) return {};
  // A number given only in the notes still goes on their record.
  let phone = a.with_phone?.trim() || null;
  if (!phone && a.body) {
    const phones = findPhones(a.body);
    if (phones.length === 1) phone = phones[0]!.text;
  }
  return { provider_name: a.with.trim(), provider_type: a.with_type?.trim() || null, provider_phone: phone };
}

/** The task form's fields from what Pare was asked. */
async function taskInputFrom(
  a: z.infer<typeof addTaskSchema> | Omit<z.infer<typeof addTaskSchema>, 'type'>,
  profileId: string,
  account: Account,
  timeZone: string | null | undefined
): Promise<{ input?: TaskInput; problem?: string; notes: string[] }> {
  const notes: string[] = [];
  const dueText = a.due_at.trim();
  let due: Pick<TaskInput, 'next_due_at' | 'due_on'>;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dueText)) due = { due_on: dueText };
  else {
    const at = parseZonedTime(dueText, timeZone);
    if (!at) return { problem: `Could not add the task "${a.title}": the due time was unclear.`, notes };
    due = { next_due_at: at.toISOString() };
  }
  const condition = await findConditionByName(a.for_condition, profileId);
  if (a.for_condition && !condition) notes.push(`No condition called "${a.for_condition}" is on file, so it is not tied to one.`);
  let assign: Pick<TaskInput, 'assigned_to' | 'assigned_account_id'> = {};
  if (a.assign_to?.trim()) {
    const person = await findPickablePerson(profileId, account.id, a.assign_to);
    if (person) assign = 'account_id' in person.ref ? { assigned_account_id: person.ref.account_id } : { assigned_to: person.ref.circle_member_id };
    else notes.push(`${a.assign_to} is not in the care circle, so the task is for anyone.`);
  }
  const docs = await findDocumentsByNames(a.documents, profileId);
  if (docs.missing.length) notes.push(`No document called ${docs.missing.map((m) => `"${m}"`).join(' or ')} is on file.`);
  return {
    input: {
      title: a.title,
      body: a.body ?? null,
      ...due,
      tz: timeZone ?? null,
      repeat: a.repeat,
      ...withFields(a),
      kind: a.kind?.trim() || null,
      medical_condition_id: condition?.id ?? null,
      ...assign,
      document_ids: docs.ids,
    },
    notes,
  };
}

/** Who is going, by name or "me", with the driver among them. */
async function attendeesFrom(
  going: string[] | null | undefined,
  driver: string | null | undefined,
  profileId: string,
  account: Account
): Promise<{ attendees?: AppointmentInput['attendees']; missing: string[] }> {
  const names = [...(going ?? []), ...(driver && !(going ?? []).some((g) => g.trim().toLowerCase() === driver.trim().toLowerCase()) ? [driver] : [])];
  if (names.length === 0) return { missing: [] };
  const missing: string[] = [];
  const driverPerson = driver ? await findPickablePerson(profileId, account.id, driver) : undefined;
  const out: NonNullable<AppointmentInput['attendees']> = [];
  for (const n of names) {
    const p = await findPickablePerson(profileId, account.id, n);
    if (!p) {
      missing.push(n);
      continue;
    }
    const isDriver = !!driverPerson && JSON.stringify(driverPerson.ref) === JSON.stringify(p.ref);
    out.push('account_id' in p.ref ? { account_id: p.ref.account_id, circle_member_id: null, is_driver: isDriver } : { circle_member_id: p.ref.circle_member_id, account_id: null, is_driver: isDriver });
  }
  return { attendees: out, missing };
}

/** The new booking fields shared by book_appointment and update_appointment. */
async function appointmentExtrasInput(
  a: z.infer<typeof bookAppointmentSchema> | z.infer<typeof updateAppointmentSchema>,
  profileId: string,
  account: Account
): Promise<{ input: Partial<AppointmentInput>; notes: string[] }> {
  const notes: string[] = [];
  const input: Partial<AppointmentInput> = {};
  if (a.for_condition !== undefined && a.for_condition !== null) {
    const c = await findConditionByName(a.for_condition, profileId);
    if (c) input.medical_condition_id = c.id;
    else notes.push(`No condition called "${a.for_condition}" is on file, so it is not tied to one.`);
  }
  if (a.repeat) input.repeat = a.repeat;
  if (a.repeat_until !== undefined) input.repeat_until = a.repeat_until;
  if (a.telehealth_link !== undefined) input.telehealth_link = a.telehealth_link;
  if (a.interpreter_language !== undefined) {
    input.interpreter_language = a.interpreter_language;
    input.interpreter_needed = !!a.interpreter_language?.trim();
  }
  if (a.preparation !== undefined) input.preparation = a.preparation;
  if (a.going || a.driver) {
    const people = await attendeesFrom(a.going, a.driver, profileId, account);
    if (people.attendees) input.attendees = people.attendees;
    if (people.missing.length) notes.push(`${people.missing.join(' and ')} ${people.missing.length === 1 ? 'is' : 'are'} not in the care circle, so I left them off who is going.`);
  }
  if (a.documents_to_bring) {
    const docs = await findDocumentsByNames(a.documents_to_bring, profileId);
    input.bring_document_ids = docs.ids;
    if (docs.missing.length) notes.push(`No document called ${docs.missing.map((m) => `"${m}"`).join(' or ')} is on file to bring.`);
  }
  return { input, notes };
}

/** Midnight that day where they live, for something with no set time. */
function dayStart(text: string, timeZone: string | null | undefined): Date | null {
  const day = text.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  // With no zone known, midnight UTC, never the server's own clock.
  return (isValidTimeZone(timeZone) ? parseZonedTime(`${day}T00:00:00`, timeZone) : null) ?? new Date(`${day}T00:00:00Z`);
}

async function executeOne(
  action: AssistantAction,
  profileId: string,
  account: Account,
  access: CareAccess,
  timeZone: string | null | undefined,
  // Shared across a turn so repeated doses of a multi-strength drug spread
  // across its rows rather than all landing on the first.
  usedMedIds?: Set<string>
): Promise<string | string[]> {
  switch (action.type) {
    case 'log_event': {
      const occurredAt = parseWhen(action.occurred_at, timeZone);
      const [logRow] = await db('care_log_entries')
        .insert({
          care_profile_id: profileId,
          author_member_id: access.member?.id ?? null,
          entry_type: action.entry_type,
          title: action.title ?? null,
          body: action.body,
          occurred_at: occurredAt,
        })
        .returning('id');
      await audit(profileId, account.id, 'log', action.title ?? action.body, logRow?.id);
      return `Logged a ${action.entry_type.replace(/_/g, ' ')} entry${action.title ? `: ${action.title}` : ''} at ${formatInZone(occurredAt, timeZone)}.`;
    }
    case 'record_medication': {
      return recordOneMedication(action, profileId, account, timeZone, usedMedIds ?? new Set());
    }
    case 'record_medications': {
      // One dose failing to record must not stop the rest of the batch. A
      // shared set spreads repeated doses of a multi-strength drug across its
      // rows within this batch.
      const used = usedMedIds ?? new Set<string>();
      const results: string[] = [];
      for (const entry of action.entries) {
        try {
          results.push(await recordOneMedication(entry, profileId, account, timeZone, used));
        } catch (err) {
          console.warn('Assistant batch medication entry failed:', (err as Error).message);
          results.push(`Could not record ${entry.medication_name}. Please record it directly in the app.`);
        }
      }
      return results;
    }
    case 'add_task': {
      const built = await taskInputFrom(action, profileId, account, timeZone);
      if (!built.input) return built.problem!;
      let result;
      try {
        result = await db.transaction((trx) => createTask(trx, { profileId, actorId: account.id, source: 'pare', input: built.input!, timeZone }));
      } catch (err) {
        if (err instanceof TaskProblem) return `Could not add the task "${action.title}": ${err.message}`;
        throw err;
      }
      const extra = [
        ...result.filed.map((f) => `Added ${f.name} to Contacts.`),
        ...built.notes,
      ].join(' ');
      if (result.joined_into) {
        await audit(profileId, account.id, 'reminders', `updated ${result.joined_into.title}`, result.joined_into.id);
        return `"${result.joined_into.title}" was already on the list for this booking, so I added these details to it rather than making a second task.${extra ? ` ${extra}` : ''}`;
      }
      await audit(profileId, account.id, 'reminders', action.title, result.reminder.id);
      const due = new Date(result.reminder['next_due_at'] as string);
      const when = result.reminder['all_day'] ? `on ${dateInZone(due, timeZone)}, any time that day` : formatInZone(due, timeZone);
      return `Added the task "${action.title}" due ${when}.${extra ? ` ${extra}` : ''}`;
    }
    case 'add_medication': {
      const name = action.medication_name.trim();
      let cat = await db('medication_catalogue').whereRaw('lower(name) = lower(?)', [name]).first();
      if (!cat) {
        [cat] = await db('medication_catalogue')
          .insert({ name, form: action.form ?? null, created_by_account_id: account.id })
          .returning('*');
      }
      // Link a named supplier to the account's shared supplier list, creating
      // one where the name is new, so the assistant tracks the same model.
      const supplierId = await resolveSupplierId(action.supplier, action.supplier_order_url, account.id);
      const prescriber = await namedContact(profileId, action.prescriber, action.prescriber_type, 'gp');
      const sourceAppt = await appointmentByTitle(profileId, action.started_at_appointment);
      await db('medications').insert({
        care_profile_id: profileId,
        medication_catalogue_id: cat.id,
        prescriber_provider_id: prescriber.id,
        source_appointment_id: sourceAppt,
        dose: action.dose ?? null,
        route: action.route ?? null,
        frequency: action.frequency ?? null,
        schedule_times: action.schedule_times ? JSON.stringify(action.schedule_times) : null,
        instructions: action.instructions ?? null,
        units_per_dose: action.units_per_dose ?? null,
        supply: action.supply ?? null,
        supply_remaining: action.supply ?? null,
        packs_on_hand: action.packs_on_hand ?? null,
        supplier_id: supplierId,
        supplier: action.supplier ?? null,
        supplier_order_url: action.supplier_order_url ?? null,
        with_food: action.with_food ?? false,
        as_needed: action.as_needed ?? false,
        critical: action.critical ?? false,
        active: true,
      });
      await audit(profileId, account.id, 'medications', `added ${name}`);
      return `Added ${name}${action.dose ? ` ${action.dose}` : ''} to the medication list.${prescriber.note}`;
    }
    case 'update_medication': {
      const med = await db('medications as m')
        .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
        .where({ 'm.care_profile_id': profileId, 'm.active': true })
        .whereRaw('lower(c.name) = lower(?)', [action.medication_name.trim()])
        .select('m.*', 'c.name as name')
        .first();
      if (!med) return `Could not find an active medication called "${action.medication_name}".`;
      const patch: Record<string, unknown> = { updated_at: db.fn.now() };
      if (action.dose !== undefined) patch['dose'] = action.dose;
      if (action.route !== undefined) patch['route'] = action.route;
      if (action.frequency !== undefined) patch['frequency'] = action.frequency;
      if (action.schedule_times !== undefined)
        patch['schedule_times'] = action.schedule_times ? JSON.stringify(action.schedule_times) : null;
      if (action.instructions !== undefined) patch['instructions'] = action.instructions;
      if (action.units_per_dose !== undefined) patch['units_per_dose'] = action.units_per_dose;
      if (action.supply !== undefined) {
        patch['supply'] = action.supply;
        if (action.supply_remaining === undefined) patch['supply_remaining'] = action.supply;
      }
      if (action.supply_remaining !== undefined) patch['supply_remaining'] = action.supply_remaining;
      if (action.packs_on_hand !== undefined) patch['packs_on_hand'] = action.packs_on_hand;
      if (action.supplier !== undefined) {
        patch['supplier'] = action.supplier;
        // Re-point the medication at the account's shared supplier list.
        patch['supplier_id'] = await resolveSupplierId(action.supplier, action.supplier_order_url, account.id);
      }
      if (action.supplier_order_url !== undefined) patch['supplier_order_url'] = action.supplier_order_url;
      if (action.with_food !== undefined) patch['with_food'] = action.with_food;
      if (action.as_needed !== undefined) patch['as_needed'] = action.as_needed;
      if (action.critical !== undefined) patch['critical'] = action.critical;
      let filed = '';
      if (action.prescriber !== undefined) {
        const who = await namedContact(profileId, action.prescriber, action.prescriber_type, 'gp');
        patch['prescriber_provider_id'] = who.id;
        filed = who.note;
      }
      if (action.started_at_appointment !== undefined) patch['source_appointment_id'] = await appointmentByTitle(profileId, action.started_at_appointment);
      await db('medications').where({ id: med.id }).update(patch);
      await audit(profileId, account.id, 'medications', `updated ${med.name}`);
      const when = action.schedule_times ? ` Scheduled at ${action.schedule_times.join(', ')}.` : '';
      return `Updated ${med.name}.${when}${filed}`;
    }
    case 'stop_medication': {
      const med = await db('medications as m')
        .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
        .where({ 'm.care_profile_id': profileId, 'm.active': true })
        .whereRaw('lower(c.name) = lower(?)', [action.medication_name.trim()])
        .select('m.id', 'c.name as name')
        .first();
      if (!med) return `Could not find an active medication called "${action.medication_name}".`;
      await db('medications').where({ id: med.id }).update({ active: false, updated_at: db.fn.now() });
      await audit(profileId, account.id, 'medications', `stopped ${med.name}`);
      return `Stopped ${med.name}. It is no longer on the active medication list.`;
    }
    case 'restock_medication': {
      if (action.packs_on_hand == null && action.units_remaining == null) {
        return `Could not restock ${action.medication_name}: say how many packs or units are now on hand.`;
      }
      const med = await db('medications as m')
        .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
        .where({ 'm.care_profile_id': profileId, 'm.active': true })
        .whereRaw('lower(c.name) = lower(?)', [action.medication_name.trim()])
        .select('m.id', 'm.supply', 'c.name as name')
        .first();
      if (!med) return `Could not find an active medication called "${action.medication_name}".`;
      const patch: Record<string, unknown> = { updated_at: db.fn.now() };
      if (action.packs_on_hand != null) patch['packs_on_hand'] = action.packs_on_hand;
      if (action.units_remaining != null) patch['supply_remaining'] = action.units_remaining;
      // Restocking packs alone, with nothing loose recorded, starts the count
      // from zero loose units so the total reads exactly what was picked up.
      await db('medications').where({ id: med.id }).update(patch);
      // A restock clears any "out of stock" acknowledgement, same as the app.
      await db('attention_dismissals').where({ item_key: `out_of_stock:${med.id}` }).delete();
      await audit(profileId, account.id, 'medications', `restocked ${med.name}`);
      const parts = [
        action.packs_on_hand != null ? `${action.packs_on_hand} ${action.packs_on_hand === 1 ? 'pack' : 'packs'}` : null,
        action.units_remaining != null ? `${action.units_remaining} units in the open pack` : null,
      ].filter(Boolean);
      return `Updated ${med.name}'s supply: ${parts.join(' and ')} on hand.`;
    }
    case 'add_allergy': {
      const [allergyRow] = await db('allergies')
        .insert({
          care_profile_id: profileId,
          substance: action.substance.trim(),
          reaction: action.reaction ?? null,
        })
        .returning('id');
      await audit(profileId, account.id, 'allergies', `added allergy ${action.substance}`, allergyRow?.id);
      return `Recorded an allergy to ${action.substance}${action.reaction ? ` (${action.reaction})` : ''}.`;
    }
    case 'remove_allergy': {
      const n = await db('allergies')
        .where({ care_profile_id: profileId })
        .whereRaw('lower(substance) = lower(?)', [action.substance.trim()])
        .del();
      if (!n) return `No allergy to "${action.substance}" was on the record.`;
      await audit(profileId, account.id, 'allergies', `removed allergy ${action.substance}`);
      return `Removed the allergy to ${action.substance}.`;
    }
    case 'add_condition': {
      const name = action.name.trim();
      // The shared catalogue keeps one entry per condition across the
      // instance, same as adding it by hand.
      const catalogueId = await resolveConditionCatalogueId(name, account.id).catch(() => null);
      const treating = await namedContact(profileId, action.treated_by, action.treated_by_type, 'specialist');
      const [conditionRow] = await db('medical_conditions')
        .insert({
          care_profile_id: profileId,
          condition_catalogue_id: catalogueId,
          treating_provider_id: treating.id,
          name,
          category: action.category ?? null,
          severity: action.severity ?? null,
          status: action.status ?? 'active',
          started_on: action.started_on ?? null,
          notes: action.notes ?? null,
        })
        .returning('id');
      await audit(profileId, account.id, 'conditions', `added condition ${name}`, conditionRow?.id);
      return `Added the condition ${name}${action.category ? ` (${action.category.replace(/_/g, ' ')})` : ''}.${treating.note}`;
    }
    case 'update_condition': {
      const condition = await db('medical_conditions')
        .where({ care_profile_id: profileId })
        .whereRaw('lower(name) = lower(?)', [action.name.trim()])
        .first('id', 'name');
      if (!condition) return `${CLARIFY_MARK} I could not find a condition called "${action.name}". Which one did you mean?`;
      const patch: Record<string, unknown> = {};
      let filed = '';
      if (action.treated_by !== undefined) {
        const who = await namedContact(profileId, action.treated_by, action.treated_by_type, 'specialist');
        patch['treating_provider_id'] = who.id;
        filed = who.note;
      }
      if (action.severity !== undefined) patch['severity'] = action.severity;
      if (action.status !== undefined && action.status) patch['status'] = action.status;
      if (action.notes !== undefined) patch['notes'] = action.notes;
      if (Object.keys(patch).length === 0) return `Nothing to change for ${condition.name}.`;
      await db('medical_conditions').where({ id: condition.id }).update({ ...patch, updated_at: db.fn.now() });
      await audit(profileId, account.id, 'conditions', `updated ${condition.name}`, condition.id);
      return `Updated ${condition.name}.${filed}`;
    }
    case 'remove_condition': {
      const n = await db('medical_conditions')
        .where({ care_profile_id: profileId })
        .whereRaw('lower(name) = lower(?)', [action.name.trim()])
        .del();
      if (!n) return `No condition called "${action.name}" was on the record.`;
      await audit(profileId, account.id, 'conditions', `removed condition ${action.name}`);
      return `Removed the condition ${action.name}.`;
    }
    case 'log_condition': {
      const condition = await db('medical_conditions')
        .where({ care_profile_id: profileId })
        .whereRaw('lower(name) = lower(?)', [action.condition.trim()])
        .first();
      if (!condition) return `No condition called "${action.condition}" was on the record.`;
      await db('condition_log_entries').insert({
        medical_condition_id: condition.id,
        author_account_id: account.id,
        entry_type: action.entry_type ?? 'note',
        title: action.title ?? null,
        body: action.body,
        ...(action.occurred_at ? { occurred_at: new Date(action.occurred_at).toISOString() } : {}),
      });
      await audit(profileId, account.id, 'conditions', `logged against ${condition.name}`);
      return `Added that to the tracking log for ${condition.name}.`;
    }
    case 'resolve_condition': {
      // Only what was said is written; a missing date or reason stays empty
      // rather than overwriting one already recorded.
      const [row] = await db('medical_conditions')
        .where({ care_profile_id: profileId })
        .whereRaw('lower(name) = lower(?)', [action.name.trim()])
        .update({
          status: 'resolved',
          ...(action.resolved_on ? { resolved_on: action.resolved_on } : {}),
          ...(action.resolution_reason ? { resolution_reason: action.resolution_reason } : {}),
          ...(action.resolution_notes ? { resolution_notes: action.resolution_notes } : {}),
          updated_at: db.fn.now(),
        })
        .returning('name');
      if (!row) return `No condition called "${action.name}" was on the record.`;
      await audit(profileId, account.id, 'conditions', `resolved ${action.name}`);
      return action.resolved_on ? `Marked ${row.name} as resolved on ${action.resolved_on}.` : `Marked ${row.name} as resolved.`;
    }
    case 'add_substance': {
      const name = action.substance.trim();
      const catalogueId = await resolveSubstanceCatalogueId(name, action.substance_class, account.id).catch(() => null);
      if (!catalogueId) return `Could not record ${name}.`;
      try {
        await db('substance_use').insert({
          care_profile_id: profileId,
          substance_catalogue_id: catalogueId,
          status: action.status ?? 'active',
          route: action.route ?? null,
          quantity: action.quantity ?? null,
          quantity_unit: action.quantity_unit ?? null,
          frequency: action.frequency ?? null,
          started_on: action.started_on ?? null,
          quit_on: action.quit_on ?? null,
          notes: action.notes ?? null,
        });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') return `${name} is already recorded for this person. Use update_substance to change it.`;
        throw err;
      }
      await audit(profileId, account.id, 'substance_use', `added substance ${name}`);
      return `Recorded ${name} under substance use.`;
    }
    case 'update_substance': {
      const record = await db('substance_use as su')
        .join('substance_catalogue as sc', 'su.substance_catalogue_id', 'sc.id')
        .where('su.care_profile_id', profileId)
        .whereRaw('lower(sc.name) = lower(?)', [action.substance.trim()])
        .select('su.id', 'sc.name as name')
        .first();
      if (!record) return `No substance called "${action.substance}" is recorded for this person.`;
      const updates: Record<string, unknown> = {};
      if (action.status !== undefined) updates['status'] = action.status;
      if (action.route !== undefined) updates['route'] = action.route;
      if (action.quantity !== undefined) updates['quantity'] = action.quantity;
      if (action.quantity_unit !== undefined) updates['quantity_unit'] = action.quantity_unit;
      if (action.frequency !== undefined) updates['frequency'] = action.frequency;
      if (action.quit_on !== undefined) updates['quit_on'] = action.quit_on;
      if (action.notes !== undefined) updates['notes'] = action.notes;
      if (Object.keys(updates).length === 0) return `No changes to make to ${record.name}.`;
      await db('substance_use').where({ id: record.id }).update({ ...updates, updated_at: db.fn.now() });
      await audit(profileId, account.id, 'substance_use', `updated substance ${record.name}`);
      return `Updated ${record.name}.`;
    }
    case 'remove_substance': {
      const record = await db('substance_use as su')
        .join('substance_catalogue as sc', 'su.substance_catalogue_id', 'sc.id')
        .where('su.care_profile_id', profileId)
        .whereRaw('lower(sc.name) = lower(?)', [action.substance.trim()])
        .select('su.id', 'sc.name as name')
        .first();
      if (!record) return `No substance called "${action.substance}" is recorded for this person.`;
      await db('substance_use').where({ id: record.id }).del();
      await audit(profileId, account.id, 'substance_use', `removed substance ${record.name}`);
      return `Removed ${record.name} from substance use.`;
    }
    case 'add_neurotype_attribute': {
      const condition = await db('medical_conditions')
        .where({ care_profile_id: profileId, category: 'neurotype' })
        .whereRaw('lower(name) = lower(?)', [action.neurotype_name.trim()])
        .first();
      if (!condition) return `No neurotype called "${action.neurotype_name}" is on the record, so the ${action.kind} was not added.`;
      const catalogueId = await resolveNeurotypeAttributeCatalogueId(action.kind, action.label.trim(), {
        neurotype: condition.neurotype ?? null,
        accountId: account.id,
      }).catch(() => null);
      if (!catalogueId) return `Could not record that ${action.kind}.`;
      try {
        await db('neurotype_attributes').insert({
          condition_id: condition.id,
          catalogue_id: catalogueId,
          notes: action.notes ?? null,
        });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') return `"${action.label}" is already recorded as a ${action.kind} for ${condition.name}.`;
        throw err;
      }
      await audit(profileId, account.id, 'conditions', `added ${action.kind} "${action.label}" to ${condition.name}`);
      return `Recorded "${action.label}" as a ${action.kind} for ${condition.name}.`;
    }
    case 'remove_neurotype_attribute': {
      const record = await db('neurotype_attributes as na')
        .join('neurotype_attribute_catalogue as nac', 'na.catalogue_id', 'nac.id')
        .join('medical_conditions as mc', 'mc.id', 'na.condition_id')
        .where('mc.care_profile_id', profileId)
        .where('nac.kind', action.kind)
        .whereRaw('lower(mc.name) = lower(?)', [action.neurotype_name.trim()])
        .whereRaw('lower(nac.label) = lower(?)', [action.label.trim()])
        .select('na.id', 'nac.label as label', 'mc.name as condition_name')
        .first();
      if (!record) return `No ${action.kind} called "${action.label}" is recorded for ${action.neurotype_name}.`;
      await db('neurotype_attributes').where({ id: record.id }).del();
      await audit(profileId, account.id, 'conditions', `removed ${action.kind} "${record.label}" from ${record.condition_name}`);
      return `Removed "${record.label}" from ${record.condition_name}.`;
    }
    case 'add_symptom': {
      const condition = await db('medical_conditions')
        .where({ care_profile_id: profileId })
        .whereRaw('lower(name) = lower(?)', [action.condition_name.trim()])
        .first();
      if (!condition) return `No condition called "${action.condition_name}" was on the record, so the symptom was not added.`;
      const catalogueId = await resolveSymptomCatalogueId(action.symptom_name.trim(), account.id).catch(() => null);
      const [symptom] = await db('condition_symptoms')
        .insert({
          condition_id: condition.id,
          symptom_catalogue_id: catalogueId,
          name: action.symptom_name.trim(),
          severity: action.severity,
        })
        .returning('*');
      await db('condition_symptom_readings').insert({
        symptom_id: symptom.id,
        severity: symptom.severity,
        recorded_at: symptom.noted_at,
      });
      await audit(profileId, account.id, 'conditions', `symptom ${action.symptom_name} on ${condition.name}`);
      return `Recorded the symptom ${action.symptom_name} (severity ${action.severity}/10) on ${condition.name}.`;
    }
    case 'update_symptom': {
      let query = db('condition_symptoms as s')
        .join('medical_conditions as mc', 's.condition_id', 'mc.id')
        .where('mc.care_profile_id', profileId)
        .whereRaw('lower(s.name) = lower(?)', [action.symptom_name.trim()])
        .whereNull('s.resolved_at');
      if (action.condition_name) {
        query = query.whereRaw('lower(mc.name) = lower(?)', [action.condition_name.trim()]);
      }
      const matches = await query.select('s.*', 'mc.name as condition_name');
      if (matches.length === 0) {
        return `No open symptom called "${action.symptom_name}" was found${action.condition_name ? ` on ${action.condition_name}` : ''}.`;
      }
      if (matches.length > 1) {
        return `"${action.symptom_name}" is tracked on more than one condition (${matches.map((m) => m.condition_name).join(', ')}). Say which condition you mean.`;
      }
      const symptom = matches[0];
      const patch: Record<string, unknown> = { updated_at: db.fn.now() };
      const said: string[] = [];
      if (action.severity != null && action.severity !== symptom.severity) {
        patch['severity'] = action.severity;
        // Every severity change is a dated reading in the symptom's course.
        await db('condition_symptom_readings').insert({ symptom_id: symptom.id, severity: action.severity });
        said.push(`severity ${symptom.severity} to ${action.severity}`);
      }
      if (action.resolved) {
        patch['resolved_at'] = db.fn.now();
        said.push('marked resolved');
      }
      if (said.length === 0) return `Nothing to change on the symptom ${symptom.name}.`;
      await db('condition_symptoms').where({ id: symptom.id }).update(patch);
      await audit(profileId, account.id, 'conditions', `symptom ${symptom.name} updated`);
      return `Updated ${symptom.name} on ${symptom.condition_name}: ${said.join(', ')}.`;
    }
    case 'add_treatment': {
      let conditionId: string | null = null;
      if (action.condition_name) {
        const condition = await db('medical_conditions')
          .where({ care_profile_id: profileId })
          .whereRaw('lower(name) = lower(?)', [action.condition_name.trim()])
          .first();
        if (!condition) return `No condition called "${action.condition_name}" was on the record, so the treatment was not added.`;
        conditionId = condition.id;
      }
      const practitioner = await namedContact(profileId, action.provided_by, action.provided_by_type, 'allied_health');
      const [treatmentRow] = await db('treatments')
        .insert({
          care_profile_id: profileId,
          medical_condition_id: conditionId,
          practitioner_provider_id: practitioner.id,
          name: action.name.trim(),
          category: action.category,
          current_status: 'active',
        })
        .returning('id');
      await audit(profileId, account.id, 'treatments', `added treatment ${action.name}`, treatmentRow?.id);
      return `Added the treatment ${action.name}${action.condition_name ? ` for ${action.condition_name}` : ''}.${practitioner.note}`;
    }
    case 'raise_question': {
      const [questionRow] = await db('open_questions')
        .insert({
          care_profile_id: profileId,
          title: action.title.trim(),
          body: action.body ?? null,
          status: 'open',
        })
        .returning('id');
      await audit(profileId, account.id, 'questions', `raised ${action.title}`, questionRow?.id);
      return `Raised the question "${action.title}" for the care circle.`;
    }
    case 'set_care_phase': {
      await db('care_profiles').where({ id: profileId }).update({ current_phase: action.phase, updated_at: db.fn.now() });
      await audit(profileId, account.id, 'care_profiles', `phase set to ${action.phase}`);
      return `Set the care phase to ${action.phase.replace(/_/g, ' ')}.`;
    }
    case 'add_provider': {
      const { columns, note } = await providerWriteColumns(account.id, {
        ...(action.kind ? { kind: action.kind } : {}),
        provider_type: action.provider_type,
        name: action.name.trim(),
        phone: action.phone ?? null,
        email: action.email ?? null,
        booking_link: action.booking_link ?? null,
        directions_link: action.directions_link ?? null,
        ...extraContactColumns(action),
        ...(action.organisation?.trim() ? { organisation: action.organisation.trim() } : {}),
      });
      const [provider] = await db('providers')
        .insert({ account_id: account.id, ...columns })
        .returning('id');
      await db('care_profile_providers').insert({
        care_profile_id: profileId,
        provider_id: provider.id,
      });
      await linkContactToSuppliers(db, provider.id);
      const standing =
        action.main || action.no_longer_seeing
          ? await setContactStanding(db, profileId, provider.id, {
              ...(action.main ? { is_main: true } : {}),
              ...(action.no_longer_seeing ? { ended_on: new Date().toISOString().slice(0, 10) } : {}),
            })
          : null;
      await audit(profileId, account.id, 'providers', `added provider ${action.name}`);
      const at = columns['organisation'] ? ` at ${columns['organisation']}` : '';
      const filedAs = columns['kind'] === 'organisation' ? 'organisations' : 'professionals';
      return `Added ${action.name}${at} to their ${filedAs}.${note ? ` ${note}` : ''}${standing ? ` ${standing}` : ''}`;
    }
    case 'add_to_practice': {
      const profile = await db('care_profiles').where({ id: profileId }).select('account_id').first();
      const { outcome } = await addPracticeMember(profile?.account_id ?? account.id, action.practitioner, action.practice, {
        part_of: action.part_of,
        provider_type: action.provider_type,
        phone: action.phone,
        email: action.email,
      });
      await audit(profileId, account.id, 'providers', `filed ${action.practitioner} at ${action.practice}`);
      return outcome;
    }
    case 'file_document': {
      if (!action.category && !action.label) return 'Say which category to file the document under, or what to call it.';
      const docs = (await withCategory(db('documents'))
        .where('documents.care_profile_id', profileId)) as Array<{ id: string; label: string; visible_to_roles: string[] | null }>;
      const visible = docs.filter((d) => {
        const roles = Array.isArray(d.visible_to_roles) ? d.visible_to_roles : [];
        if (roles.length === 0 || access.level === 'owner' || access.level === 'admin') return true;
        return roleMaySee(roles, access.member?.role);
      });
      let doc = action.document_id ? visible.find((d) => d.id === action.document_id) : undefined;
      if (!doc && action.document) {
        const want = action.document.trim().toLowerCase();
        doc = visible.find((d) => d.label.toLowerCase() === want);
        if (!doc) {
          const near = visible.filter((d) => d.label.toLowerCase().includes(want));
          if (near.length === 1) doc = near[0];
          else if (near.length > 1) return `More than one document matches "${action.document}". Say which one by its full name.`;
        }
      }
      if (!doc) return 'That document could not be found in their documents.';
      const changes: Record<string, unknown> = {};
      let categoryName: string | null = null;
      if (action.category) {
        const accountId = (await accountIdForProfile(profileId))!;
        changes['category_id'] = await resolveCategoryByName(accountId, action.category);
        const cat = await db('document_categories').where({ id: changes['category_id'] }).select('name').first();
        categoryName = (cat as { name: string }).name;
      }
      const newLabel = action.label?.trim();
      if (newLabel) changes['label'] = newLabel.slice(0, 255);
      await db('documents').where({ id: doc.id }).update(changes);
      const shown = newLabel || doc.label;
      return categoryName ? `Filed ${shown} under ${categoryName}.` : `Renamed the document to ${shown}.`;
    }
    case 'add_asset': {
      // The supplier named is the supplier on file: found by name, or filed.
      const supplier = action.supplier?.trim() ? await resolveAssetSupplier(db, account.id, { supplier: action.supplier }) : null;
      const [asset] = await db('assets')
        .insert({
          supplier_id: supplier?.supplier_id ?? null,
          account_id: account.id,
          name: action.name.trim(),
          category: action.category ?? null,
          serial_number: action.serial_number ?? null,
          make_model: action.make_model ?? null,
          price: action.price ?? null,
          purchase_date: action.purchase_date ?? null,
          supplier: action.supplier ?? null,
          warranty_expiry: action.warranty_expiry ?? null,
          condition: action.condition ?? null,
          location: action.location ?? null,
          notes: action.notes ?? null,
          useful_life_years: action.useful_life_years ?? null,
        })
        .returning('id');
      await db('care_profile_assets').insert({ care_profile_id: profileId, asset_id: asset.id });
      await audit(profileId, account.id, 'assets', `added asset ${action.name}`);
      return `Added ${action.name} to the assets and linked it to this profile.`;
    }
    case 'update_provider': {
      const provider = await db('care_profile_providers as cpp')
        .join('providers as p', 'cpp.provider_id', 'p.id')
        .where({ 'cpp.care_profile_id': profileId })
        .where((w) => whereNamed(w as unknown as Knex.QueryBuilder, action.name.trim(), 'p'))
        .select('p.id')
        .first();
      if (!provider) return `Could not find a provider called "${action.name}" on this profile.`;
      const updates: Record<string, unknown> = {};
      if (action.kind) updates.kind = action.kind;
      if (action.provider_type) updates.provider_type = action.provider_type;
      if (action.organisation !== undefined) updates.organisation = action.organisation ?? '';
      if (action.phone !== undefined) updates.phone = action.phone;
      if (action.email !== undefined) updates.email = action.email;
      if (action.booking_link !== undefined) updates.booking_link = action.booking_link;
      if (action.directions_link !== undefined) updates.directions_link = action.directions_link;
      Object.assign(updates, extraContactColumns(action));
      const standingChange = {
        ...(action.main !== undefined ? { is_main: action.main } : {}),
        ...(action.no_longer_seeing !== undefined ? { ended_on: action.no_longer_seeing ? new Date().toISOString().slice(0, 10) : null } : {}),
      };
      if (Object.keys(updates).length === 0 && Object.keys(standingChange).length === 0) return `No changes to make to ${action.name}.`;
      let note: string | null = null;
      if (Object.keys(updates).length > 0) {
        const owner = await db('providers').where({ id: provider.id }).select('account_id').first();
        const written = await providerWriteColumns(owner?.account_id ?? account.id, updates, provider.id);
        note = written.note;
        if (Object.keys(written.columns).length > 0) await db('providers').where({ id: provider.id }).update(written.columns);
        await syncPracticeMembers(provider.id);
      }
      const standing = Object.keys(standingChange).length ? await setContactStanding(db, profileId, provider.id, standingChange) : null;
      await audit(profileId, account.id, 'providers', `updated provider ${action.name}`);
      return `Updated ${action.name}'s details.${note ? ` ${note}` : ''}${standing ? ` ${standing}` : ''}`;
    }
    case 'link_provider': {
      const profile = await db('care_profiles').where({ id: profileId }).select('account_id').first();
      if (!profile) return `Could not find this profile.`;
      const provider = await db('providers')
        .where({ account_id: profile.account_id })
        .where((w) => whereNamed(w as unknown as Knex.QueryBuilder, action.name.trim()))
        .select('id', 'name')
        .first();
      if (!provider) return `Could not find a provider called "${action.name}" in the directory. Add them first, then link.`;
      const already = await db('care_profile_providers').where({ care_profile_id: profileId, provider_id: provider.id }).first();
      if (!already) await db('care_profile_providers').insert({ care_profile_id: profileId, provider_id: provider.id });
      const standing = action.main ? await setContactStanding(db, profileId, provider.id, { is_main: true }) : null;
      if (already && !standing) return `${provider.name} is already linked to this profile.`;
      await audit(profileId, account.id, 'providers', `linked provider ${provider.name}`);
      return `${already ? '' : `Linked ${provider.name} to this profile.`}${standing ? `${already ? '' : ' '}${standing}` : ''}`;
    }
    case 'set_emergency_contact': {
      if (access.level !== 'owner' && access.level !== 'admin') {
        return 'No change: only the profile owner can choose who to call in an emergency.';
      }
      const name = action.name.trim();
      let ref: EmergencyRef | null = null;
      let shown = name;
      if (['me', 'myself', 'i', 'you'].includes(name.toLowerCase())) {
        ref = { account_id: account.id };
        shown = 'you';
      } else {
        const person = await findPickablePerson(profileId, account.id, name);
        if (person) {
          ref = person.ref as EmergencyRef;
          shown = person.name;
        } else {
          const contact = (await db('care_profile_providers as cpp')
            .join('providers as p', 'cpp.provider_id', 'p.id')
            .where({ 'cpp.care_profile_id': profileId })
            .where((w) => whereNamed(w as unknown as Knex.QueryBuilder, name, 'p'))
            .first('p.id', 'p.name')) as { id: string; name: string } | undefined;
          if (contact) {
            ref = { provider_id: contact.id };
            shown = contact.name;
          }
        }
      }
      if (action.remove) {
        if (!ref) return `${name} is not one of their emergency contacts.`;
        const list = await emergencyContactsFor(profileId);
        const refId = Object.values(ref)[0];
        const row = list.find((c) => !c.inferred && (c.id === refId || c.name.toLowerCase() === shown.toLowerCase()));
        if (!row?.row_id) return `${shown} is not one of their emergency contacts.`;
        await removeEmergencyContact(db, profileId, row.row_id);
        await audit(profileId, account.id, 'emergency_contacts', `removed ${shown} as an emergency contact`);
        return `Removed ${shown} from who to call in an emergency.`;
      }
      if (!ref) {
        if (!action.phone?.trim()) {
          return `${CLARIFY_MARK} ${name} is not in the care circle or Contacts. What is their phone number?`;
        }
        ref = { name, phone: action.phone };
      }
      try {
        await db.transaction((trx) =>
          addEmergencyContact(trx, profileId, { ref: ref!, relationship: action.relationship, phone: action.phone, first: action.first })
        );
      } catch (err) {
        if (err instanceof EmergencyContactError) return `Could not add ${shown}: ${err.message}`;
        throw err;
      }
      await audit(profileId, account.id, 'emergency_contacts', `set ${shown} as an emergency contact`);
      return `${shown === 'you' ? 'You are' : `${shown} is`} now ${action.first ? 'the first' : 'an'} emergency contact.${action.phone ? ' Their phone is saved on their own record.' : ''}`;
    }
    case 'link_address': {
      const profile = await db('care_profiles').where({ id: profileId }).select('account_id').first();
      if (!profile) return `Could not find this profile.`;
      const needle = action.address.trim().toLowerCase();
      const candidates = await db('addresses').where({ account_id: profile.account_id });
      const field = (row: Record<string, unknown>, k: string) => String(row[k] ?? '').toLowerCase();
      const match =
        candidates.find((a) => field(a, 'formatted') === needle || field(a, 'label') === needle) ??
        candidates.find(
          (a) =>
            (field(a, 'formatted') && field(a, 'formatted').includes(needle)) ||
            (field(a, 'label') && field(a, 'label').includes(needle)) ||
            (field(a, 'address_line1') && field(a, 'address_line1').includes(needle))
        );
      if (!match) return `Could not find an address matching "${action.address}" in the directory. Add it first, then link.`;
      const already = await db('care_profile_addresses').where({ care_profile_id: profileId, address_id: match.id }).first();
      await linkAddressToProfile(profileId, match.id, RESIDENCE_KIND);
      await syncProfileResidence(profileId, match);
      await audit(profileId, account.id, 'addresses', `linked address ${match.formatted ?? match.label ?? ''}`);
      const where = match.formatted ?? match.label ?? 'the address';
      return already ? `${where} is now set as where they live.` : `Linked ${where} as where they live.`;
    }
    case 'update_care_plan': {
      // updated_by references a care circle member, not an account, so use
      // the acting member when there is one (owners act without a membership).
      const fields: Record<string, unknown> = { updated_at: db.fn.now(), updated_by: access.member?.id ?? null };
      if (action.dietary_requirements !== undefined) fields['dietary_requirements'] = action.dietary_requirements ?? [];
      if (action.mobility_aids !== undefined) fields['mobility_aids'] = action.mobility_aids ?? [];
      if (action.communication_needs !== undefined) fields['communication_needs'] = JSON.stringify(action.communication_needs ?? []);
      if (action.advance_care_directive !== undefined) fields['advance_care_directive'] = action.advance_care_directive ?? false;
      if (action.advance_care_directive_location !== undefined)
        fields['advance_care_directive_location'] = action.advance_care_directive_location;
      const existing = await db('care_plans').where({ care_profile_id: profileId }).first();
      if (existing) await db('care_plans').where({ care_profile_id: profileId }).update(fields);
      else await db('care_plans').insert({ care_profile_id: profileId, ...fields });
      await audit(profileId, account.id, 'care_plans', 'updated care plan');
      return `Updated the care plan.`;
    }
    case 'update_profile': {
      const fields: Record<string, unknown> = { updated_at: db.fn.now() };
      if (action.preferred_name !== undefined) fields['preferred_name'] = action.preferred_name;
      if (action.pronouns !== undefined) fields['pronouns'] = action.pronouns;
      if (action.primary_language !== undefined) fields['primary_language'] = action.primary_language;
      if (action.notes !== undefined) fields['notes'] = action.notes;
      if (action.date_of_birth !== undefined) fields['date_of_birth'] = action.date_of_birth || null;
      let ownerNote = '';
      if (action.owner_name !== undefined) {
        const target = await db('care_profiles').where({ id: profileId }).select('account_id', 'kind').first();
        if (!action.owner_name) {
          fields['owner_profile_id'] = null;
          ownerNote = ' Cleared the owner.';
        } else {
          const owner = await db('care_profiles')
            .where({ account_id: target?.account_id, kind: 'person', archived: false })
            .whereRaw('lower(full_name) = lower(?)', [action.owner_name.trim()])
            .select('id', 'full_name')
            .first();
          if (!owner) return `Could not find a person called "${action.owner_name}" to set as the owner. Add them to People first.`;
          if (owner.id === profileId) return `A profile cannot be its own owner.`;
          fields['owner_profile_id'] = owner.id;
          ownerNote = ` Set the owner to ${owner.full_name}.`;
        }
      }
      await db('care_profiles').where({ id: profileId }).update(fields);
      await audit(profileId, account.id, 'care_profiles', 'updated profile details');
      return `Updated the profile details.${ownerNote}`;
    }
    case 'book_appointment': {
      const dateless = !action.starts_at?.trim();
      const allDay = !!action.no_set_time && !dateless;
      const startsAt = dateless ? null : allDay ? dayStart(action.starts_at!, timeZone) : parseFutureWhen(action.starts_at, timeZone);
      if (!dateless && !startsAt) {
        return `${CLARIFY_MARK} I did not book "${action.title}": the date and time were unclear. When is it?`;
      }
      const endsAt = allDay ? null : parseFutureWhen(action.ends_at, timeZone);
      const step = action.for_next_step ? await findOpenNextStep(action.for_next_step, profileId) : undefined;
      if (action.for_next_step && !step) {
        return `${CLARIFY_MARK} I did not book "${action.title}": I could not find an open task or next step called "${action.for_next_step}". Which one is it for?`;
      }
      const extras = await appointmentExtrasInput(action, profileId, account);
      // Details already saved for this task, not booked yet: give them the date.
      const waiting = step
        ? ((await db('appointments').where({ care_profile_id: profileId, from_reminder_id: step.id }).whereNull('starts_at').first('id')) as { id: string } | undefined)
        : undefined;
      const input: AppointmentInput = {
        title: action.title,
        appointment_type: action.appointment_type,
        // Booking a referral with no name given is with whoever it is to.
        ...(action.provider_name?.trim()
          ? { provider_name: action.provider_name.trim(), provider_type: action.with_type ?? null, provider_phone: action.with_phone ?? null }
          : step?.provider_id
            ? { provider_id: step.provider_id }
            : {}),
        ...(action.location !== undefined && action.location !== null ? { location: action.location } : {}),
        starts_at: startsAt ? startsAt.toISOString() : null,
        ends_at: endsAt ? endsAt.toISOString() : null,
        all_day: allDay,
        status: startsAt ? 'scheduled' : 'to_book',
        ...(action.notes ? { notes: action.notes } : {}),
        ...(action.cost_estimate != null ? { cost_estimate: action.cost_estimate } : {}),
        ...(step ? { from_reminder_id: step.id } : {}),
        ...extras.input,
        tz: timeZone ?? null,
      };
      let booked;
      try {
        booked = await db.transaction(async (trx) => {
          if (waiting) {
            const { from_reminder_id: _f, ...rest } = input;
            void _f;
            const r = await updateAppointment(trx, { profileId, appointmentId: waiting.id, actorId: account.id, input: rest, timeZone });
            return r!;
          }
          return bookAppointment(trx, { profileId, actorId: account.id, input, timeZone });
        });
      } catch (err) {
        if (err instanceof BookingProblem) return `${CLARIFY_MARK} I did not book "${action.title}": ${err.message}`;
        throw err;
      }
      const providerNote = booked.filed.map((f) => ` Added ${f.name} to Contacts.`).join('');
      const extraNote = extras.notes.length ? ` ${extras.notes.join(' ')}` : '';
      if (!startsAt) {
        await audit(profileId, account.id, 'appointments', `${action.title}, not booked yet`, booked.appointment.id);
        const todo = step ? `"${step.title}" stays on the list until it has a date` : 'with a to-do to book it';
        return `Saved "${action.title}" as not booked yet, ${todo}. Tell me the date when it is booked.${providerNote}${extraNote}`;
      }
      await audit(profileId, account.id, 'appointments', action.title, booked.appointment.id);
      const costNote = action.cost_estimate != null ? ` Estimated cost ${action.cost_estimate} added to the spend ledger.` : '';
      const stepNote = step ? ` Ticked off "${step.title}".` : '';
      const when = allDay ? `${dateInZone(startsAt, timeZone)}, any time that day` : formatInZone(startsAt, timeZone);
      const prepNote = action.preparation?.trim() ? ' A reminder about getting ready goes out at 7pm the night before.' : '';
      return `Booked "${action.title}" for ${when}. It is on the calendar.${providerNote}${costNote}${stepNote}${prepNote}${extraNote}`;
    }
    case 'update_appointment': {
      const appointment = await findAppointmentByTitle(action.title, profileId);
      if (!appointment) {
        return `${CLARIFY_MARK} I could not find an appointment called "${action.title}". Which one did you mean?`;
      }
      const input: Partial<AppointmentInput> = { tz: timeZone ?? null };
      let startsAt: Date | null = null;
      if (action.starts_at) {
        startsAt = action.no_set_time ? dayStart(action.starts_at, timeZone) : parseFutureWhen(action.starts_at, timeZone);
        if (!startsAt) {
          return `${CLARIFY_MARK} I did not move "${appointment.title}": the new date and time were unclear. When should it be?`;
        }
        input.starts_at = startsAt.toISOString();
        input.all_day = !!action.no_set_time;
      } else if (action.no_set_time) input.all_day = true;
      if (action.ends_at !== undefined) {
        const e = parseFutureWhen(action.ends_at, timeZone);
        input.ends_at = e ? e.toISOString() : null;
      }
      if (action.new_title) input.title = action.new_title;
      if (action.appointment_type) input.appointment_type = action.appointment_type;
      if (action.location !== undefined) input.location = action.location;
      if (action.status) input.status = action.status;
      if (action.notes !== undefined) input.notes = action.notes;
      if (action.provider_name !== undefined) {
        if (action.provider_name?.trim()) Object.assign(input, { provider_name: action.provider_name.trim(), provider_type: action.with_type ?? null, provider_phone: action.with_phone ?? null });
        else input.provider_id = null;
      }
      if (action.cost_estimate !== undefined) input.cost_estimate = action.cost_estimate;
      if (action.cost_actual !== undefined) input.cost_actual = action.cost_actual;
      const extras = await appointmentExtrasInput(action, profileId, account);
      Object.assign(input, extras.input);
      let result;
      try {
        result = await db.transaction((trx) => updateAppointment(trx, { profileId, appointmentId: appointment.id, actorId: account.id, input, timeZone }));
      } catch (err) {
        if (err instanceof BookingProblem) return `${CLARIFY_MARK} I did not change "${appointment.title}": ${err.message}`;
        throw err;
      }
      const providerNote = (result?.filed ?? []).map((f) => ` Added ${f.name} to Contacts.`).join('') + (extras.notes.length ? ` ${extras.notes.join(' ')}` : '');
      await audit(profileId, account.id, 'appointments', `updated ${appointment.title}`, appointment.id);
      const name = action.new_title ?? appointment.title;
      if (action.status === 'cancelled') return `Cancelled "${name}". It stays on the record as cancelled.${providerNote}`;
      if (action.status === 'completed') return `Marked "${name}" as attended.${providerNote}`;
      if (action.status === 'missed') return `Marked "${name}" as missed.${providerNote}`;
      if (startsAt) {
        const when = action.no_set_time ? `${dateInZone(startsAt, timeZone)}, any time that day` : formatInZone(startsAt, timeZone);
        const later = result?.series_move ? ` The ${result.series_move.later} after it in the repeat stay where they were.` : '';
        return `Moved "${name}" to ${when}.${later}${providerNote}`;
      }
      return `Updated "${name}".${providerNote}`;
    }
    case 'record_appointment_outcome': {
      const named = action.appointment_title?.trim() || '';
      const found = named ? await findPastAppointment(named, profileId) : undefined;
      // No visit on file matches: file the outcome as a visit of its own,
      // already attended, rather than on an unrelated appointment. The next
      // steps are never dropped.
      let appointment: { id: string; title: string; status: string };
      let filedNew = false;
      if (found) {
        appointment = found;
      } else {
        // Told in conversation with no name for the visit, while one happened
        // today: ask which, rather than guess it or file a second visit.
        if (!named && !action.visit_title?.trim()) {
          const recent = (await db('appointments')
            .where({ care_profile_id: profileId })
            .whereNot('status', 'cancelled')
            .where('starts_at', '<=', new Date())
            .where('starts_at', '>=', new Date(Date.now() - 18 * 3600 * 1000))
            .orderBy('starts_at', 'desc')
            .select('title')) as Array<{ title: string }>;
          if (recent.length > 0) {
            const names = [...new Set(recent.map((r) => `"${r.title}"`))].join(' or ');
            return `${CLARIFY_MARK} Which visit was this: ${names}, or a different one? Say its name and I will record how it went.`;
          }
        }
        const title = (action.visit_title?.trim() || named || 'Visit').slice(0, 255);
        const startsAt = action.visited_on ? parseWhen(`${action.visited_on}T12:00:00`, timeZone) : new Date();
        const [row] = await db('appointments')
          .insert({
            care_profile_id: profileId,
            title,
            appointment_type: 'consultation',
            starts_at: startsAt,
            status: 'completed',
            notes: action.visited_on
              ? 'Filed from a letter about this visit. The letter gave the day, not the time.'
              : 'Filed from a letter about this visit.',
            created_by_account_id: account.id,
          })
          .returning(['id', 'title', 'status']);
        appointment = row as { id: string; title: string; status: string };
        filedNew = true;
      }
      const steps = await db.transaction(async (trx) => {
        const fields: Record<string, unknown> = { updated_at: trx.fn.now() };
        if (action.outcome?.trim()) {
          fields['outcome'] = action.outcome.trim();
          fields['outcome_recorded_at'] = trx.fn.now();
        }
        if (appointment.status === 'scheduled') fields['status'] = 'completed';
        await trx('appointments').where({ id: appointment.id, care_profile_id: profileId }).update(fields);
        return addNextSteps(trx, {
          profileId,
          appointmentId: appointment.id,
          actorId: account.id,
          timeZone: timeZone ?? null,
          steps: action.next_steps.map((s) => ({
            type: s.kind,
            details: s.details ?? null,
            due_on: s.due_on ?? null,
            provider_name: s.to_name ?? null,
            provider_type: s.to_type ?? null,
          })),
          source: 'pare',
        });
      });
      await audit(profileId, account.id, 'appointments', `outcome of ${appointment.title}`, appointment.id);
      const parts: string[] = [];
      if (filedNew) {
        parts.push(
          named
            ? `No appointment called "${named}" is on file, so I filed this as its own visit, "${appointment.title}".`
            : `I filed this as its own visit, "${appointment.title}", so it is not mixed up with another appointment.`
        );
      }
      if (action.outcome?.trim()) parts.push(`Noted how "${appointment.title}" went.`);
      if (steps.length) {
        parts.push(`Added ${steps.length === 1 ? 'a next step' : `${steps.length} next steps`} to track: ${steps.map((s) => (s.title === s.type_name ? s.title : `${s.title} (${s.type_name})`)).join(', ')}.`);
      }
      return parts.join(' ') || `Marked "${appointment.title}" as attended.`;
    }
    case 'forward_appointment_notes': {
      const source = await findPastAppointment(action.from_appointment_title ?? '', profileId);
      if (!source) {
        return `${CLARIFY_MARK} I could not find the appointment to forward notes from. Which one was it?`;
      }
      let to: { appointment_id?: string; reminder_id?: string } = {};
      if (action.to_next_step) {
        const step = await findOpenNextStep(action.to_next_step, profileId);
        if (!step) return `${CLARIFY_MARK} I could not find an open next step called "${action.to_next_step}". Which one should the notes go to?`;
        to = { reminder_id: step.id };
      } else if (action.to_appointment_title) {
        const target = await findAppointmentByTitle(action.to_appointment_title, profileId);
        if (!target) return `${CLARIFY_MARK} I could not find an appointment called "${action.to_appointment_title}". Which one should the notes go to?`;
        to = { appointment_id: target.id };
      } else {
        return `${CLARIFY_MARK} Where should the notes from "${source.title}" go?`;
      }
      const include = new Set(action.include?.length ? action.include : ['outcome', 'details', 'added_notes']);
      const full = (await db('appointments').where({ id: source.id }).first('outcome', 'notes')) as { outcome: string | null; notes: string | null };
      const items: ForwardItem[] = [];
      if (include.has('outcome') && full.outcome?.trim()) items.push({ part: 'outcome', body: full.outcome.trim() });
      if (include.has('details') && full.notes?.trim()) items.push({ part: 'details', body: full.notes.trim() });
      if (include.has('added_notes')) {
        const added = (await db('record_notes')
          .where({ care_profile_id: profileId, entity_type: 'appointments', entity_id: source.id })
          .whereNull('forward_id')
          .orderBy('created_at', 'asc')
          .select('id', 'body')) as Array<{ id: string; body: string }>;
        for (const n of added) items.push({ part: 'note', note_id: n.id, body: n.body });
      }
      if (items.length === 0) return `"${source.title}" has no notes to forward yet.`;
      const result = await db.transaction((trx) =>
        createForwards(trx, { profileId, sourceAppointmentId: source.id, actorId: account.id, items, to })
      );
      if ('error' in result) return `${CLARIFY_MARK} ${result.error}`;
      await audit(profileId, account.id, 'appointments', `forwarded notes from ${source.title}`);
      const one = result.sent === 1;
      const what = one ? 'one note' : `${result.sent} notes`;
      return result.landed
        ? `Forwarded ${what} from "${source.title}". ${one ? 'It is' : 'They are'} on the other appointment now.`
        : `Forwarded ${what} from "${source.title}". ${one ? 'It' : 'They'} will land on the appointment as soon as it is booked.`;
    }
    case 'add_circle_person':
    case 'update_circle_person':
    case 'remove_circle_person': {
      // Who is in the circle is the owner's to decide, as on the Care circle page.
      if (access.level !== 'owner' && access.level !== 'admin') {
        return `No change to the care circle: only the profile owner can change who is in it.`;
      }
      if (action.type === 'add_circle_person') {
        const already = await findCircleMemberByName(profileId, action.name);
        if (already && already.display_name.toLowerCase() === action.name.trim().toLowerCase()) {
          return `${already.display_name} is already in the care circle.`;
        }
        const member = await addCirclePerson(profileId, {
          display_name: action.name,
          role: action.role,
          relationship: action.relationship ?? null,
          role_description: action.description ?? null,
          phone: action.phone ?? null,
          email: action.email ?? null,
        });
        await audit(profileId, account.id, 'care_circle_members', `added ${member.display_name} to the circle`);
        return `Added ${member.display_name} to the care circle. No invite was sent; they do not need to log in.`;
      }
      const member = await findCircleMemberByName(profileId, action.name);
      if (!member) {
        return `${CLARIFY_MARK} I could not find anyone called "${action.name}" in the care circle. Who did you mean?`;
      }
      if (action.type === 'remove_circle_person') {
        // Taking away someone's login is done on the Care circle page, where
        // it asks first.
        if (!isAddedPerson(member)) {
          return `${member.display_name} has a login or an invite on the way, so removing them ends their access. Do that from the Care circle page, where it asks first.`;
        }
        await db('care_circle_members').where({ id: member.id, care_profile_id: profileId }).delete();
        await audit(profileId, account.id, 'care_circle_members', `removed ${member.display_name} from the circle`);
        return `Removed ${member.display_name} from the care circle.`;
      }
      const added = isAddedPerson(member);
      const fields: Record<string, unknown> = {};
      if (action.role) fields['role'] = action.role;
      if (action.relationship !== undefined) fields['relationship'] = action.relationship?.trim() || null;
      if (action.description !== undefined) fields['role_description'] = action.description?.trim() || null;
      if (action.phone !== undefined) fields['phone'] = action.phone?.trim() || null;
      if (added && action.new_name?.trim()) fields['display_name'] = action.new_name.trim();
      if (added && action.email !== undefined) fields['email'] = action.email?.trim() || null;
      if (Object.keys(fields).length === 0) {
        return added
          ? `Nothing to change for ${member.display_name}.`
          : `${member.display_name} has a login or an invite on the way, so their name and email come from their own account.`;
      }
      await db('care_circle_members').where({ id: member.id, care_profile_id: profileId }).update(fields);
      await audit(profileId, account.id, 'care_circle_members', `updated ${member.display_name}`);
      return `Updated ${String(fields['display_name'] ?? member.display_name)} in the care circle.`;
    }
    case 'complete_task': {
      const task = await findOpenTaskByTitle(action.title, profileId);
      if (!task) {
        return `${CLARIFY_MARK} I could not find an open task called "${action.title}". Which one did you mean?`;
      }
      // Doing this to-do means booking the appointment waiting on it.
      const waitingAppt = (await db('appointments')
        .where({ care_profile_id: profileId, from_reminder_id: task.id })
        .whereNull('starts_at')
        .first('title')) as { title: string } | undefined;
      if (waitingAppt) {
        return `${CLARIFY_MARK} "${waitingAppt.title}" is waiting for its date. When is it booked for? I will add it and tick this off.`;
      }
      await db('reminders').where({ id: task.id, care_profile_id: profileId }).update({
        completed: true,
        completed_at: db.fn.now(),
        completed_by_account_id: account.id,
        completion_note: action.completion_note ?? null,
      });
      await audit(profileId, account.id, 'reminders', `completed ${task.title}`);
      return `Ticked off "${task.title}".`;
    }
    case 'reschedule_task': {
      const task = await findOpenTaskByTitle(action.title, profileId);
      if (!task) {
        return `${CLARIFY_MARK} I could not find an open task called "${action.title}". Which one did you mean?`;
      }
      // A date with no time is any time that day.
      const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(action.due_at.trim());
      const due = dayOnly ? dayStart(action.due_at, timeZone) : parseFutureWhen(action.due_at, timeZone);
      if (!due) {
        return `${CLARIFY_MARK} I did not move "${task.title}": the new due time was unclear. When is it due?`;
      }
      await updateTask(db, {
        profileId,
        taskId: task.id,
        timeZone,
        input: {
          ...(dayOnly ? { due_on: action.due_at.trim(), tz: timeZone ?? null } : { next_due_at: due.toISOString(), all_day: false }),
          ...(action.repeat ? { repeat: action.repeat } : {}),
        },
      });
      await audit(profileId, account.id, 'reminders', `rescheduled ${task.title}`, task.id);
      return `Moved "${task.title}" to ${dayOnly ? `${dateInZone(due, timeZone)}, any time that day` : formatInZone(due, timeZone)}.`;
    }
    case 'record_cost': {
      // The spend ledger is owner and admin only, the same rule the REST
      // route enforces with requireProfileOwner.
      if (access.level !== 'owner' && access.level !== 'admin') {
        return `No cost was recorded: only the profile owner can see and change the spend ledger.`;
      }
      const claimStatus =
        action.claim_status ?? (action.claimable_amount != null && action.claimable_amount > 0 ? 'unclaimed' : 'none');
      await db('health_spend_entries').insert({
        care_profile_id: profileId,
        amount: action.amount,
        spent_on: action.spent_on ?? dateInZone(new Date(), timeZone),
        category: 'other',
        status: 'confirmed',
        description: action.description ?? null,
        tax_amount: action.tax_amount ?? null,
        funding_source: action.funding_source ?? null,
        claimable_amount: action.claimable_amount ?? null,
        claim_status: claimStatus,
        account_code: action.account_code ?? null,
        created_by_account_id: account.id,
      });
      await audit(profileId, account.id, 'health_spend', action.description ?? `cost ${action.amount}`);
      const on = action.spent_on ?? dateInZone(new Date(), timeZone);
      return `Recorded a cost of ${action.amount} on ${on}${action.description ? ` for ${action.description}` : ''}.`;
    }
    case 'record_reading': {
      const treatment = await db('treatments')
        .where({ care_profile_id: profileId })
        .whereRaw('lower(name) = lower(?)', [action.treatment_name.trim()])
        .select('id', 'name')
        .first();
      if (!treatment) {
        return `${CLARIFY_MARK} There is no treatment called "${action.treatment_name}" on this record. Which one should the reading go against?`;
      }
      // A session that did not go ahead needs its reason recorded, the same
      // rule the observations endpoint applies.
      if (action.status !== 'completed' && !action.notes?.trim()) {
        return `Could not record the ${action.status} session of ${treatment.name}: a note explaining why is required.`;
      }
      const observedAt = parseWhen(action.observed_at, timeZone);
      const metrics = await db('treatment_metrics').where({ treatment_id: treatment.id });
      const rows: Record<string, unknown>[] = [];
      const unmatched: string[] = [];
      for (const v of action.values ?? []) {
        const metric = metrics.find((m) => String(m.name).toLowerCase() === v.metric_name.trim().toLowerCase());
        if (!metric) {
          unmatched.push(v.metric_name);
          continue;
        }
        rows.push({
          treatment_metric_id: metric.id,
          value_number: metric.value_type === 'number' ? v.value_number ?? null : null,
          value_text: metric.value_type === 'text' ? v.value_text ?? null : null,
          value_boolean: metric.value_type === 'yes_no' ? v.value_boolean ?? null : null,
        });
      }
      if (unmatched.length > 0 && rows.length === 0) {
        const known = metrics.map((m) => m.name).join(', ');
        return `${CLARIFY_MARK} ${treatment.name} has no measure called ${unmatched.join(' or ')}. It measures: ${known || 'nothing yet'}. Which should I use?`;
      }
      const [observation] = await db('observations')
        .insert({
          care_profile_id: profileId,
          treatment_id: treatment.id,
          observed_at: observedAt,
          recorded_by_account_id: account.id,
          recorded_by_name: account.display_name,
          source: 'manual',
          status: action.status,
          notes: action.notes ?? null,
        })
        .returning('*');
      if (rows.length > 0) {
        await db('observation_values').insert(rows.map((r) => ({ ...r, observation_id: observation.id })));
      }
      await audit(profileId, account.id, 'treatments', `reading for ${treatment.name}`);
      const skipped = unmatched.length > 0 ? ` ${treatment.name} has no measure called ${unmatched.join(' or ')}, so that was left out.` : '';
      return `Recorded a ${treatment.name} session at ${formatInZone(observedAt, timeZone)} with ${rows.length} reading${rows.length === 1 ? '' : 's'}.${skipped}`;
    }
    case 'need_clarification': {
      const options = action.options?.length ? ` ${action.options.join(' or ')}?` : '';
      return `${CLARIFY_MARK} ${action.question}${options}`;
    }
  }
}

export async function executeActions(
  actions: AssistantAction[],
  profileId: string,
  account: Account,
  access: CareAccess,
  timeZone?: string | null,
  // How the change was made and, for a reversible batch, the token to group its
  // audit rows under. Defaults to a person making the change directly.
  attribution?: { source?: AuditSource; undoBatch?: string | null }
): Promise<string[]> {
  if (actions.length === 0) return [];
  if (access.level === 'viewer') {
    return ['No changes were made: you have view-only access to this care profile.'];
  }
  return auditContext.run(
    { source: attribution?.source ?? 'person', undoBatch: attribution?.undoBatch ?? null },
    async () => {
      const results: string[] = [];
      // One set for the whole turn, so several "Escitalopram" doses across
      // separate actions still spread across its strengths.
      const usedMedIds = new Set<string>();
      for (const action of actions) {
        try {
          const outcome = await executeOne(action, profileId, account, access, timeZone, usedMedIds);
          results.push(...(Array.isArray(outcome) ? outcome : [outcome]));
        } catch (err) {
          console.warn('Assistant action failed:', (err as Error).message);
          results.push('One of the requested changes could not be saved. Please try it directly in the app.');
        }
      }
      return results;
    }
  );
}

interface ResolvedProfile {
  profileId: string;
  /** The profile's display name, for confirmation lines. */
  name: string;
  access: CareAccess;
}

interface NameCandidateRow extends NameCandidate {
  membership: CareCircleMember | null;
}

/** Every care profile the account can reach, with the name parts needed to match on. */
async function reachableProfiles(accountId: string): Promise<NameCandidateRow[]> {
  const [owned, shared] = await Promise.all([
    db<CareProfile>('care_profiles').where({ account_id: accountId, archived: false }),
    db('care_profiles')
      .join('care_circle_members', 'care_profiles.id', 'care_circle_members.care_profile_id')
      .where({
        'care_circle_members.account_id': accountId,
        'care_circle_members.invite_accepted': true,
        'care_profiles.archived': false,
      })
      .whereNot('care_profiles.account_id', accountId)
      .select(
        'care_profiles.id',
        'care_profiles.full_name',
        'care_profiles.preferred_name',
        'care_profiles.first_name',
        'care_profiles.middle_name',
        'care_profiles.last_name',
        db.raw('row_to_json(care_circle_members.*) as membership')
      ),
  ]);
  return [
    ...owned.map((p) => ({
      id: p.id,
      full_name: p.full_name,
      preferred_name: p.preferred_name,
      first_name: p.first_name,
      middle_name: p.middle_name,
      last_name: p.last_name,
      membership: null,
    })),
    ...(shared as NameCandidateRow[]),
  ];
}

/** Everyone the account can reach, with their access, for listing to an outside assistant. */
export async function listReachableProfiles(accountId: string): Promise<Array<{ id: string; name: string; access: CareAccess }>> {
  const rows = await reachableProfiles(accountId);
  return rows
    .map((r) => ({ id: r.id, name: r.full_name, access: accessFor(r.membership) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function accessFor(membership: CareCircleMember | null): CareAccess {
  return membership
    ? { level: membership.permission === 'viewer' ? 'viewer' : 'contributor', member: membership }
    : { level: 'owner', member: null };
}

/**
 * Find the one care profile the account can reach that the spoken name
 * identifies, using fuzzy matching so "Chris Rattray" resolves to "Mr
 * Christian Paul Rattray". Anything other than exactly one match returns
 * null: several matches means the assistant must ask which person, and no
 * match means it should say so rather than guess.
 */
export async function resolveProfileByName(name: string, accountId: string): Promise<ResolvedProfile | null> {
  if (!name.trim()) return null;
  const candidates = await reachableProfiles(accountId);
  const matchedIds = matchProfileNames(name, candidates);
  if (matchedIds.length !== 1) return null;
  const hit = candidates.find((c) => c.id === matchedIds[0])!;
  return { profileId: hit.id, name: hit.full_name, access: accessFor(hit.membership) };
}

/**
 * The names of every profile whose surname (or other name word) could be
 * what the user meant, for the assistant to offer as a short choice when a
 * name is ambiguous. Narrowed to the same fuzzy candidates, so it never
 * suggests an unrelated profile.
 */
export async function candidateProfileNames(name: string, accountId: string): Promise<string[]> {
  if (!name.trim()) return [];
  const candidates = await reachableProfiles(accountId);
  const matchedIds = new Set(matchProfileNames(name, candidates));
  return candidates.filter((c) => matchedIds.has(c.id)).map((c) => c.full_name);
}

/** Map one cross-profile entry onto the matching single-profile action. */
function toSingleProfileAction(action: CrossProfileAction, entry: CrossProfileAction['entries'][number]): AssistantAction {
  if (action.type === 'cross_profile_log') {
    const e = entry as z.infer<typeof crossProfileLogSchema>['entries'][number];
    return { type: 'log_event', entry_type: e.entry_type, title: e.title, body: e.body, occurred_at: e.occurred_at };
  }
  if (action.type === 'cross_profile_task') {
    const e = entry as z.infer<typeof crossProfileTaskSchema>['entries'][number];
    const { profile_name: _who, ...task } = e;
    void _who;
    return { type: 'add_task', ...task };
  }
  if (action.type === 'cross_profile_medications') {
    const e = entry as z.infer<typeof crossProfileMedicationSchema>['entries'][number];
    return {
      type: 'record_medication',
      medication_name: e.medication_name,
      status: e.status,
      dose_given: e.dose_given,
      notes: e.notes,
      administered_at: e.administered_at,
    };
  }
  // profile_actions: the entry already carries a full single-profile action.
  return (entry as z.infer<typeof profileActionsSchema>['entries'][number]).action;
}

/**
 * Carry out cross-profile actions from the dashboard. Each entry names its
 * target profile; the name is resolved to a profile the account can reach,
 * write access is checked per profile, and the entry runs through the same
 * execution path as the single-profile assistant. A name that cannot be
 * resolved fails that entry only; the rest still run.
 */
export async function executeCrossProfileActions(
  actions: CrossProfileAction[],
  account: Account,
  timeZone?: string | null
): Promise<string[]> {
  if (actions.length === 0) return [];
  const results: string[] = [];
  const resolved = new Map<string, ResolvedProfile | null>();
  // Per-profile record of medication rows used this turn, so repeated doses of
  // a multi-strength drug spread across its strengths.
  const usedByProfile = new Map<string, Set<string>>();

  for (const action of actions) {
    for (const entry of action.entries) {
      const key = entry.profile_name.trim().toLowerCase();
      if (!resolved.has(key)) {
        resolved.set(key, await resolveProfileByName(entry.profile_name, account.id));
      }
      const target = resolved.get(key)!;
      if (!target) {
        // Say whether nothing matched or several did, and name the narrowed
        // candidates, so the assistant can ask rather than guess.
        const candidates = await candidateProfileNames(entry.profile_name, account.id);
        if (candidates.length > 1) {
          results.push(
            `${entry.profile_name}: nothing was recorded, because that could be more than one person: ${candidates.join(
              ' or '
            )}. Tell me which one.`
          );
        } else {
          results.push(
            `${entry.profile_name}: nothing was recorded, because no one in your care matches that name.`
          );
        }
        continue;
      }
      if (target.access.level === 'viewer') {
        results.push(`${target.name}: nothing was recorded, because you have view-only access to this care profile.`);
        continue;
      }
      try {
        let used = usedByProfile.get(target.profileId);
        if (!used) { used = new Set<string>(); usedByProfile.set(target.profileId, used); }
        const outcome = await executeOne(toSingleProfileAction(action, entry), target.profileId, account, target.access, timeZone, used);
        for (const line of Array.isArray(outcome) ? outcome : [outcome]) {
          results.push(`${target.name}: ${line}`);
        }
      } catch (err) {
        console.warn('Cross-profile assistant action failed:', (err as Error).message);
        results.push(`${target.name}: one of the requested changes could not be saved. Please try it directly in the app.`);
      }
    }
  }
  return results;
}
