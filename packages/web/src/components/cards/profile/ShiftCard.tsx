import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isToday, isYesterday } from 'date-fns';
import { format } from '../../../lib/dateFormat';
import { api } from '../../../api/client';
import { Button } from '../../ui/Button';
import { Input, Textarea } from '../../ui/Input';
import { Modal } from '../../ui/Modal';
import { ContactStrip, CONTACT_LINK } from '../../ContactStrip';
import { LinkedText } from '../../LinkedText';
import { PhoneLink } from './links';
import { browserTimeZone } from '../../../lib/datetime';
import { ALLERGY_CHIP, reactionWords, type ContactSummary } from '../../../lib/care';
import { CardShell, CardTrouble, CardWaiting } from '../CardShell';
import type { CardProps } from '../types';

interface ShiftData {
  allergies: Array<{ id: string; substance: string; reaction: string | null }>;
  gp: ContactSummary | null;
  emergency_contact: (ContactSummary & { relationship: string | null }) | null;
  due_now: Array<{ medication_id: string; medication_name: string; dose: string | null; time: string; instructions: string | null; with_food: boolean; late: boolean; scheduled_for: string }>;
  as_needed: Array<{ id: string; name: string; as_needed_for: string | null; min_hours_between_doses: number | null; max_doses_per_day: number | null; last_given_at: string | null; last_given_by: string | null; given_24h: number }>;
  care_needs: { diet: string[]; mobility: string[]; communication: string[] };
  last_handover: { id: string; title: string | null; body: string; occurred_at: string; author_name: string | null } | null;
  changes_since: number;
  since: string;
}

/** "yesterday at 20:15", "today at 07:40", "Tue 17 Nov at 20:15". */
function whenSaid(iso: string): string {
  const d = new Date(iso);
  const time = format(d, 'HH:mm');
  if (isToday(d)) return `today at ${time}`;
  if (isYesterday(d)) return `yesterday at ${time}`;
  return `${format(d, 'EEE d MMM')} at ${time}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="min-w-0 text-sm text-ink">{children}</div>
    </div>
  );
}

/**
 * Before you start: what someone starting a shift needs before anything
 * else. What not to give, who to call, what is due now, how they eat, move
 * and talk, and what the last person on shift wrote, with who wrote it.
 * Every part works with no assistant at all.
 */
export function ShiftCard({ profileId, canEdit, careName }: CardProps) {
  const navigate = useNavigate();
  const [writing, setWriting] = useState(false);
  const tz = browserTimeZone();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['shift', profileId],
    queryFn: () => api.get<{ shift: ShiftData }>(`/care-profiles/${profileId}/shift${tz ? `?tz=${encodeURIComponent(tz)}` : ''}`),
  });
  const s = data?.shift;

  return (
    <CardShell>
      {isLoading ? <CardWaiting /> : isError || !s ? <CardTrouble what="What to know before you start" /> : (
        <div className="space-y-3">
          <Row label="Allergies">
            {s.allergies.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border-l-4 border-red-500 bg-red-50 dark:bg-red-900/10 px-3 py-2 font-medium text-red-700 dark:text-red-300">
                <span>Allergic to</span>
                {s.allergies.map((a) => (
                  <span key={a.id} className={ALLERGY_CHIP}><span className="font-semibold">{a.substance}</span>{reactionWords(a.reaction) ? <span>: {reactionWords(a.reaction)}</span> : null}</span>
                ))}
              </div>
            ) : (
              <p className="rounded-md border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-900/10 px-3 py-2 text-amber-800 dark:text-amber-200">
                Allergies not recorded yet. Ask before giving anything new.
              </p>
            )}
          </Row>

          <Row label="GP">
            {s.gp ? <ContactStrip contact={s.gp} profileId={profileId} size="compact" book={false} /> : <p className="text-muted">No GP on file yet.</p>}
          </Row>

          <Row label="Emergency contact">
            {s.emergency_contact ? (
              <p className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium">{s.emergency_contact.name}</span>
                {s.emergency_contact.relationship ? <span className="text-muted">{s.emergency_contact.relationship}</span> : null}
                {s.emergency_contact.phone ? <PhoneLink phone={s.emergency_contact.phone} /> : <span className="text-muted">No phone yet.</span>}
              </p>
            ) : (
              <p className="text-muted">No emergency contact chosen yet.</p>
            )}
          </Row>

          <Row label="Due now">
            {s.due_now.length === 0 ? (
              <p className="text-muted">No doses due in the next two hours.</p>
            ) : (
              <ul className="space-y-1">
                {s.due_now.map((d) => (
                  <li key={`${d.medication_id}-${d.scheduled_for}`}>
                    <span className={`font-medium ${d.late ? 'text-red-700 dark:text-red-300' : ''}`}>{d.time}</span> {d.medication_name}
                    {d.dose ? <span className="text-muted"> {d.dose}</span> : null}
                    {d.with_food ? <span className="block text-xs text-muted">Take with food</span> : null}
                    {d.instructions ? <span className="block text-xs text-muted">{d.instructions}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            {s.as_needed.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {s.as_needed.map((m) => (
                  <li key={m.id} className="text-xs text-muted">
                    <span className="font-medium text-ink">{m.name}</span>
                    {' '}As needed{m.as_needed_for ? ` for ${m.as_needed_for}` : ''}.
                    {m.min_hours_between_doses != null ? ` At least ${m.min_hours_between_doses} hours apart.` : ''}
                    {m.max_doses_per_day != null ? ` No more than ${m.max_doses_per_day} in 24 hours.` : ''}
                    {m.last_given_at ? ` Last given ${format(new Date(m.last_given_at), 'd MMM, HH:mm')}${m.last_given_by ? ` by ${m.last_given_by}` : ''}. ${m.given_24h} ${m.given_24h === 1 ? 'dose' : 'doses'} in the last 24 hours.` : ' Not given yet.'}
                  </li>
                ))}
              </ul>
            ) : null}
          </Row>

          <Row label="Care needs">
            {s.care_needs.diet.length + s.care_needs.mobility.length + s.care_needs.communication.length === 0 ? (
              <p className="text-muted">
                No care needs written down yet.{' '}
                <Link to={`/app/${profileId}/care-needs`} className={`${CONTACT_LINK}`}>Add care needs</Link>
              </p>
            ) : (
              <div className="space-y-0.5">
                {s.care_needs.diet.length ? <p><span className="text-muted">Eating and drinking:</span> {s.care_needs.diet.join(', ')}</p> : null}
                {s.care_needs.mobility.length ? <p><span className="text-muted">Moving:</span> {s.care_needs.mobility.join(', ')}</p> : null}
                {s.care_needs.communication.length ? <p><span className="text-muted">Talking and understanding:</span> {s.care_needs.communication.join(', ')}</p> : null}
              </div>
            )}
          </Row>

          <Row label="Last handover">
            {s.last_handover ? (
              <div>
                {s.last_handover.title ? <p className="font-medium">{s.last_handover.title}</p> : null}
                <div className="whitespace-pre-wrap"><LinkedText text={s.last_handover.body} profileId={profileId} canEdit={canEdit} /></div>
                <p className="text-xs text-muted">{[s.last_handover.author_name, whenSaid(s.last_handover.occurred_at)].filter(Boolean).join(', ')}</p>
              </div>
            ) : (
              <p className="text-muted">No handover written yet.</p>
            )}
          </Row>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {canEdit ? (
              <>
                <Button size="sm" onClick={() => navigate(`/app/round?for=${profileId}`)}>Start the medicine round</Button>
                <Button size="sm" variant="secondary" onClick={() => setWriting(true)}>Write a handover</Button>
              </>
            ) : null}
            {s.changes_since > 0 ? (
              <a href="#card-recent" className={`${CONTACT_LINK} text-sm`}>
                {s.changes_since} {s.changes_since === 1 ? 'change' : 'changes'} since your last visit
              </a>
            ) : (
              <span className="text-xs text-muted">Nothing has changed since your last visit.</span>
            )}
          </div>
        </div>
      )}
      {writing ? <HandoverModal profileId={profileId} careName={careName} onClose={() => setWriting(false)} /> : null}
    </CardShell>
  );
}

/** Write a handover for the next person on shift. It lands in the care log with your name on it. */
function HandoverModal({ profileId, careName, onClose }: { profileId: string; careName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profileId}/log`, { entry_type: 'handover', title: title.trim() || null, body: body.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shift', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['care-log', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['recent-activity', profileId] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The handover was not saved. Try again.'),
  });
  return (
    <Modal open onClose={onClose} title={`Handover for ${careName}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim()) {
            setError('Write what the next person on shift needs to know, then save it.');
            document.getElementById('handover-body')?.focus();
            return;
          }
          setError('');
          save.mutate();
        }}
      >
        <Input id="handover-title" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Evening handover" />
        <Textarea id="handover-body" label="What the next carer needs to know" value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="e.g. Refused her 8pm tablets. Daughter rang at 7pm. Skin check due." />
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save the handover</Button>
        </div>
      </form>
    </Modal>
  );
}
