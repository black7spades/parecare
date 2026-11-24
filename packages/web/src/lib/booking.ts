/**
 * Book from anywhere: one link that opens the booking form already filled
 * in, from a task, a condition or a contact.
 */
export interface BookingParams {
  provider?: string | null;
  condition?: string | null;
  fromTask?: string | null;
  title?: string | null;
  type?: string | null;
  /** The journey step this booking carries out. */
  fromJourneyItem?: string | null;
}

export function bookingHref(profileId: string, p: BookingParams = {}): string {
  const q = new URLSearchParams({ new: '1' });
  if (p.provider) q.set('provider', p.provider);
  if (p.condition) q.set('condition', p.condition);
  if (p.fromTask) q.set('from_task', p.fromTask);
  if (p.title) q.set('title', p.title);
  if (p.type) q.set('type', p.type);
  if (p.fromJourneyItem) q.set('from_journey_item', p.fromJourneyItem);
  return `/app/${profileId}/appointments?${q.toString()}`;
}

/** Words for a test, and what the booking is called. */
const TEST_NAMES: Array<{ re: RegExp; name: string }> = [
  { re: /blood test|bloods|pathology/i, name: 'Blood test' },
  { re: /x-?ray/i, name: 'X-ray' },
  { re: /ultrasound/i, name: 'Ultrasound' },
  { re: /\bct\b/i, name: 'CT scan' },
  { re: /\bmri\b/i, name: 'MRI scan' },
  { re: /\becg\b|heart rhythm test|holter/i, name: 'Heart rhythm test' },
  { re: /hearing test/i, name: 'Hearing test' },
  { re: /eye test/i, name: 'Eye test' },
];

/** What an appointment booked from a task is called. */
export function bookingTitleFromTask(task: {
  title: string;
  kind?: { name: string; system_key: string | null } | null;
  provider?: { role_label: string | null } | null;
}): string {
  const kindName = task.kind?.name ?? '';
  const test = TEST_NAMES.find((t) => t.re.test(kindName) || t.re.test(task.title));
  if (test) return test.name;
  const key = task.kind?.system_key;
  if ((key === 'referral' || key === 'follow_up') && task.provider?.role_label) return `${task.provider.role_label} appointment`;
  const bare = task.title.replace(/^\s*(make an appointment (for|with)|book an|book a|book the|book|see)\s+/i, '').trim();
  if (!bare) return task.title;
  const named = bare.charAt(0).toUpperCase() + bare.slice(1);
  // "Book a neurologist" is a neurologist appointment.
  return /^[a-z]+(ist|ian)$/i.test(bare) ? `${named} appointment` : named;
}
