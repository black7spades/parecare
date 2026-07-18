import type { NarrativeSources, PlanContent } from './carePlanUpdater';

/**
 * Composes a care plan version as a prose clinical report: the same data
 * structure written as a narrative document a nurse would hand over, not
 * a list of data points. When an AI provider is configured it writes the
 * report under strict editorial rules; otherwise a deterministic prose
 * fallback applies the mechanical rules so the report always exists.
 *
 * The report is plain text with a light markdown subset: '###' section
 * headers, '####' subheaders, '*' bullets and '**bold**'. The first four
 * lines are always the title block:
 *
 *   Care Plan
 *   [Full name]
 *   Version [n]
 *   [MonthName DD, YYYY]
 */

export interface ReportInput {
  profileName: string;
  version: number;
  createdAt: Date;
  content: PlanContent;
  sources: NarrativeSources;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const longDate = (d: Date): string => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

/** Sentence case for condition names: lower case unless it looks like an acronym. */
const sentenceCase = (name: string): string =>
  name
    .split(' ')
    .map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase()))
    .join(' ');

const titleBlock = (input: ReportInput): string =>
  `Care Plan\n${input.profileName}\nVersion ${input.version}\n${longDate(input.createdAt)}`;

/** True when an acute illness is prose-worthy: unresolved after two weeks. */
function acuteWorthMentioning(c: NarrativeSources['conditions'][number]): boolean {
  if (c.resolved_on || c.status === 'resolved') return false;
  if (!c.started_on) return true;
  const started = new Date(c.started_on).getTime();
  return Date.now() - started > 14 * 24 * 60 * 60 * 1000;
}

const isAcute = (c: NarrativeSources['conditions'][number]): boolean =>
  c.condition_type === 'acute' || c.category === 'acute_illness' || c.category === 'illness' || c.category === 'chronic_flare';

const dose = (m: NarrativeSources['medications'][number]): string =>
  [m.dose_amount, m.dose_unit].filter(Boolean).join(' ');

const providerTypeText = (t: string | null): string => {
  if (!t) return 'Provider';
  if (t === 'gp') return 'GP';
  return t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
};

/**
 * The deterministic prose report. It applies the mechanical editorial
 * rules (title block, acute illness horizon, treatments only in the
 * context of what they are for, sentence case conditions, provider
 * contact details, no invented neurodivergence guidance) and leaves the
 * finer clinical judgement to the configured model when there is one.
 */
export function fallbackReport(input: ReportInput): string {
  const s = input.sources;
  const first = s.name.split(' ').filter((w) => !/^(mr|mrs|ms|miss|dr|mx)\.?$/i.test(w))[0] ?? s.name;
  const lines: string[] = [titleBlock(input), ''];

  const live = s.conditions.filter((c) => c.status !== 'resolved' && !c.resolved_on);
  const mentionable = live.filter((c) => !isAcute(c) || acuteWorthMentioning(c));
  const neurotypes = live.filter((c) => c.category === 'neurotype');

  // Goals and preferences
  lines.push('### Goals and preferences');
  const goalEntries = input.content.sections['goals'] ?? [];
  const goalTexts = goalEntries.map((g) => String(g.fields['goal'] ?? '')).filter(Boolean);
  const goalSentence =
    goalTexts.length > 0
      ? `The chief aim for ${s.name} is maintaining functional independence and overall wellbeing. Specific objectives are to ${goalTexts
          .map((g) => g.replace(/^./, (c) => c.toLowerCase()))
          .join(', ')}.`
      : `The chief aim for ${s.name} is maintaining functional independence and overall wellbeing.`;
  const dietSentence =
    s.dietary_requirements.length > 0
      ? ` ${first} keeps to a ${s.dietary_requirements.map((d) => d.toLowerCase()).join(' and ')} diet, and services supporting them must respect that.`
      : '';
  lines.push(goalSentence + dietSentence, '');

  // Conditions
  if (mentionable.length > 0) {
    lines.push('### Conditions');
    const parts: string[] = [];
    for (const c of mentionable) {
      if (c.category === 'neurotype') continue; // handled in their own paragraph below
      const bits = [sentenceCase(c.name)];
      const qualifiers = [c.condition_type, c.severity ? `${c.severity} severity` : null, c.status]
        .filter(Boolean)
        .join(', ');
      parts.push(qualifiers ? `${bits[0]} (${qualifiers})` : bits[0]);
    }
    if (parts.length > 0) {
      lines.push(
        `${s.name} is currently managing ${parts.join('; ')}. Each is addressed in the strategies below.`
      );
    }
    lines.push('');
  }

  // Neurodivergence is intrinsic, not a condition. It gets its own section,
  // described as accommodations and drawn only from the recorded traits, needs
  // and supports, and is never framed as something to manage or monitor.
  if (neurotypes.length > 0) {
    lines.push('### Neurodivergence and how to support it');
    for (const n of neurotypes) {
      const attrs = s.neurotype_attributes.filter((a) => a.neurotype === n.name);
      const needs = attrs.filter((a) => a.kind === 'need').map((a) => a.label.toLowerCase());
      const supports = attrs.filter((a) => a.kind === 'support').map((a) => a.label.toLowerCase());
      const diag = n.diagnosis_status === 'formal'
        ? `${first} has a formal diagnosis of ${sentenceCase(n.name)}.`
        : `${first} identifies with ${sentenceCase(n.name)}${n.diagnosis_status ? ` (${n.diagnosis_status.replace(/_/g, ' ')})` : ''}.`;
      let detail: string;
      if (needs.length > 0 || supports.length > 0) {
        const bits: string[] = [];
        if (needs.length > 0) bits.push(`meeting their needs (${needs.join('; ')})`);
        if (supports.length > 0) bits.push(`putting in place what helps (${supports.join('; ')})`);
        detail = ` Support ${first}'s sensory, cognitive and social needs by ${bits.join(', and ')}.`;
      } else {
        detail = ` No traits, needs or supports are recorded yet; ask ${first} what helps day to day and record it on the Neurotypes page so this plan can be specific to them.`;
      }
      lines.push(`${diag} This is an intrinsic part of who ${first} is, to be accommodated rather than treated or monitored.${detail}`);
    }
    lines.push('');
  }

  // Care strategies, each written as an instruction: the aim, then the
  // step-by-step method a carer follows to carry it out.
  const strategyEntries = input.content.sections['strategies'] ?? [];
  if (strategyEntries.length > 0) {
    lines.push('### Care strategies and how to carry them out');
    for (const e of strategyEntries) {
      const condition = e.fields['condition'] ? sentenceCase(String(e.fields['condition'])) : null;
      const strategy = String(e.fields['strategy'] ?? '').replace(/\.+$/, '');
      const supported = e.fields['supported_by'] ? ` This is supported by ${String(e.fields['supported_by']).toLowerCase()}.` : '';
      lines.push(condition ? `**${condition}:** ${strategy}.${supported}` : `${strategy}.${supported}`);
      const method = String(e.fields['method'] ?? '').trim();
      if (method) {
        lines.push('How to carry it out:');
        for (const step of method.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
          // Keep any existing "1." numbering; otherwise bullet it.
          lines.push(/^\d+[.)]/.test(step) ? step : `- ${step}`);
        }
      }
      lines.push('');
    }
  }

  // Medications, each in the context of what it is for
  const activeMeds = s.medications.filter((m) => m.active);
  if (activeMeds.length > 0) {
    lines.push('### Medications');
    lines.push(`${first} is on a regimen of ${activeMeds.length} ${activeMeds.length === 1 ? 'medication' : 'medications'}:`);
    for (const m of activeMeds) {
      const when = m.as_needed ? 'taken as needed' : m.schedule_times ? `administered at ${m.schedule_times}` : m.frequency ? `taken ${m.frequency.toLowerCase()}` : 'taken as prescribed';
      const why = m.for_condition ? ` for ${sentenceCase(m.for_condition)}` : '';
      const d = dose(m);
      lines.push(`* **${m.name}${d ? ` (${d})` : ''}:** ${when}${why}.`);
    }
    lines.push('');
  }

  // Treatments only in the context of what they are for
  const purposefulTreatments = s.treatments.filter((t) => t.active && t.for_condition);
  if (purposefulTreatments.length > 0) {
    lines.push('### Treatments');
    for (const t of purposefulTreatments) {
      const when = t.as_needed ? 'as needed' : t.frequency ? t.frequency.toLowerCase() : 'as scheduled';
      lines.push(`* **${t.name}:** used ${when} to treat ${sentenceCase(t.for_condition!)}.`);
    }
    lines.push('');
  }

  // Risks
  const riskEntries = input.content.sections['risks'] ?? [];
  if (riskEntries.length > 0) {
    lines.push('### Risks and considerations');
    lines.push('The following require continuous vigilance:');
    for (const r of riskEntries) {
      const risk = String(r.fields['risk'] ?? '');
      const level = r.fields['level'] ? `${String(r.fields['level'])}-level risk` : 'risk';
      const watch = r.fields['watch_for'] ? ` Watch for: ${String(r.fields['watch_for']).toLowerCase()}.` : '';
      lines.push(`* **${risk}:** ${level}.${watch}`);
    }
    lines.push('');
  }

  // Review schedule
  const reviewEntries = input.content.sections['review'] ?? [];
  const standard = reviewEntries.find((e) => e.fields['review_type'] === 'Standard');
  const triggers = reviewEntries.filter((e) => e.fields['review_type'] === 'Triggered');
  lines.push('### Review schedule');
  const duePhrase = standard?.fields['due_by']
    ? `The standard plan review is due by ${longDate(new Date(String(standard.fields['due_by'])))}, on the 12-month cycle.`
    : 'The plan is reviewed with the participant at least once every 12 months.';
  const triggerPhrase =
    triggers.length > 0
      ? ` An immediate review is required after any of the following: ${triggers
          .map((t) => String(t.fields['trigger'] ?? '').toLowerCase())
          .filter(Boolean)
          .join('; ')}.`
      : '';
  lines.push(duePhrase + triggerPhrase, '');

  // Allergies
  if (s.allergies.length > 0) {
    lines.push('### Allergies');
    lines.push(`${s.name} is allergic to:`);
    for (const a of s.allergies) {
      lines.push(`* ${a.substance}${a.reaction ? ` (reaction: ${a.reaction.toLowerCase()})` : ''}.`);
    }
    lines.push('');
  }

  // Needs and contacts, providers with their contact details
  lines.push('### Day-to-day needs and contacts');
  const needs = [
    ...s.dietary_requirements.map((d) => `strict adherence to a ${d.toLowerCase()} intake`),
    ...s.mobility_aids.map((m) => `use of the ${m.toLowerCase()}`),
    ...s.communication_needs.map((c) => c.toLowerCase()),
  ];
  if (needs.length > 0) {
    lines.push(`Essential daily requirements: ${needs.join('; ')}.`);
  }
  if (s.providers.length > 0) {
    lines.push('', '#### Providers');
    for (const p of s.providers) {
      const contact = [p.phone ? `Phone: ${p.phone}` : null, p.email ? `Email: ${p.email}` : null]
        .filter(Boolean)
        .join('; ');
      lines.push(
        `* **${providerTypeText(p.provider_type)}:** ${p.name}${p.organisation ? ` at ${p.organisation}` : ''}${contact ? ` (${contact})` : ' (no contact details on record)'}.`
      );
    }
  }
  if (s.emergency_contacts.length > 0) {
    lines.push('', '#### Emergency contacts');
    for (const c of s.emergency_contacts) {
      lines.push(`* ${c.name}${c.relationship ? ` (${c.relationship.toLowerCase()})` : ''}${c.phone ? ` is available at ${c.phone}` : ''}.`);
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The plan editor writes the report when a model is configured. The
 * output must be the finished document, nothing else; anything that does
 * not look like one falls back to the deterministic report.
 */
export async function composeReport(input: ReportInput): Promise<string> {
  const fallback = fallbackReport(input);
  try {
    const { isAiConfigured, complete } = await import('./aiProvider');
    if (!isAiConfigured()) return fallback;
    const system =
      'You are an experienced nurse of more than 20 years writing a clinical care plan document for a ' +
      'care coordination platform. Convert the supplied structured care plan data into a prose report ' +
      'with the same underlying structure. Editorial rules, follow all of them exactly: ' +
      '1) Do not say what the document is. Start with this title block on four plain lines, nothing ' +
      'before it: "Care Plan" / the full name / "Version N" / the date as MonthName DD, YYYY. ' +
      '2) Then write the rest under "###" headers and "####" subheaders with substantial paragraphs; ' +
      'use "*" bullets for medications, risks, allergies, providers and contacts, with "**bold**" lead-ins. ' +
      '3) Be smart clinically. If the person is allergic to a substance but the condition it would have ' +
      'treated is managed with a different medication, do not raise that allergy as something to watch; ' +
      'still list it under Allergies. ' +
      '4) Do not mention acute illnesses unless they have gone on for more than two weeks and are ' +
      'unresolved. ' +
      '5) Use sentence case for condition names, never proper-noun capitals. ' +
      '6) Mention each treatment only in the context of what it is for; a treatment with no purpose ' +
      'stated in the data is left out of the prose. ' +
      '7) Mention each medication with its dose and time in the context of what it manages. ' +
      '8) Providers must include their contact information, not just names. ' +
      '9) NEURODIVERGENCE (autism, ADHD, dyslexia and so on) is intrinsic to who the person is, like eye ' +
      'colour, and is never a condition to manage, monitor, treat or cure. Never write "manage <neurotype>", ' +
      'never say a neurotype is "currently active", and never list a neurotype among conditions or risks. ' +
      'Give it its own short paragraph about accommodating the sensory, cognitive and social needs, drawing ' +
      'ONLY on the recorded traits, needs and supports (neurotype_attributes); if none are recorded, say to ' +
      'ask the person and record them. State a formal diagnosis plainly if there is one; assume nothing when ' +
      'there is not. The aim is accommodation, never changing the person. ' +
      '10) Never invent facts that are not in the data; every statement must trace to a supplied field. A ' +
      'dietary requirement (e.g. low salt) is its own day-to-day need, not a universal support: never say a ' +
      'condition is "supported by" a diet unless the diet is clinically relevant to that condition (low salt ' +
      'supports blood pressure, not depression, dry eyes, a cold or a neurotype). Under care strategies, ' +
      "include each strategy's step-by-step method from the data so the plan reads as an instruction manual, " +
      'not a one-line summary, and do not repeat an identical sentence shape for every condition. ' +
      '11) ' +
      (input.sources.self_managed
        ? `This is ${input.sources.display_name}'s own plan; they manage their own care and read this themselves. Address them directly as "you" throughout ("Take Amlodipine 5mg with breakfast", "Book your physio when the pain flares"). Never write as if a carer is watching over them, and never tell them to report to or seek permission from anyone.`
        : `${input.sources.display_name} is cared for by others who read this plan; write for those carers, referring to ${input.sources.display_name} by name.`) +
      ' Keep the tone proportionate to what the record shows: do not imply crisis or constant vigilance for stable or routine matters. ' +
      'Sections to cover when data exists: goals and preferences; conditions; care strategies and ' +
      'interventions; medications; treatments; risks and considerations; review schedule; allergies; ' +
      'day-to-day needs and contacts. Return ONLY the document text.';
    const user = JSON.stringify({
      full_name: input.sources.name,
      version: input.version,
      date: longDate(input.createdAt),
      plan_content: input.content,
      record: input.sources,
    });
    const result = await complete(system, [{ role: 'user', content: user }], 8192, 'mediation');
    const text = result.text.trim();
    const looksRight =
      text.startsWith('Care Plan') && text.includes(`Version ${input.version}`) && text.length > 400 && !text.startsWith('{');
    return looksRight ? text : fallback;
  } catch (err) {
    console.warn('Care plan report composition failed, using deterministic report:', (err as Error).message);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Rendering the markdown subset

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const inlineHtml = (s: string): string =>
  escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

/** Renders the report's markdown subset as HTML for the stored document. */
export function reportToHtml(report: string): string {
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  const lines = report.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (line.startsWith('#### ')) {
      closeList();
      out.push(`<h3>${inlineHtml(line.slice(5))}</h3>`);
    } else if (line.startsWith('### ')) {
      closeList();
      out.push(`<h2>${inlineHtml(line.slice(4))}</h2>`);
    } else if (line.startsWith('* ') || line.startsWith('- ')) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inlineHtml(line.slice(2))}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      // The four title-block lines render as the document masthead.
      if (i === 0 && line === 'Care Plan') out.push(`<h1>${inlineHtml(line)}</h1>`);
      else if (i > 0 && i < 4) out.push(`<p class="masthead">${inlineHtml(line)}</p>`);
      else out.push(`<p>${inlineHtml(line)}</p>`);
    }
  });
  closeList();
  return out.join('\n');
}
