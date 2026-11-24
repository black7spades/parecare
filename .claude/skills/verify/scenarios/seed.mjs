// Seeds the scenario test world through the real API. Run after the verify
// stack is up:  node .claude/skills/verify/scenarios/seed.mjs
// Needs Node 18+. Safe to run once per fresh database (it stops if the
// "me" account already exists). To reset, delete the pgdata folder.
//
// Logins (password for all: Passw0rd!bench)
//   me@bench.test        managing own health
//   parent@bench.test    parent of a child with complex needs
//   daughter@bench.test  daughter caring for her mum
//   manager@bench.test   aged care home manager (professional tier, user role)
//   worker@bench.test    support worker, contributor on mum + 6 residents
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const API = process.env.API ?? 'http://127.0.0.1:3001/api/v1';
const PASSWORD = 'Passw0rd!bench';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, '../../../../packages/api/package.json'));

const DAY = 86400000;
const at = (days, hour = 9, min = 0) => {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
};
const dateOnly = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

async function call(method, url, token, body) {
  const res = await fetch(API + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    console.warn(`  ! ${method} ${url} -> ${res.status} ${text.slice(0, 160)}`);
    return { ok: false, status: res.status, ...json };
  }
  return { ok: true, ...json };
}

async function register(email, first, last) {
  const r = await call('POST', '/auth/register', null, { email, password: PASSWORD, first_name: first, last_name: last });
  if (!r.ok) throw new Error(`register ${email} failed`);
  return r.token;
}

// A one page PDF standing in for the referral letter.
function tinyPdf(text) {
  const stream = `BT /F1 14 Tf 60 740 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out);
}

async function upload(token, pid, label, category, text, link, extra = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([tinyPdf(text)], { type: 'application/pdf' }), `${label.replace(/\W+/g, '-')}.pdf`);
  fd.append('label', label);
  fd.append('category', category);
  if (link) { fd.append('link_entity_type', link.type); fd.append('link_entity_id', link.id); }
  // Date written, who it is from and to, and the like (Wave 3).
  for (const [k, v] of Object.entries(extra)) fd.append(k, String(v));
  const res = await fetch(`${API}/care-profiles/${pid}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) console.warn('  ! upload failed', res.status, JSON.stringify(j).slice(0, 120));
  return j.document;
}

const profile = async (t, body) => (await call('POST', '/care-profiles', t, body)).profile;
const provider = async (t, pid, body) => (await call('POST', `/care-profiles/${pid}/providers`, t, body)).provider;
const med = async (t, pid, body) => (await call('POST', `/care-profiles/${pid}/medications`, t, body)).medication;
const appt = async (t, pid, body) => (await call('POST', `/care-profiles/${pid}/appointments`, t, body)).appointment;
const task = async (t, pid, body) => (await call('POST', `/care-profiles/${pid}/reminders`, t, body)).reminder;
const condition = (t, pid, body) => call('POST', `/care-profiles/${pid}/conditions`, t, body);
const allergy = (t, pid, body) => call('POST', `/care-profiles/${pid}/allergies`, t, body);
const logEntry = (t, pid, body) => call('POST', `/care-profiles/${pid}/log`, t, body);
const question = (t, pid, body) => call('POST', `/care-profiles/${pid}/questions`, t, body);

const probe = await call('POST', '/auth/login', null, { email: 'me@bench.test', password: PASSWORD });
if (probe.ok) { console.log('Seed already applied (me@bench.test exists). Delete pgdata to reseed.'); process.exit(0); }

const ids = {};

// 1. Me, managing my own health ------------------------------------------
console.log('Me');
const meT = await register('me@bench.test', 'Sam', 'Nguyen');
await call('PATCH', '/auth/me', meT, { phone: '0411 555 288' });
const me = await profile(meT, { kind: 'person', first_name: 'Sam', last_name: 'Nguyen', date_of_birth: '1988-04-12', owner_relationship: 'self', primary_language: 'English', current_phase: 'home_with_support', contact_kind: 'self', address_line1: '14 Wattle Street', address_suburb: 'Fitzroy', address_state: 'VIC', address_postcode: '3065' });
ids.me = me.id;
const meGp = await provider(meT, me.id, { provider_type: 'GP', name: 'Dr Priya Raman', phone: '03 9417 2200', email: 'reception@fitzroymedical.example', practice_name: 'Fitzroy Medical Centre', booking_link: 'https://fitzroymedical.example/book' });
await provider(meT, me.id, { provider_type: 'Pharmacy', name: 'Fitzroy Amcal Pharmacy', phone: '03 9417 1188' });
await condition(meT, me.id, { name: 'Migraine with aura', status: 'active', started_on: '2019-06-01' });
await allergy(meT, me.id, { substance: 'Penicillin', reaction: 'Hives' });
await med(meT, me.id, { name: 'Sumatriptan', dose_amount: '50', dose_unit: 'mg', form: 'Tablet', route: 'Oral', as_needed: true, supply: 6, supply_remaining: 2, instructions: 'At onset of migraine. Max 2 doses in 24 hours.' });
await med(meT, me.id, { name: 'Propranolol', dose_amount: '40', dose_unit: 'mg', form: 'Tablet', route: 'Oral', schedule_times: ['08:00', '20:00'], supply: 60, supply_remaining: 8, repeats_due: dateOnly(5), prescriber_provider_id: meGp.id });
await appt(meT, me.id, { title: 'GP review', appointment_type: 'consultation', provider_id: meGp.id, starts_at: at(-30, 10), status: 'completed' });
await appt(meT, me.id, { title: 'Blood test', appointment_type: 'test', starts_at: at(3, 8) });
// Wave 6: the visit after the blood test, where the results are talked about.
await appt(meT, me.id, { title: 'GP follow-up', appointment_type: 'consultation', provider_id: meGp.id, starts_at: at(10, 9, 30) });
await task(meT, me.id, { title: 'Book neurologist', body: 'Referral from Dr Raman. Phone Dr Chen on 03 9345 6677.', reminder_type: 'once', next_due_at: at(2) });
await task(meT, me.id, { title: 'Get repeat script for Propranolol', reminder_type: 'once', next_due_at: at(4) });
// Wave 5: questions to take to the neurologist, for the health summary.
await question(meT, me.id, { title: 'Should I keep a migraine diary before the visit?' });
await upload(meT, me.id, 'Neurology referral letter', 'Referral', 'Referral to Dr Anna Chen, Neurologist, Royal Melbourne Hospital. 12 months.');

// 2. Parent of a child with complex needs ---------------------------------
console.log('Parent');
const parT = await register('parent@bench.test', 'Karen', 'Mitchell');
await call('PATCH', '/auth/me', parT, { phone: '0412 555 640', gender: 'Female' });
const kid = await profile(parT, { kind: 'person', first_name: 'Oliver', last_name: 'Mitchell', date_of_birth: '2016-09-03', owner_relationship: 'son', current_phase: 'home_with_support', contact_kind: 'self', primary_language: 'English' });
ids.kid = kid.id;
const school = await provider(parT, kid.id, { provider_type: 'School', name: 'Mrs Julie Adams', phone: '03 9876 5400', email: 'office@brunswicksouth.example', practice_name: 'Brunswick South Primary School' });
const ot = await provider(parT, kid.id, { provider_type: 'Occupational therapist', name: 'Maya Lopez', phone: '0412 555 019', email: 'maya@kidsot.example', practice_name: 'Little Steps OT' });
const speech = await provider(parT, kid.id, { provider_type: 'Speech pathologist', name: 'Tom Hendry', phone: '0413 555 220', practice_name: 'Talk Together Speech' });
await provider(parT, kid.id, { provider_type: 'Paediatrician', name: 'Dr Helen Park', phone: '03 9345 1100', practice_name: 'Royal Childrens Clinic' });
await provider(parT, kid.id, { provider_type: 'NDIS support coordinator', name: 'Ben Sharma', phone: '0414 555 301', email: 'ben@connectsupport.example' });
await condition(parT, kid.id, { name: 'Autism spectrum disorder', status: 'managed', category: 'neurotype', neurotype: 'autism', diagnosis_status: 'formal' });
await condition(parT, kid.id, { name: 'Speech delay', status: 'active' });
await allergy(parT, kid.id, { substance: 'Peanuts', reaction: 'Anaphylaxis' });
await med(parT, kid.id, { name: 'Melatonin', dose_amount: '2', dose_unit: 'mg', form: 'Tablet', route: 'Oral', schedule_times: ['19:30'], supply: 30, supply_remaining: 4 });
await med(parT, kid.id, { name: 'EpiPen Junior', dose_amount: '150', dose_unit: 'mcg', form: 'Injection', route: 'Intramuscular', as_needed: true, supply: 2, supply_remaining: 2, critical: true });
await appt(parT, kid.id, { title: 'OT session', appointment_type: 'therapy', provider_id: ot.id, starts_at: at(2, 15) });
await appt(parT, kid.id, { title: 'Speech therapy', appointment_type: 'therapy', provider_id: speech.id, starts_at: at(4, 16) });
await appt(parT, kid.id, { title: 'Paediatrician review', appointment_type: 'consultation', starts_at: at(-14, 11), status: 'completed' });
await task(parT, kid.id, { title: 'Book NDIS plan review meeting', body: 'Plan ends in 6 weeks. Phone Ben on 0414 555 301.', reminder_type: 'once', next_due_at: at(3) });
await task(parT, kid.id, { title: 'Ask OT for progress report', reminder_type: 'once', next_due_at: at(7) });
await task(parT, kid.id, { title: 'Meet school about learning support', reminder_type: 'once', next_due_at: at(10) });
await upload(parT, kid.id, 'NDIS plan 2025-2026', 'Letter', 'NDIS plan for Oliver Mitchell. Plan ends in 6 weeks.');
await logEntry(parT, kid.id, { entry_type: 'observation', title: 'School pickup', body: 'Oliver had a hard transition at drop off. Used the visual timetable and settled in 10 minutes.' });

// 3. Daughter caring for ageing mum ---------------------------------------
console.log('Daughter and mum');
const dauT = await register('daughter@bench.test', 'Linda', 'Kowalski');
await call('PATCH', '/auth/me', dauT, { phone: '0412 555 777', gender: 'Female' });
const mum = await profile(dauT, { kind: 'person', first_name: 'Dorothy', last_name: 'Kowalski', date_of_birth: '1943-02-19', owner_relationship: 'mother', current_phase: 'increased_dependency', contact_kind: 'self', primary_language: 'English', address_line1: '7 Banksia Court', address_suburb: 'Box Hill', address_state: 'VIC', address_postcode: '3128', residence_type: 'private_residence' });
ids.mum = mum.id;
const mumGp = await provider(dauT, mum.id, { provider_type: 'GP', name: 'Dr James Okafor', phone: '03 9890 3300', email: 'info@boxhillfamily.example', practice_name: 'Box Hill Family Practice', booking_link: 'https://boxhillfamily.example/book', address_line1: '12 Station Street', address_suburb: 'Box Hill', address_state: 'VIC', address_postcode: '3128' });
const pharm = await provider(dauT, mum.id, { provider_type: 'Pharmacy', name: 'Terry White Chemmart Box Hill', phone: '03 9890 1234', email: 'orders@chemmartbh.example' });
const cardio = await provider(dauT, mum.id, { provider_type: 'Cardiologist', name: 'Dr Michael Tran', phone: '03 9854 7700', practice_name: 'Eastern Heart Clinic' });
const geri = await provider(dauT, mum.id, { provider_type: 'Geriatrician', name: 'Dr Susan Whitfield', phone: '03 9094 2200', practice_name: 'Box Hill Hospital Aged Care' });
await provider(dauT, mum.id, { provider_type: 'Podiatrist', name: 'Ali Hassan', phone: '0415 555 740' });
// Wave 6: the hospital she might go into, and the care home she might move to.
await provider(dauT, mum.id, { provider_type: 'Hospital', kind: 'organisation', name: 'Box Hill Hospital', phone: '03 9895 3333', address_line1: '8 Arnold Street', address_suburb: 'Box Hill', address_state: 'VIC', address_postcode: '3128' });
await provider(dauT, mum.id, { provider_type: 'Aged care home', kind: 'organisation', name: 'Banksia Gardens Aged Care', phone: '03 9898 1200', address_line1: '40 Whitehorse Road', address_suburb: 'Box Hill', address_state: 'VIC', address_postcode: '3128' });
await condition(dauT, mum.id, { name: 'Atrial fibrillation', status: 'managed' });
await condition(dauT, mum.id, { name: 'Type 2 diabetes', status: 'managed' });
await condition(dauT, mum.id, { name: 'Mild cognitive impairment', status: 'active' });
await allergy(dauT, mum.id, { substance: 'Sulfa drugs', reaction: 'Rash' });
await med(dauT, mum.id, { name: 'Warfarin', dose_amount: '3', dose_unit: 'mg', form: 'Tablet', route: 'Oral', schedule_times: ['18:00'], supply: 28, supply_remaining: 3, critical: true, supplier: 'Terry White Chemmart Box Hill', prescriber_provider_id: mumGp.id });
await med(dauT, mum.id, { name: 'Metformin', dose_amount: '500', dose_unit: 'mg', form: 'Tablet', route: 'Oral', schedule_times: ['08:00', '18:00'], with_food: true, supply: 60, supply_remaining: 40 });
await med(dauT, mum.id, { name: 'Metoprolol', dose_amount: '50', dose_unit: 'mg', form: 'Tablet', route: 'Oral', schedule_times: ['08:00', '20:00'], supply: 60, supply_remaining: 5, repeats_due: dateOnly(3), prescriber_provider_id: mumGp.id });
await med(dauT, mum.id, { name: 'Paracetamol', dose_amount: '500', dose_unit: 'mg', form: 'Tablet', route: 'Oral', as_needed: true, supply: 50, supply_remaining: 30 });
const mumOldAppt = await appt(dauT, mum.id, { title: 'Cardiology follow-up', appointment_type: 'consultation', provider_id: cardio.id, starts_at: at(-21, 14), status: 'completed' });
await appt(dauT, mum.id, { title: 'GP visit for script repeats', appointment_type: 'consultation', provider_id: mumGp.id, starts_at: at(5, 10, 30) });
await appt(dauT, mum.id, { title: 'Geriatrician assessment', appointment_type: 'consultation', provider_id: geri.id, starts_at: at(12, 13) });
await appt(dauT, mum.id, { title: 'Podiatry', appointment_type: 'therapy', starts_at: at(8, 11) });
const mumNeuroTask = await task(dauT, mum.id, { title: 'Book a neurologist', body: 'Dr Okafor referred Mum for memory testing. Neurologist is Dr Anna Chen, 03 9345 6677.', reminder_type: 'once', next_due_at: at(2) });
await task(dauT, mum.id, { title: 'Reorder Metoprolol from pharmacy', reminder_type: 'once', next_due_at: at(1) });
await task(dauT, mum.id, { title: 'Book flu shot', reminder_type: 'once', next_due_at: at(9) });
await task(dauT, mum.id, { title: 'Ask GP about 75+ health assessment', reminder_type: 'once', next_due_at: at(14) });
// Written by her GP ten days ago and attached to the task it is for. Who it is
// to is left for the person to fill in, so scenario 01 still finds Dr Chen
// only in the task notes.
const ref = await upload(dauT, mum.id, 'Neurology referral letter', 'Referral', 'Referral to Dr Anna Chen, Neurologist, Epworth Richmond. For memory assessment. 12 months from 10 Nov.', mumNeuroTask ? { type: 'reminders', id: mumNeuroTask.id } : null, { issued_on: dateOnly(-10), from_provider_id: mumGp.id });
await upload(dauT, mum.id, 'Discharge summary Box Hill Hospital', 'Letter', 'Discharge summary. Admitted 2 days, fall at home. Metoprolol dose changed to 25mg. See GP within 7 days.');
await question(dauT, mum.id, { title: 'Is the memory change getting worse?', body: 'Ask Dr Okafor and the neurologist.' });
await question(dauT, mum.id, { title: 'Can Warfarin be swapped for something that needs fewer blood tests?' });
await logEntry(dauT, mum.id, { entry_type: 'observation', title: 'Mum seemed confused today', body: 'Asked about Dad twice. Ate lunch well.' });
// Wave 5: how Dorothy eats and moves, her directive, her son who holds power
// of attorney with his document, and a task already done, for the emergency
// sheet and the calendar feed.
await call('PUT', `/care-profiles/${mum.id}/plan`, dauT, { dietary_requirements: ['Diabetic diet'], mobility_aids: ['Walking stick'], communication_needs: [], advance_care_directive: true, advance_care_directive_location: 'Kitchen drawer, blue folder' });
await upload(dauT, mum.id, 'Advance care directive', 'Advance care directive', 'Advance care directive for Dorothy Kowalski. Wishes to stay at home.');
await call('POST', `/care-profiles/${mum.id}/circle/people`, dauT, { display_name: 'Peter Kowalski', role: 'family', relationship: 'Son', phone: '0413 555 902', email: 'peter.k@example.com', poa_type: 'enduring', poa_activated: false });
await upload(dauT, mum.id, 'Enduring power of attorney', 'Power of attorney', 'Enduring power of attorney appointing Peter Kowalski.');
const mumDone = await task(dauT, mum.id, { title: 'Pick up the blood test form', body: 'Ring the clinic on 03 9890 3300 first.', reminder_type: 'once', next_due_at: at(-2) });
if (mumDone) await call('PATCH', `/care-profiles/${mum.id}/reminders/${mumDone.id}`, dauT, { completed: true });

// 4. Aged care home manager, professional tier, ordinary user -------------
console.log('Home manager and 20 residents');
const manT = await register('manager@bench.test', 'Fiona', 'Brennan');
const names = [
  ['Margaret', 'Hughes', '1938-05-02', '101'], ['Arthur', 'Pinto', '1935-11-23', '102'], ['Eileen', 'Walsh', '1940-01-14', '103'],
  ['George', 'Papadopoulos', '1936-08-30', '104'], ['Joan', 'McKenzie', '1942-03-09', '105'], ['Harold', 'Singh', '1939-12-01', '106'],
  ['Beryl', 'Fitzgerald', '1937-07-19', '107'], ['Walter', 'Chen', '1934-10-05', '108'], ['Nancy', 'Dimitriou', '1941-04-27', '109'],
  ['Ronald', 'Taylor', '1938-09-16', '110'], ['Irene', 'Kozak', '1940-06-11', '201'], ['Frank', 'Moretti', '1936-02-28', '202'],
  ['Phyllis', 'Abbott', '1943-12-20', '203'], ['Leonard', 'Wong', '1937-03-03', '204'], ['Doris', 'Nikolaidis', '1939-05-25', '205'],
  ['Stanley', 'Rowe', '1935-09-09', '206'], ['Violet', 'Santos', '1941-08-08', '207'], ['Cyril', 'Jenkins', '1938-01-30', '208'],
  ['Edna', 'Barakat', '1942-10-17', '209'], ['Kenneth', 'Ng', '1936-06-06', '210'],
];
ids.residents = [];
let homeProvId = null;
for (let i = 0; i < names.length; i++) {
  const [fn, ln, dob, room] = names[i];
  // The first resident is created after the facility is filed so the rest can link to it.
  if (i === 0) {
    const first = await profile(manT, { kind: 'person', first_name: fn, last_name: ln, date_of_birth: dob, owner_relationship: 'resident', current_phase: 'residential_ongoing' });
    const fac = await provider(manT, first.id, { provider_type: 'Aged care home', name: 'Sunnybrook Aged Care', phone: '03 9555 0100', email: 'admin@sunnybrook.example', address_line1: '88 Elm Road', address_suburb: 'Glen Waverley', address_state: 'VIC', address_postcode: '3150' });
    homeProvId = fac?.id;
    await call('PATCH', `/care-profiles/${first.id}`, manT, { residence_type: 'care_facility', residence_provider_id: homeProvId, room_number: room, contact_kind: 'contact', contact_name: 'Helen Hughes', contact_relationship: 'Daughter', contact_phone: '0417 555 101', contact_phone_type: 'mobile' });
    ids.residents.push(first.id);
    continue;
  }
  const r = await profile(manT, { kind: 'person', first_name: fn, last_name: ln, date_of_birth: dob, owner_relationship: 'resident', current_phase: 'residential_ongoing', residence_type: 'care_facility', residence_provider_id: homeProvId, room_number: room, contact_kind: 'contact', contact_name: `${['Anne', 'Paul', 'Susan', 'David', 'Mary'][i % 5]} ${ln}`, contact_relationship: ['Daughter', 'Son', 'Wife', 'Niece'][i % 4], contact_phone: `0418 555 ${String(100 + i).padStart(3, '0')}`, contact_phone_type: 'mobile' });
  ids.residents.push(r.id);
}
const R = ids.residents;
// Give the first ten residents real clinical data; the rest get a GP and a medication.
for (let i = 0; i < R.length; i++) {
  const gp = await provider(manT, R[i], { provider_type: 'GP', name: i % 2 ? 'Dr Wei Zhang' : 'Dr Rachel Cohen', phone: i % 2 ? '03 9560 4411' : '03 9560 4422', practice_name: 'Glen Waverley Medical' });
  await med(manT, R[i], { name: 'Paracetamol', dose_amount: '665', dose_unit: 'mg', form: 'Tablet', route: 'Oral', schedule_times: ['08:00', '14:00', '20:00'], supply: 90, supply_remaining: i === 3 ? 0 : 40 });
  await med(manT, R[i], { name: i % 3 ? 'Aspirin' : 'Frusemide', dose_amount: i % 3 ? '100' : '40', dose_unit: 'mg', form: 'Tablet', route: 'Oral', schedule_times: ['08:00'], supply: 30, supply_remaining: i === 5 ? 2 : 20 });
  if (i < 10) await med(manT, R[i], { name: 'Endone', dose_amount: '5', dose_unit: 'mg', form: 'Tablet', route: 'Oral', as_needed: true, supply: 20, supply_remaining: 12, instructions: 'For breakthrough pain. Minimum 4 hours between doses.' });
  if (i < 6) await allergy(manT, R[i], { substance: ['Penicillin', 'Latex', 'Codeine', 'Aspirin', 'Shellfish', 'Sulfa drugs'][i], reaction: 'Rash' });
  if (i < 6) await condition(manT, R[i], { name: ['Dementia', 'Heart failure', 'COPD', 'Parkinsons disease', 'Osteoarthritis', 'Type 2 diabetes'][i], status: 'managed' });
  await appt(manT, R[i], { title: 'GP round', appointment_type: 'consultation', provider_id: gp.id, starts_at: at(1 + (i % 9), 10) });
  if (i < 5) await task(manT, R[i], { title: 'Review care plan', reminder_type: 'once', next_due_at: at(3 + i) });
  // Wave 4: a dose due half an hour ago, whenever the bench runs, so the
  // medicine round and Before you start always have something due now.
  if (i < 7) {
    const due = new Date(Date.now() - 30 * 60000);
    const hm = `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`;
    await med(manT, R[i], { name: 'Vitamin D', dose_amount: '1000', dose_unit: 'IU', form: 'Capsule', route: 'Oral', schedule_times: [hm], with_food: true, supply: 30, supply_remaining: 25, instructions: 'Swallow whole with a meal.' });
  }
}
// Wave 4: Margaret's pharmacy, so a medicine not in stock says who to call.
await provider(manT, R[0], { provider_type: 'Pharmacy', name: 'Glen Waverley Pharmacy', phone: '03 9560 1000', email: 'orders@gwpharmacy.example' });
await logEntry(manT, R[0], { entry_type: 'handover', title: 'Evening handover', body: 'Margaret refused her 8pm tablets. Daughter Helen rang at 7pm. Skin check due.' });
// Wave 4: how Margaret eats, moves and talks, for the Before you start card.
await call('PUT', `/care-profiles/${R[0]}/plan`, manT, { dietary_requirements: ['Soft diet', 'Thickened fluids'], mobility_aids: ['Walking frame'], communication_needs: ['Hard of hearing, speak clearly on her left side'], advance_care_directive: true, advance_care_directive_location: 'Nurses station, top drawer' });
await upload(manT, R[0], 'Advance care directive', 'Advance care directive', 'Advance care directive for Margaret Hughes. Not for resuscitation.');

// 5. Support worker --------------------------------------------------------
console.log('Support worker');
const wkT = await register('worker@bench.test', 'Jess', 'Carter');
async function invite(ownerT, pid, role) {
  const r = await call('POST', `/care-profiles/${pid}/circle`, ownerT, { invited_email: 'worker@bench.test', display_name: 'Jess Carter', role, permission: 'contributor' });
  const url = r.invite_url ?? '';
  const token = url.split('/').filter(Boolean).pop();
  if (token) await call('POST', `/invitations/${token}/accept`, wkT, {});
  return r;
}
await invite(dauT, mum.id, 'carer');
for (const rid of R.slice(0, 6)) await invite(manT, rid, 'carer');

// 6. Set the home manager to the professional plan, ordinary user role -----
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://parecare:parecare@127.0.0.1:5433/parecare' });
await c.connect();
await c.query("update accounts set subscription_tier='professional' where email='manager@bench.test'");
const { rows } = await c.query("select email, subscription_tier, role from accounts where email like '%@bench.test' order by email");
console.table(rows);
await c.end();

fs.writeFileSync(path.join(here, 'seed-ids.json'), JSON.stringify(ids, null, 2));
console.log('Seed done. Ids in seed-ids.json (gitignored).');
