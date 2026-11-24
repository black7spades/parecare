import { useRoundNotice, type TaskRound } from '../lib/taskRounds';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from '../lib/dateFormat';
import { api } from '../api/client';
import { browserTimeZone } from '../lib/datetime';
import { DETAIL_HINTS, QUICK_STEP_KEYS, useNextStepTypes, type NextStep } from '../lib/nextSteps';
import { CatalogueCombo } from './CatalogueCombo';
import { EditNextStepsModal } from './EditNextStepsModal';
import { Button } from './ui/Button';
import { Input, Textarea } from './ui/Input';
import { Modal } from './ui/Modal';
import { NotePicker, pickedItems, useForwardCandidates, type PickState, type SentForward } from './ForwardNotes';
import { ContactPicker, contactProblem, emptyContact, type PickedContact } from './ContactPicker';
import type { AppointmentQuestion } from '../lib/care';
import { ContactStrip, CONTACT_LINK } from './ContactStrip';
import { JoinedNotice, type JoinedInfo } from '../pages/app/profile/TaskEditor';
import { addressFrom } from './AddressFields';
import { Link } from 'react-router-dom';
import { noticeFiled, refreshContacts } from '../stores/notice';
import {
  AppointmentFields,
  appointmentBody,
  appointmentDraftErrors,
  draftIsBookable,
  kindForStep,
  missingSentence,
  newAppointmentDraft,
  type AppointmentDraft,
} from '../pages/app/profile/AppointmentsPage';

export interface OutcomeAppointment {
  id: string;
  title: string;
  starts_at: string | null;
  provider_name: string | null;
  provider_id: string | null;
  location: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  address_suburb?: string | null;
  address_state?: string | null;
  address_postcode?: string | null;
  address_country?: string | null;
  directions_link?: string | null;
  medical_condition_id: string | null;
  notes: string | null;
  outcome?: string | null;
  next_steps?: NextStep[];
  forwarded?: SentForward[];
  /** Questions to ask at this visit. */
  questions?: AppointmentQuestion[];
}

interface DraftStep {
  key: number;
  type: string;
  systemKey: string | null;
  /** Done by booking another appointment, so it can be booked and sent notes here. */
  books: boolean;
  details: string;
  dueOn: string;
  /** Who it is with, such as who a referral is to: from Contacts, or a new name filed there. */
  who: PickedContact;
  /** Booking it now, right here, with the same fields as Add appointment. */
  booking: AppointmentDraft | null;
  /** Pieces of this visit to send with it. */
  send: PickState;
  /** Whether a piece nobody has ticked or unticked yet goes: yes for a referral. */
  sendDefault: boolean;
}

const inDays = (n: number) => format(new Date(Date.now() + n * 24 * 3600 * 1000), 'yyyy-MM-dd');

/**
 * How an appointment went: what happened, and what came out of it. Each next
 * step is its own kind, details and date, and becomes a task when saved, so
 * it is tracked and nudged until it is done. Steps already recorded show with
 * where they stand, and one that needs booking can be booked from here.
 */
export function OutcomeModal({
  profileId,
  appointment,
  canEdit,
  isOwner,
  onClose,
  onBook,
  onAddMedication,
  onUpload,
  onAddDate,
  onAddEquipment,
}: {
  profileId: string;
  appointment: OutcomeAppointment;
  canEdit: boolean;
  isOwner: boolean;
  onClose: () => void;
  /** Book the appointment a next step calls for. */
  onBook: (step: NextStep) => void;
  /** Put a prescribed medication on the list. */
  onAddMedication: (step: NextStep) => void;
  /** Upload the document a next step is about. */
  onUpload: (step: NextStep) => void;
  /** Give a saved, not-yet-booked appointment its date. */
  onAddDate: (appointmentId: string) => void;
  /** File the equipment an "Equipment to get" step is for; saving it ticks the step. */
  onAddEquipment?: (step: NextStep) => void;
}) {
  const queryClient = useQueryClient();
  const { data } = useNextStepTypes(profileId);
  const types = data?.types ?? [];
  const quick = QUICK_STEP_KEYS.map((k) => types.find((t) => t.system_key === k)).filter((t): t is NonNullable<typeof t> => !!t);

  const [outcome, setOutcome] = useState(appointment.outcome ?? '');
  // What they said to each question brought to the visit.
  const openQuestions = (appointment.questions ?? []).filter((q) => q.status === 'open');
  const answeredQuestions = (appointment.questions ?? []).filter((q) => q.status === 'resolved' && q.resolution);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const answered = Object.entries(answers).filter(([, a]) => a.trim());
  const [drafts, setDrafts] = useState<DraftStep[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [comboKey, setComboKey] = useState(0);
  const [editingList, setEditingList] = useState(false);
  const [error, setError] = useState('');
  // What still needs filling in, named once Save has been tried.
  const [tried, setTried] = useState(false);
  // Steps that joined an open task for the same booking, with the way to keep them apart.
  const [joined, setJoined] = useState<Array<{ info: JoinedInfo; create: Record<string, unknown> }>>([]);
  const existing = appointment.next_steps ?? [];
  const candidates = useForwardCandidates(profileId, appointment, outcome);

  const addDraft = (name: string) => {
    const t = types.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    // A referral goes to someone new, so everything noted today goes with it
    // unless unticked. Other steps send nothing unless ticked.
    const sendAll = t?.system_key === 'referral';
    setDrafts((d) => [
      ...d,
      {
        key: nextKey,
        type: t?.name ?? name.trim(),
        systemKey: t?.system_key ?? null,
        books: !!t?.books,
        details: '',
        dueOn: inDays(7),
        // A follow-up is usually with the same person.
        who:
          t?.system_key === 'follow_up' && appointment.provider_id
            ? { ...emptyContact, providerId: appointment.provider_id, name: appointment.provider_name ?? '' }
            : emptyContact,
        booking: null,
        send: {},
        sendDefault: sendAll,
      },
    ]);
    setNextKey((k) => k + 1);
  };

  // Booking starts with who the step is with; a follow-up with the same
  // person also starts at the same place.
  const startBooking = (d: DraftStep) =>
    updateDraft(d.key, {
      booking: newAppointmentDraft({
        title: d.details.trim() || (d.who.name.trim() ? `See ${d.who.name.trim()}` : d.type),
        type: kindForStep(d.type),
        conditionId: appointment.medical_condition_id ?? '',
        providerId: d.who.providerId,
        newProviderName: d.who.providerId ? '' : d.who.name.trim(),
        newProviderType: d.who.providerId ? '' : d.who.providerType,
        providerPhone: d.who.phone,
        ...(d.systemKey === 'follow_up' && d.who.providerId === (appointment.provider_id ?? '')
          ? { address: addressFrom(appointment), directionsLink: appointment.directions_link ?? '' }
          : {}),
      }),
    });
  const picksFor = (d: DraftStep): PickState =>
    Object.fromEntries(candidates.map((c) => [c.key, d.send[c.key] ?? { on: d.sendDefault }]));
  // A booking here can wait for its date, so only what it is for is needed.
  const unfinished = drafts.filter((d) => d.booking && !draftIsBookable(d.booking, false));
  const nothingToSave = !outcome.trim() && drafts.length === 0 && answered.length === 0 && !(appointment.outcome ?? '');
  // A part of a name never files a contact on its own.
  const unpicked = drafts.map((d) => (d.books ? contactProblem(d.who, `who the ${d.type.toLowerCase()} is with`) : null));
  const firstUnpicked = unpicked.findIndex((u) => !!u);
  // Every reason Save cannot go yet, in words, so nobody is left guessing.
  const problems = [
    ...unfinished.map((d) =>
      `${missingSentence(appointmentDraftErrors(d.booking!, false), `The booking for ${d.who.name.trim() || d.type}`)} Add it, or choose Not now.`
    ),
    ...unpicked.filter((u): u is string => !!u),
    ...(nothingToSave ? ['Write what happened, answer a question, or add a next step, then save.'] : []),
  ];
  const trySave = () => {
    setTried(true);
    setError('');
    if (problems.length === 0) {
      save.mutate();
      return;
    }
    // Take them to the first box that needs filling.
    const first = unfinished[0];
    if (first?.booking) {
      const missing = appointmentDraftErrors(first.booking, false);
      const el = document.getElementById(`book-${first.key}-${missing.title ? 'title' : 'date'}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    } else if (firstUnpicked >= 0) {
      document.getElementById(`who-${drafts[firstUnpicked]!.key}`)?.focus();
    } else if (nothingToSave) {
      document.getElementById('outcome-what-happened')?.focus();
    }
  };
  const updateDraft = (key: number, patch: Partial<DraftStep>) =>
    setDrafts((d) => d.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['appointments', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['tasks', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['next-step-types', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['questions', profileId] });
    refreshContacts(queryClient);
  };

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.put<{
        created: string[];
        filed?: Array<{ id: string; name: string }>;
        joined?: Array<{ into_id: string; into_title: string; name: string | null; previous: Record<string, unknown>; note_id: string | null; document_ids: string[]; step: Record<string, unknown> }>;
      }>(`/care-profiles/${profileId}/appointments/${appointment.id}/outcome`, {
        outcome: outcome.trim() || null,
        next_steps: drafts.map((d) => ({
          type: d.type,
          details: d.details.trim() || null,
          due_on: d.dueOn || null,
          ...(d.books && d.who.providerId
            ? { provider_id: d.who.providerId, provider_phone: d.who.phone.trim() || null }
            : d.books && d.who.name.trim()
              ? { provider_name: d.who.name.trim(), provider_type: d.who.providerType || null, provider_phone: d.who.phone.trim() || null }
              : {}),
          forward: d.books ? pickedItems(candidates, picksFor(d)) : [],
        })),
        answers: answered.map(([question_id, answer]) => ({ question_id, answer: answer.trim() })),
        tz: browserTimeZone() ?? null,
      });
      // Book what was booked here. Each booking ticks its step off and
      // brings the notes sent with it.
      const failed: string[] = [];
      const filed = [...(res.filed ?? [])];
      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i];
        const stepId = res.created[i];
        if (!d.booking || !stepId) continue;
        try {
          const booked = await api.post<{ filed?: Array<{ id: string; name: string }> }>(`/care-profiles/${profileId}/appointments`, appointmentBody(d.booking, stepId));
          for (const f of booked.filed ?? []) if (!filed.some((x) => x.id === f.id)) filed.push(f);
        } catch (err) {
          const why = err instanceof Error && err.message ? ` (${err.message.replace(/\.$/, '')})` : '';
          failed.push(`${d.booking.title.trim() || d.type}${why}`);
        }
      }
      noticeFiled(profileId, filed);
      return { failed, joined: res.joined ?? [] };
    },
    onSuccess: ({ failed, joined: joins }) => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['calendar', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['record-extras', profileId] });
      if (joins.length > 0) {
        // Say what joined, and keep the window open so they can be kept apart.
        setDrafts([]);
        setJoined(joins.map((j) => ({
          info: { id: j.into_id, title: j.into_title, name: j.name, previous: j.previous, note_id: j.note_id, document_ids: j.document_ids },
          create: { ...j.step, no_infer: true },
        })));
      }
      if (failed.length === 0) {
        if (joins.length === 0) onClose();
        return;
      }
      // How it went is saved; only the booking needs another go.
      setDrafts([]);
      setError(
        `How it went is saved, but booking ${failed.join(' and ')} did not go through. Use Book it next to it below to try again. Any notes sent with it are waiting there.`
      );
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The outcome did not save. Check your connection and try again.'),
  });

  const roundNotice = useRoundNotice(profileId);
  const markDone = useMutation({
    mutationFn: (step: NextStep) => api.patch<{ round?: TaskRound | null }>(`/care-profiles/${profileId}/reminders/${step.id}`, { completed: true }),
    onSuccess: (res) => {
      roundNotice(res?.round);
      refresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not mark it done.'),
  });

  const heading = appointment.provider_name ? `${appointment.title} with ${appointment.provider_name}` : appointment.title;

  return (
    <Modal open onClose={onClose} title="How did it go?" wide>
      <div className="space-y-5">
        <p className="text-sm text-muted">
          {heading}{appointment.starts_at ? `, ${format(new Date(appointment.starts_at), 'EEE d MMM yyyy, HH:mm')}` : ''}
        </p>

        <Textarea
          id="outcome-what-happened"
          label="What happened"
          placeholder="e.g. Ankle is sprained, not broken. Rest for two weeks."
          rows={3}
          value={outcome}
          disabled={!canEdit}
          onChange={(e) => setOutcome(e.target.value)}
        />

        {openQuestions.length > 0 || answeredQuestions.length > 0 ? (
          <div>
            <p className="text-sm font-medium text-ink mb-2">Questions to ask</p>
            <ul className="space-y-3">
              {answeredQuestions.map((q) => (
                <li key={q.id} className="rounded-md border border-border px-3 py-2">
                  <p className="text-sm text-ink">{q.title}</p>
                  <p className="text-xs text-muted">They said: {q.resolution}</p>
                </li>
              ))}
              {openQuestions.map((q) => (
                <li key={q.id} className="rounded-md border border-border px-3 py-2 space-y-1">
                  <p className="text-sm text-ink">{q.title}</p>
                  {q.ask ? <p className="text-xs text-muted">To ask {q.ask.name}</p> : null}
                  <Textarea
                    id={`answer-${q.id}`}
                    label="What did they say?"
                    aria-label={`What did they say to: ${q.title}`}
                    hint="Saving this marks the question answered."
                    rows={2}
                    disabled={!canEdit}
                    value={answers[q.id] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {existing.length > 0 ? (
          <div>
            <p className="text-sm font-medium text-ink mb-2">Next steps so far</p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {existing.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  {/* The words themselves book it, wherever they appear. */}
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm text-ink break-words ${s.completed ? 'line-through' : ''}`}>{s.title}</p>
                    <p className="text-xs text-muted">
                      {s.type_name}
                    </p>
                    {s.provider ? (
                      <div className="mt-1">
                        <ContactStrip contact={s.provider} size="compact" book={false} />
                      </div>
                    ) : s.provider_id && s.provider_name ? (
                      <Link to={`/app/${profileId}/providers?record=${s.provider_id}`} className={`${CONTACT_LINK} text-xs`}>
                        {s.provider_name}
                      </Link>
                    ) : null}
                  </div>
                  {s.led_to && !s.led_to.starts_at && s.led_to.status !== 'cancelled' && canEdit && !s.completed ? (
                    <Button size="xs" variant="ghost" className="whitespace-nowrap" onClick={() => onAddDate(s.led_to!.id)}>
                      Not booked yet, book it
                    </Button>
                  ) : null}
                  <span className="text-xs text-muted whitespace-nowrap">
                    {s.led_to
                      ? s.led_to.starts_at
                        ? `Booked for ${format(new Date(s.led_to.starts_at), 'd MMM')}`
                        : s.led_to.status === 'cancelled'
                          ? 'Cancelled'
                          : null
                      : s.completed
                        ? `Done${s.completed_at ? ` ${format(new Date(s.completed_at), 'd MMM')}` : ''}`
                        : `Due ${format(new Date(s.next_due_at), 'd MMM')}`}
                  </span>
                  {canEdit && !s.completed && s.led_to && !s.led_to.starts_at && s.led_to.status !== 'cancelled' ? (
                    <span className="flex gap-1">
                      <Button size="xs" variant="secondary" onClick={() => onAddDate(s.led_to!.id)}>Book it</Button>
                    </span>
                  ) : canEdit && !s.completed ? (
                    <span className="flex gap-1">
                      {s.books ? (
                        <Button size="xs" variant="secondary" onClick={() => onBook(s)}>Book it</Button>
                      ) : null}
                      {s.type_key === 'prescription' ? (
                        <Button size="xs" variant="secondary" onClick={() => onAddMedication(s)}>Add to medications</Button>
                      ) : null}
                      {s.type_key === 'document' || s.type_key === 'certificate' || s.type_key === 'form' ? (
                        <Button size="xs" variant="secondary" onClick={() => onUpload(s)}>Upload</Button>
                      ) : null}
                      {s.type_key === 'equipment' && onAddEquipment ? (
                        <Button size="xs" variant="secondary" onClick={() => onAddEquipment(s)}>Add to equipment</Button>
                      ) : null}
                      <Button size="xs" variant="ghost" loading={markDone.isPending && markDone.variables?.id === s.id} onClick={() => markDone.mutate(s)}>
                        Done
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {canEdit ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-ink">{existing.length > 0 ? 'Add more next steps' : 'What came out of it'}</p>
              {isOwner ? (
                <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setEditingList(true)}>Edit the list</Button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {quick.map((t) => (
                <Button key={t.id} size="xs" variant="secondary" onClick={() => addDraft(t.name)}>
                  + {t.name}
                </Button>
              ))}
            </div>
            <div className="max-w-sm">
              <CatalogueCombo
                key={comboKey}
                id="outcome-other-step"
                ariaLabel="Something else"
                placeholder="Something else, e.g. semen sample"
                extraItems={types.map((t) => t.name)}
                widthClass="w-full"
                newLabel={(name) => `+ Add "${name}" as a new kind of next step`}
                onPick={(name) => { if (name.trim()) addDraft(name); setComboKey((k) => k + 1); }}
              />
            </div>

            {drafts.length > 0 ? (
              <ul className="space-y-3">
                {drafts.map((d) => (
                  <li key={d.key} className="rounded-md border border-border p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-sm font-medium text-ink flex-1 break-words">{d.type}</p>
                      <Button
                        size="xs"
                        variant="ghost"
                        aria-label={`Remove ${d.type}`}
                        title="Remove"
                        onClick={() => setDrafts((all) => all.filter((x) => x.key !== d.key))}
                      >
                        ✕
                      </Button>
                    </div>
                    {d.books ? (
                      <div className="mb-3">
                        <ContactPicker
                          id={`who-${d.key}`}
                          label={d.systemKey === 'referral' ? 'Who to' : 'Who with'}
                          profileId={profileId}
                          value={d.who}
                          onChange={(who) => updateDraft(d.key, { who })}
                        />
                      </div>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
                      <Input
                        label="Details"
                        placeholder={(d.systemKey && DETAIL_HINTS[d.systemKey]) || 'Anything to remember about it'}
                        maxLength={255}
                        value={d.details}
                        onChange={(e) => updateDraft(d.key, { details: e.target.value })}
                      />
                      {d.booking ? null : (
                        <Input
                          label="Do by"
                          type="date"
                          value={d.dueOn}
                          onChange={(e) => updateDraft(d.key, { dueOn: e.target.value })}
                        />
                      )}
                    </div>

                    {d.books ? (
                      <div className="mt-3 space-y-3">
                        {d.booking ? (
                          <div className="rounded-md border border-border p-3">
                            <div className="flex items-center gap-2 mb-3">
                              <p className="text-sm font-medium text-ink flex-1">Book it now</p>
                              <Button size="xs" variant="ghost" onClick={() => updateDraft(d.key, { booking: null })}>Not now</Button>
                            </div>
                            <AppointmentFields
                              profileId={profileId}
                              idPrefix={`book-${d.key}`}
                              value={d.booking}
                              onChange={(next) => updateDraft(d.key, { booking: next })}
                              errors={tried ? appointmentDraftErrors(d.booking, false) : {}}
                              dateOptional
                            />
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button size="xs" variant="secondary" onClick={() => startBooking(d)}>Book it now</Button>
                            <span className="text-xs text-muted">Add who, where and the rest now. The date can wait: it stays on your to-do list until it is booked.</span>
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium text-ink mb-1">Send notes with it</p>
                          <p className="text-xs text-muted mb-2">
                            Ticked notes go onto the appointment {d.booking ? 'when it is saved' : 'as soon as it is booked'}, marked as from this visit.
                          </p>
                          <NotePicker
                            candidates={candidates}
                            picks={picksFor(d)}
                            onChange={(next) => updateDraft(d.key, { send: next })}
                            idPrefix={`send-${d.key}`}
                          />
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {joined.map((j) => (
          <JoinedNotice
            key={j.info.id}
            profileId={profileId}
            joined={j.info}
            create={j.create}
            onDone={() => {
              refresh();
              setJoined((all) => all.filter((x) => x.info.id !== j.info.id));
            }}
          />
        ))}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {tried && problems.length > 0 ? (
          <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-3 py-2" role="alert">
            {problems.map((p) => (
              <p key={p} className="text-sm text-red-700 dark:text-red-300">{p}</p>
            ))}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</Button>
          {canEdit ? (
            <Button
              loading={save.isPending}
              onClick={trySave}
            >
              Save
            </Button>
          ) : null}
        </div>
      </div>
      {editingList ? <EditNextStepsModal profileId={profileId} onClose={() => setEditingList(false)} /> : null}
    </Modal>
  );
}
